// packages/main/src/aep/downstream/agents/a10ConsolidationAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import type { BlastRadius } from '@shared/index'
import { upsertNode, insertEdge } from '../../graphWrite'
import { BlastRadiusEngine } from '../blastRadiusEngine'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export interface A10Input {
  featureId: number
}

export interface PendingGate {
  kind: string
  label: string
  reason: string
}

export interface A10Result {
  reportId: number
  blastRadius: BlastRadius
  pendingGates: PendingGate[]
  approvalSet: string[]
  isStub: boolean
}

export class A10ConsolidationAgent {
  private readonly engine: BlastRadiusEngine

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.engine = new BlastRadiusEngine(db)
  }

  async run(input: A10Input): Promise<A10Result> {
    const blastRadius = this.engine.compute(input.featureId, 'feature')
    const pendingGates = this.collectPendingGates(input.featureId)
    const reportText = await this.generateReport(blastRadius, pendingGates)

    const reportId = this.db.transaction((): number => {
      const featureRow = this.db
        .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
        .get(input.featureId)
      const featureLabel = featureRow?.label ?? `Feature#${input.featureId}`

      const nodeId = upsertNode(this.db, {
        kind: 'RELEASE_READINESS_REPORT',
        label: `RRR: ${featureLabel.slice(0, 140)}`,
        description: reportText.slice(0, 2000),
        source_type: 'aep_agent',
        source_ref: 'a10_consolidation',
      })

      this.db
        .prepare(
          `INSERT OR REPLACE INTO artifact_provenance
           (artifact_node_id, agent_id, agent_version, derived_from_json, confidence, approved_by_role, approved_at)
           VALUES (?, 'a10_consolidation', '1.0', ?, ?, NULL, NULL)`,
        )
        .run(nodeId, JSON.stringify([input.featureId]), blastRadius.scope2_gaps.length === 0 ? 0.85 : 0.6)

      insertEdge(this.db, nodeId, input.featureId, 'ASSESSED_FOR', 1.0, {
        blastRadius: JSON.stringify({
          scope1Count: blastRadius.scope1_code.length,
          scope2Gaps: blastRadius.scope2_gaps.length,
          scope3OpsCount: blastRadius.scope3_ops.length,
          governed: blastRadius.scope4_org.governed,
        }),
      })

      return nodeId
    })()

    return {
      reportId,
      blastRadius,
      pendingGates,
      approvalSet: blastRadius.approvalSet,
      isStub: reportText.startsWith('[stub]'),
    }
  }

  private collectPendingGates(featureId: number): PendingGate[] {
    const gates: PendingGate[] = []

    // QUALITY_GATE nodes linked to the feature's builds that are not yet evidenced
    const ungatedBuilds = this.db
      .prepare<[number], { gateLabel: string; gateKind: string }>(
        `SELECT DISTINCT qg.label AS gateLabel, qg.kind AS gateKind
         FROM graph_edges ge_impl
         JOIN graph_nodes build ON build.id = ge_impl.to_node_id AND build.kind = 'BUILD'
         JOIN graph_edges ge_gate ON ge_gate.from_node_id = build.id AND ge_gate.kind = 'GATED_BY'
         JOIN graph_nodes qg ON qg.id = ge_gate.to_node_id AND qg.kind = 'QUALITY_GATE'
         WHERE ge_impl.from_node_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM graph_edges ev
             WHERE ev.from_node_id = qg.id AND ev.kind = 'EVIDENCED_BY'
           )`,
      )
      .all(featureId)

    for (const r of ungatedBuilds) {
      gates.push({ kind: r.gateKind, label: r.gateLabel, reason: 'Quality gate lacks evidence' })
    }

    // Features with no TEST_RUN in their build chain
    const missingTestRun = this.db
      .prepare<[number], { cnt: number }>(
        `SELECT COUNT(*) AS cnt
         FROM graph_edges ge_impl
         JOIN graph_nodes build ON build.id = ge_impl.to_node_id AND build.kind = 'BUILD'
         WHERE ge_impl.from_node_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM graph_edges ev
             JOIN graph_nodes tr ON tr.id = ev.from_node_id AND tr.kind = 'TEST_RUN'
             WHERE ev.to_node_id = build.id AND ev.kind = 'EVIDENCED_BY'
           )`,
      )
      .get(featureId)

    if ((missingTestRun?.cnt ?? 0) > 0) {
      gates.push({
        kind: 'TEST_RUN',
        label: 'Missing test run',
        reason: `${missingTestRun!.cnt} build(s) have no test run recorded`,
      })
    }

    return gates
  }

  private async generateReport(blast: BlastRadius, gates: PendingGate[]): Promise<string> {
    if (!this.llm) return this.stubReport(blast, gates)
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system: 'You are a release manager writing release readiness reports. Return concise markdown.',
        messages: [
          {
            role: 'user',
            content:
              `Write a Release Readiness Report for feature #${blast.featureId}.\n\n` +
              `Blast Radius:\n` +
              `- Code files: ${blast.scope1_code.length} (${blast.scope1_code.filter((f) => f.changeType === 'direct').length} direct, ${blast.scope1_code.filter((f) => f.changeType === 'cochange').length} co-change)\n` +
              `- Test coverage gaps: ${blast.scope2_gaps.length} file(s) uncovered\n` +
              `- Ops nodes: ${blast.scope3_ops.length}\n` +
              `- KPIs affected: ${blast.scope4_org.kpis.join(', ') || 'none'}\n` +
              `- Governed by: ${blast.scope4_org.governed.join(', ') || 'none'}\n\n` +
              `Pending Gates: ${gates.length}\n${gates.map((g) => `- ${g.label}: ${g.reason}`).join('\n')}\n\n` +
              `Required approvals: ${blast.approvalSet.join(', ')}\n\n` +
              `Write a 200-300 word report with sections: ## Summary, ## Risk Assessment, ## Pending Gates, ## Required Approvals`,
          },
        ],
        max_tokens: 600,
      })
      return llmText(resp)
    } catch {
      return this.stubReport(blast, gates)
    }
  }

  private stubReport(blast: BlastRadius, gates: PendingGate[]): string {
    return (
      `[stub] # Release Readiness Report — Feature #${blast.featureId}\n\n` +
      `## Summary\n` +
      `Blast radius: ${blast.scope1_code.length} code file(s), ` +
      `${blast.scope2_gaps.length} coverage gap(s), ` +
      `${blast.scope3_ops.length} ops node(s).\n\n` +
      `## Pending Gates\n` +
      (gates.length
        ? gates.map((g) => `- **${g.label}**: ${g.reason}`).join('\n')
        : '_None_') +
      `\n\n## Required Approvals\n${blast.approvalSet.map((r) => `- ${r}`).join('\n')}`
    )
  }
}
