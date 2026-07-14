// packages/main/src/cycle/cycleOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import { IPC, type CycleStage, type CycleRunRow, type CycleTimelineRow } from '@shared/index'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { STAGES, stageById } from './stageDefinitions'
import { PainPointClusterer } from '../aep/upstream/passE/painPointClusterer'
import { A1IntakeAgent } from '../aep/upstream/agents/a1IntakeAgent'
import { A2BusinessImpactAgent } from '../aep/upstream/agents/a2BusinessImpactAgent'
import { A3GtmAlignmentAgent } from '../aep/upstream/agents/a3GtmAlignmentAgent'
import { A4DevImpactAgent } from '../aep/upstream/agents/a4DevImpactAgent'
import { A5PortfolioAgent } from '../aep/upstream/agents/a5PortfolioAgent'
import { executePortfolioGate } from '../aep/upstream/portfolioGate'
import { A10ConsolidationAgent } from '../aep/downstream/agents/a10ConsolidationAgent'
import { A11DeploymentAgent } from '../aep/downstream/agents/a11DeploymentAgent'
import { PassGOrchestrator } from '../aep/downstream/passG/passGOrchestrator'
import { HumanGateManager } from '../aep/governance/humanGateManager'
import { BlastRadiusEngine } from '../aep/downstream/blastRadiusEngine'

export class CycleOrchestrator {
  constructor(
    private readonly db: Database.Database,
    private readonly win: BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  startCycle(input: {
    label: string
    mode: 'live' | 'demo'
    painPointIds?: number[]
  }): number {
    const hasPain = (input.painPointIds?.length ?? 0) > 0
    const stage: CycleStage = hasPain ? 'INTAKE' : 'SIGNALS'
    const r = this.db
      .prepare(
        `
      INSERT INTO cycle_runs (label, mode, current_stage, status, pain_point_ids_json)
      VALUES (?, ?, ?, 'running', ?)
    `,
      )
      .run(input.label, input.mode, stage, JSON.stringify(input.painPointIds ?? []))
    const runId = Number(r.lastInsertRowid)
    this.log(runId, stage, 'entered')
    void this.advance(runId)
    return runId
  }

  resumeAll(): void {
    const open = this.db
      .prepare<[], { id: number }>(
        `SELECT id FROM cycle_runs WHERE status IN ('running','waiting_external','waiting_gate')`,
      )
      .all()
    for (const { id } of open) void this.advance(id)
  }

  handleTick(): void {
    const waiting = this.db
      .prepare<[], { id: number }>(
        `SELECT id FROM cycle_runs WHERE status = 'waiting_external'`,
      )
      .all()
    for (const { id } of waiting) void this.advance(id)
  }

  async advance(runId: number): Promise<void> {
    for (let guard = 0; guard < STAGES.length + 2; guard++) {
      const run = this.getRun(runId)
      if (!run || ['completed', 'aborted', 'error'].includes(run.status)) return

      const def = stageById(run.current_stage)
      const exit = def.exit(this.db, run)

      if (exit.ok) {
        if (def.kind === 'TERMINAL' || !def.next) {
          this.setStatus(runId, 'completed')
          this.push(runId)
          return
        }
        // Capture RC id when leaving BUILD
        if (run.current_stage === 'BUILD' && run.feature_node_id && !run.rc_id) {
          const rcId = this.findRcForRun(run)
          if (rcId) {
            this.db
              .prepare(`UPDATE cycle_runs SET rc_id=?, updated_at=unixepoch()*1000 WHERE id=?`)
              .run(rcId, runId)
          }
        }
        this.setStage(runId, def.next)
        this.log(runId, def.next, 'entered')
        continue
      }

      if (def.kind === 'WAIT') {
        this.setStatus(runId, 'waiting_external', exit.reason)
        this.push(runId)
        return
      }
      if (def.kind === 'GATE') {
        this.setStatus(runId, 'waiting_gate', exit.reason)
        this.push(runId)
        return
      }

      try {
        const acted = await this.runEntryAction(run)
        if (!acted) {
          this.setStatus(runId, 'waiting_external', exit.reason)
          this.push(runId)
          return
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.setStatus(runId, 'error', msg)
        this.log(runId, run.current_stage, 'error', { detail: msg })
        this.push(runId)
        return
      }
    }
  }

  private async runEntryAction(run: CycleRunRow): Promise<boolean> {
    const provider = this.getProvider()
    const set = (col: string, val: number) =>
      this.db
        .prepare(`UPDATE cycle_runs SET ${col}=?, updated_at=unixepoch()*1000 WHERE id=?`)
        .run(val, run.id)

    switch (run.current_stage) {
      case 'CLUSTER': {
        this.log(run.id, 'CLUSTER', 'agent_started', { agent: 'clusterer' })
        const signalIds = this.unclusteredSignalIds()
        const result = await new PainPointClusterer(this.db, provider).cluster(signalIds)
        this.log(run.id, 'CLUSTER', 'agent_finished', {
          detail: `${result.clusters.length} pain points`,
        })
        return true
      }
      case 'INTAKE': {
        if (run.brief_id) return false
        const ppIds: number[] = JSON.parse(run.pain_point_ids_json ?? '[]')
        const ids = ppIds.length > 0 ? ppIds : this.topPainPoints(3)
        if (ids.length === 0) throw new Error('no pain points available for intake')
        this.log(run.id, 'INTAKE', 'agent_started', { agent: 'A1' })
        const { briefId, featureId } = await new A1IntakeAgent(this.db, provider).run({
          painPointIds: ids,
        })
        set('brief_id', briefId)
        set('feature_node_id', featureId)
        this.db
          .prepare(`UPDATE cycle_runs SET pain_point_ids_json=?, updated_at=unixepoch()*1000 WHERE id=?`)
          .run(JSON.stringify(ids), run.id)
        this.log(run.id, 'INTAKE', 'agent_finished', { agent: 'A1', artifact: briefId })
        return true
      }
      case 'QUALIFY': {
        if (run.biz_assess_id && run.dev_assess_id) return false
        if (!run.brief_id || !run.feature_node_id) {
          throw new Error('QUALIFY requires brief_id and feature_node_id')
        }
        this.log(run.id, 'QUALIFY', 'agent_started', { agent: 'A2‖A4' })
        const [a2, a4] = await Promise.all([
          new A2BusinessImpactAgent(this.db, provider).run(run.brief_id, run.feature_node_id),
          new A4DevImpactAgent(this.db).run(run.brief_id, run.feature_node_id),
        ])
        set('biz_assess_id', a2.assessmentId)
        set('dev_assess_id', a4.assessmentId)
        this.log(run.id, 'QUALIFY', 'agent_finished', { agent: 'A2‖A4' })
        const a3 = await new A3GtmAlignmentAgent(this.db, provider).run(
          run.feature_node_id,
          run.brief_id,
        )
        set('gtm_assess_id', a3.gtmNotesId)
        this.log(run.id, 'QUALIFY', 'agent_finished', { agent: 'A3', artifact: a3.gtmNotesId })
        return true
      }
      case 'PACKET': {
        if (run.packet_id) return false
        if (!run.feature_node_id) throw new Error('PACKET requires feature_node_id')
        this.log(run.id, 'PACKET', 'agent_started', { agent: 'A5' })
        const { packetNodeId } = new A5PortfolioAgent(this.db).run(run.feature_node_id)
        set('packet_id', packetNodeId)
        this.log(run.id, 'PACKET', 'agent_finished', { agent: 'A5', artifact: packetNodeId })
        return true
      }
      case 'CONSOLIDATE': {
        if (run.readiness_report_id) {
          if (!run.feature_node_id) return false
          const br = new BlastRadiusEngine(this.db).compute(run.feature_node_id, 'feature')
          if (br.scope2_gaps.length > 0) {
            this.bounce(run.id, 'BUILD', 'scope-2 gaps or not-ready — returning to BUILD')
            return true
          }
          return false
        }
        if (!run.feature_node_id) throw new Error('CONSOLIDATE requires feature_node_id')
        const rcId = run.rc_id ?? this.findRcForRun(run)
        if (rcId) set('rc_id', rcId)
        this.log(run.id, 'CONSOLIDATE', 'agent_started', { agent: 'A10' })
        const { reportId } = await new A10ConsolidationAgent(this.db, provider).run({
          featureId: run.feature_node_id,
        })
        set('readiness_report_id', reportId)
        this.log(run.id, 'CONSOLIDATE', 'agent_finished', { agent: 'A10', artifact: reportId })
        return true
      }
      case 'ROLLOUT': {
        if (run.deployment_id) return false
        const buildId = this.findBuildForRun(run)
        if (!buildId) throw new Error('no BUILD found for rollout')
        this.log(run.id, 'ROLLOUT', 'agent_started', { agent: 'A11' })
        const result = await new A11DeploymentAgent(this.db, provider).run({
          buildId,
          environmentLabel: run.mode === 'demo' ? 'demo-production' : 'production',
          deployedBy: 'Cycle Runner',
          version: `cycle-${run.id}`,
        })
        if (result.halted) {
          this.log(run.id, 'ROLLOUT', 'halted', {
            detail: `KPI breaches: ${result.kpiBreaches.map((b) => b.kpiLabel).join(', ')}`,
            artifact: result.incidentId ?? undefined,
          })
        }
        set('deployment_id', result.deploymentId)
        this.log(run.id, 'ROLLOUT', 'agent_finished', {
          agent: 'A11',
          artifact: result.deploymentId,
        })
        return true
      }
      case 'LEARN': {
        if (run.outcome_report_id) return false
        if (!run.deployment_id || !run.feature_node_id) {
          throw new Error('LEARN requires deployment_id and feature_node_id')
        }
        this.log(run.id, 'LEARN', 'agent_started', { agent: 'A12→A13→A14' })
        const passG = await new PassGOrchestrator(this.db, provider).run(
          {
            deploymentId: run.deployment_id,
            featureId: run.feature_node_id,
            observationWindow: run.mode === 'demo' ? 'demo_window' : 'post_deploy_7d',
            triggerLearningHook: true,
          },
          (p) => this.progress(run.id, 'LEARN', p.pct, p.detail),
        )
        set('outcome_report_id', passG.outcomeReportId)
        this.log(run.id, 'LEARN', 'agent_finished', { artifact: passG.outcomeReportId })
        return true
      }
      default:
        return false
    }
  }

  async approvePortfolioGate(
    runId: number,
    input: {
      decision: 'admit' | 'defer' | 'reject'
      approvedByRole: string
      rationale: string
      featureNodeId?: number
    },
  ): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.current_stage !== 'PORTFOLIO_GATE') {
      throw new Error('run not at portfolio gate')
    }
    const featureNodeId = input.featureNodeId ?? run.feature_node_id
    if (!featureNodeId) throw new Error('featureNodeId required')

    executePortfolioGate(this.db, {
      featureId: featureNodeId,
      decision: input.decision,
      reason: input.rationale,
      approvedByRole: input.approvedByRole,
      briefId: run.brief_id ?? undefined,
      bizAssessmentId: run.biz_assess_id ?? undefined,
      devAssessmentId: run.dev_assess_id ?? undefined,
    })

    this.db
      .prepare(`UPDATE cycle_runs SET feature_node_id=? WHERE id=?`)
      .run(featureNodeId, runId)
    this.log(
      runId,
      'PORTFOLIO_GATE',
      input.decision === 'admit' ? 'gate_approved' : 'gate_rejected',
      { role: input.approvedByRole, decision: input.decision },
    )

    if (input.decision === 'reject') {
      this.setStatus(runId, 'aborted')
      this.push(runId)
      return
    }
    if (input.decision === 'defer') {
      this.setStage(runId, 'SIGNALS')
      this.push(runId)
      return
    }
    await this.advance(runId)
  }

  async signReleaseGate(runId: number, role: string, rationale: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.current_stage !== 'RELEASE_GATE') {
      throw new Error('run not at release gate')
    }
    if (!run.feature_node_id) throw new Error('no feature on run')
    new HumanGateManager(this.db).approve({
      featureId: run.feature_node_id,
      role,
      decision: 'approve',
      reason: rationale,
    })
    this.log(runId, 'RELEASE_GATE', 'gate_approved', { role })
    await this.advance(runId)
  }

  getRun(id: number): CycleRunRow | undefined {
    return this.db.prepare(`SELECT * FROM cycle_runs WHERE id=?`).get(id) as
      | CycleRunRow
      | undefined
  }

  getTimeline(runId: number): CycleTimelineRow[] {
    return this.db
      .prepare<[number], CycleTimelineRow>(
        `SELECT stage, event, agent_id, artifact_node_id, detail_json, ts
         FROM cycle_stage_log WHERE run_id=? ORDER BY ts DESC LIMIT 200`,
      )
      .all(runId)
  }

  private bounce(runId: number, to: CycleStage, reason: string): void {
    this.log(runId, to, 'bounced', { reason })
    this.db
      .prepare(
        `UPDATE cycle_runs SET readiness_report_id=NULL, current_stage=?, status='running',
         error=?, updated_at=unixepoch()*1000 WHERE id=?`,
      )
      .run(to, reason, runId)
    this.push(runId)
  }

  private unclusteredSignalIds(): number[] {
    return this.db
      .prepare<[], { id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'
         AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind='EXPRESSES')`,
      )
      .all()
      .map((r) => r.id)
  }

  private topPainPoints(n: number): number[] {
    return this.db
      .prepare<[number], { id: number }>(
        `SELECT id FROM graph_nodes WHERE kind='PAIN_POINT' ORDER BY importance_score DESC LIMIT ?`,
      )
      .all(n)
      .map((r) => r.id)
  }

  private findRcForRun(run: CycleRunRow): number | null {
    if (!run.feature_node_id) return null
    const viaTrace = this.db
      .prepare<[number], { id: number }>(
        `
      SELECT DISTINCT ge2.to_node_id id
      FROM feature_traces ft
      JOIN graph_edges ge  ON ge.from_node_id=ft.code_node_id AND ge.kind='PACKAGED_IN'
      JOIN graph_nodes b   ON b.id=ge.to_node_id AND b.kind='BUILD'
      JOIN graph_edges ge2 ON ge2.from_node_id=b.id AND ge2.kind='PACKAGED_IN'
      JOIN graph_nodes rc  ON rc.id=ge2.to_node_id AND rc.kind='RELEASE_CANDIDATE'
      WHERE ft.feature_node_id=? LIMIT 1
    `,
      )
      .get(run.feature_node_id)
    if (viaTrace) return viaTrace.id

    const viaFeature = this.db
      .prepare<[number], { id: number }>(
        `
      SELECT rc.id
      FROM graph_edges ge
      JOIN graph_nodes b ON b.id = ge.to_node_id AND b.kind='BUILD'
      JOIN graph_edges ge2 ON ge2.from_node_id = b.id AND ge2.kind='PACKAGED_IN'
      JOIN graph_nodes rc ON rc.id = ge2.to_node_id AND rc.kind='RELEASE_CANDIDATE'
      WHERE ge.from_node_id = ? AND ge.kind='IMPLEMENTS'
      LIMIT 1
    `,
      )
      .get(run.feature_node_id)
    return viaFeature?.id ?? null
  }

  private findBuildForRun(run: CycleRunRow): number | null {
    if (!run.feature_node_id) return null
    if (run.rc_id) {
      const b = this.db
        .prepare<[number], { id: number }>(
          `
        SELECT b.id FROM graph_edges ge
        JOIN graph_nodes b ON b.id = ge.from_node_id AND b.kind='BUILD'
        WHERE ge.to_node_id = ? AND ge.kind='PACKAGED_IN'
        ORDER BY b.created_at DESC LIMIT 1
      `,
        )
        .get(run.rc_id)
      if (b) return b.id
    }
    const row = this.db
      .prepare<[number], { id: number }>(
        `
      SELECT b.id FROM graph_edges ge
      JOIN graph_nodes b ON b.id = ge.to_node_id AND b.kind='BUILD'
      WHERE ge.from_node_id = ? AND ge.kind='IMPLEMENTS'
      ORDER BY b.created_at DESC LIMIT 1
    `,
      )
      .get(run.feature_node_id)
    return row?.id ?? null
  }

  private setStage(runId: number, stage: CycleStage): void {
    this.db
      .prepare(
        `UPDATE cycle_runs SET current_stage=?, status='running', error=NULL, updated_at=unixepoch()*1000 WHERE id=?`,
      )
      .run(stage, runId)
  }

  private setStatus(runId: number, status: string, error?: string): void {
    this.db
      .prepare(
        `UPDATE cycle_runs SET status=?, error=?, updated_at=unixepoch()*1000 WHERE id=?`,
      )
      .run(status, error ?? null, runId)
  }

  private log(
    runId: number,
    stage: string,
    event: string,
    d?: {
      agent?: string
      artifact?: number
      detail?: string
      role?: string
      decision?: string
      reason?: string
    },
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO cycle_stage_log (run_id, stage, event, agent_id, artifact_node_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        runId,
        stage,
        event,
        d?.agent ?? null,
        d?.artifact ?? null,
        d ? JSON.stringify(d) : null,
      )
  }

  private progress(runId: number, stage: string, pct: number, detail: string): void {
    if (this.win.isDestroyed()) return
    this.win.webContents.send(IPC.CYCLE_PROGRESS, { runId, stage, pct, detail })
  }

  private push(runId: number): void {
    if (this.win.isDestroyed()) return
    const run = this.getRun(runId)
    this.win.webContents.send(IPC.CYCLE_UPDATE, run)
  }
}
