// packages/main/src/aep/aepIpcHandlers.ts
import path from 'node:path'
import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { IPC, type PortfolioDecision, type AEPPassProgress } from '@shared/index'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { loadAndRunPassD } from '../domain/domainOrchestrator'
import { DomainAwareFIS } from '../domain/domainAwareFIS'
import { PassEOrchestrator } from './upstream/passE/passEOrchestrator'
import { CustomerSignalIngester } from './upstream/passE/customerSignalIngester'
import { PainPointClusterer } from './upstream/passE/painPointClusterer'
import { A1IntakeAgent } from './upstream/agents/a1IntakeAgent'
import { A2BusinessImpactAgent } from './upstream/agents/a2BusinessImpactAgent'
import { A3GtmAlignmentAgent } from './upstream/agents/a3GtmAlignmentAgent'
import { A4DevImpactAgent } from './upstream/agents/a4DevImpactAgent'
import { A5PortfolioAgent } from './upstream/agents/a5PortfolioAgent'
import { HypothesisRegistry } from './upstream/hypothesisRegistry'
import { executePortfolioGate } from './upstream/portfolioGate'
import { CicdIngester } from './downstream/passF/cicdIngester'
import { TestRunIngester } from './downstream/passF/testRunIngester'
import { DeploymentIngester } from './downstream/passF/deploymentIngester'
import { KpiObservationIngester } from './downstream/passF/kpiObservationIngester'
import { PassGOrchestrator } from './downstream/passG/passGOrchestrator'
import { BlastRadiusEngine } from './downstream/blastRadiusEngine'
import { A10ConsolidationAgent } from './downstream/agents/a10ConsolidationAgent'
import { A11DeploymentAgent } from './downstream/agents/a11DeploymentAgent'
import { A12AttributionAgent } from './downstream/agents/a12AttributionAgent'
import { A13CrossFunctionalAgent } from './downstream/agents/a13CrossFunctionalAgent'
import { A14LearningAgent, type OutcomeReport, type VerdictSummary } from './downstream/agents/a14LearningAgent'
import { wireAEP, type AEPGovernanceAPI } from './aepOrchestrator'
import type { GoldenThread, HypothesisPortfolioRow, ValueStreamState } from '@shared/index'

type WorkspaceAccessors = {
  getDb: () => Database.Database | null
  getRoot: () => string | null
  getWin: () => BrowserWindow | null
  getProvider: () => ILLMProvider
}

let handlersRegistered = false
let govApi: AEPGovernanceAPI | null = null

function requireCtx(accessors: WorkspaceAccessors): {
  db: Database.Database
  root: string
  win: BrowserWindow
} {
  const db = accessors.getDb()
  const root = accessors.getRoot()
  const win = accessors.getWin()
  if (!db || !root || !win || win.isDestroyed()) {
    throw new Error('No workspace open')
  }
  return { db, root, win }
}

function pushProgress(win: BrowserWindow, p: AEPPassProgress): void {
  if (!win.isDestroyed()) win.webContents.send(IPC.AEP_PASS_PROGRESS, p)
}

function bundledDomainPackDirs(): string[] {
  return [
    path.join(app.getAppPath(), 'resources', 'domain_packs'),
    path.join(__dirname, '../../../resources/domain_packs'),
    path.join(process.cwd(), 'resources', 'domain_packs'),
  ]
}

function getGoldenThread(db: Database.Database, featureId: number): GoldenThread | { error: string } {
  const feature = db
    .prepare('SELECT id, label FROM graph_nodes WHERE id = ?')
    .get(featureId) as { id: number; label: string } | undefined
  if (!feature) return { error: `Feature ${featureId} not found` }

  const vss = db
    .prepare('SELECT stream_state FROM value_stream_state WHERE feature_node_id = ?')
    .get(featureId) as { stream_state: ValueStreamState } | undefined

  const painPoints = db
    .prepare(
      `SELECT gn.id, gn.label FROM graph_edges ge
       JOIN graph_nodes gn ON gn.id = ge.from_node_id
       WHERE ge.to_node_id = ? AND ge.kind = 'MOTIVATES' AND gn.kind = 'PAIN_POINT'`,
    )
    .all(featureId) as { id: number; label: string }[]

  const domainConcepts = db
    .prepare(
      `SELECT gn.id, gn.label FROM graph_edges ge
       JOIN graph_nodes gn ON gn.id = ge.to_node_id
       WHERE ge.from_node_id = ? AND ge.kind = 'ABOUT' AND gn.kind IN ('DOMAIN_CONCEPT','GLOSSARY_TERM')`,
    )
    .all(featureId) as { id: number; label: string }[]

  const hypotheses = new HypothesisRegistry(db).getPortfolio().filter((h) => {
    const link = db
      .prepare(
        `SELECT 1 FROM graph_edges WHERE from_node_id = ? AND to_node_id = ? AND kind = 'PREDICTS' LIMIT 1`,
      )
      .get(h.hypothesisNodeId, featureId)
    const node = db
      .prepare('SELECT source_ref FROM graph_nodes WHERE id = ?')
      .get(h.hypothesisNodeId) as { source_ref: string | null } | undefined
    return Boolean(link) || node?.source_ref?.includes(String(featureId))
  }) as HypothesisPortfolioRow[]

  const builds = db
    .prepare(
      `SELECT DISTINCT b.id, b.label FROM graph_nodes b
       JOIN graph_edges pe ON pe.to_node_id = b.id AND pe.kind = 'PACKAGED_IN'
       JOIN graph_nodes f ON f.id = pe.from_node_id
       JOIN graph_edges ie ON ie.to_node_id = f.id AND ie.kind = 'IMPLEMENTS'
       WHERE ie.from_node_id = ? AND b.kind = 'BUILD'`,
    )
    .all(featureId) as { id: number; label: string }[]

  const deployments = db
    .prepare(`SELECT id, label FROM graph_nodes WHERE kind = 'DEPLOYMENT' ORDER BY id DESC LIMIT 20`)
    .all() as { id: number; label: string }[]

  const verdicts = db
    .prepare(
      `SELECT gn.id, gn.label, ge.kind FROM graph_nodes gn
       JOIN graph_edges ge ON ge.from_node_id = gn.id
       JOIN graph_nodes vh ON vh.id = ge.to_node_id AND vh.kind = 'VALUE_HYPOTHESIS'
       WHERE gn.kind = 'HYPOTHESIS_VERDICT'
         AND ge.kind IN ('VALIDATES_HYPOTHESIS','REFUTES_HYPOTHESIS')
       ORDER BY gn.id DESC LIMIT 50`,
    )
    .all() as { id: number; label: string; kind: string }[]

  const learnings = db
    .prepare(`SELECT id, label FROM graph_nodes WHERE kind = 'LEARNING' ORDER BY id DESC LIMIT 20`)
    .all() as { id: number; label: string }[]

  return {
    featureId: feature.id,
    featureLabel: feature.label,
    streamState: vss?.stream_state ?? 'INTAKE',
    painPoints,
    hypotheses,
    domainConcepts,
    builds,
    deployments,
    verdicts,
    learnings,
  }
}

export function registerAepIpcHandlers(accessors: WorkspaceAccessors): void {
  if (handlersRegistered) return
  handlersRegistered = true

  const getProvider = accessors.getProvider

  // ── Domain ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DOMAIN_LIST_PACKS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare('SELECT name, version, loaded_at, node_count, file_path FROM domain_packs ORDER BY name')
      .all()
  })

  ipcMain.handle(IPC.DOMAIN_LOAD_PACK, async (_e, { filePath }: { filePath: string }) => {
    try {
      const { db, root, win } = requireCtx(accessors)
      // loadAndRunPassD sends progress via win internally; extraPackDirs is a list of dirs to scan
      const result = await loadAndRunPassD(db, root, win, [path.dirname(filePath)])
      win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'D' })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      accessors.getWin()?.webContents.send(IPC.AEP_PASS_ERROR, { pass: 'D', message })
      return { error: message }
    }
  })

  ipcMain.handle(IPC.DOMAIN_RUN_PASS_D, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const dirs = [
        path.join(root, '.riaf', 'domain_packs'),
        ...bundledDomainPackDirs(),
      ]
      const result = await loadAndRunPassD(db, root, win, dirs)
      win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'D' })
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.DOMAIN_GET_KPIS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(
        `SELECT gn.id, gn.label, gn.description, kr.measurement_unit, kr.measurement_window,
                kr.baseline_value, kr.target_value, kr.owner_org_unit
         FROM graph_nodes gn JOIN kpi_registry kr ON kr.kpi_node_id = gn.id
         WHERE gn.kind = 'KPI' ORDER BY gn.label`,
      )
      .all()
  })

  ipcMain.handle(IPC.DOMAIN_GET_CONTEXTS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(`SELECT id, label, description FROM graph_nodes WHERE kind = 'BOUNDED_CONTEXT' ORDER BY label`)
      .all()
  })

  ipcMain.handle(IPC.DOMAIN_GET_REGULATIONS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(`SELECT id, label, description FROM graph_nodes WHERE kind = 'REGULATION' ORDER BY label`)
      .all()
  })

  ipcMain.handle(IPC.DOMAIN_GET_CONCEPTS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(
        `SELECT id, label, description FROM graph_nodes
         WHERE kind IN ('DOMAIN_CONCEPT','GLOSSARY_TERM') ORDER BY kind, label`,
      )
      .all()
  })

  // ── Upstream ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.AEP_LOAD_ORG_PACKS, async (_e, { packPaths }: { packPaths: string[] }) => {
    try {
      const { db, win } = requireCtx(accessors)
      const push = (p: AEPPassProgress) => pushProgress(win, p)
      const result = await new PassEOrchestrator(db, getProvider()).run(
        { orgPackPaths: packPaths },
        push,
      )
      win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'E_org' })
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_INGEST_SIGNALS,
    (_e, { source, content }: { source: string; content: string }) => {
      try {
        const { db, win } = requireCtx(accessors)
        const push = (p: AEPPassProgress) => pushProgress(win, p)

        let parsed: { cohort: string; type: string; text: string; date?: string }[]
        try {
          parsed = JSON.parse(content) as typeof parsed
          if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
        } catch {
          return { error: 'Content must be a JSON array of {cohort, type, text, date?}' }
        }

        push({ pass: 'E_signals', stage: 'signal_ingest', pct: 0, detail: `Ingesting ${parsed.length} signal(s)…` })
        const ingester = new CustomerSignalIngester(db)
        const result = ingester.ingestRaw(parsed, source)
        push({
          pass: 'E_signals',
          stage: 'signal_ingest',
          pct: 100,
          detail: `${result.inserted} inserted, ${result.skipped} skipped`,
        })
        win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'E_signals' })
        return result
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_CLUSTER_PAIN_POINTS, async () => {
    try {
      const { db, win } = requireCtx(accessors)
      const push = (p: AEPPassProgress) => pushProgress(win, p)

      const signalRows = db
        .prepare<[], { signal_node_id: number }>('SELECT signal_node_id FROM customer_signals')
        .all()
      const signalNodeIds = signalRows.map((r) => r.signal_node_id)

      push({
        pass: 'E_cluster',
        stage: 'clustering',
        pct: 0,
        detail: `Clustering ${signalNodeIds.length} signal(s)…`,
      })
      const clusterer = new PainPointClusterer(db, getProvider())
      const result = await clusterer.cluster(signalNodeIds)
      push({
        pass: 'E_cluster',
        stage: 'clustering',
        pct: 100,
        detail: `${result.clusters.length} pain point(s), ${result.expressesEdges} EXPRESSES edges`,
      })
      win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'E_cluster' })
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_GET_PAIN_POINTS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(
        `SELECT gn.id, gn.label, gn.description, gn.importance_score,
                COUNT(ge.from_node_id) as signal_count
         FROM graph_nodes gn
         LEFT JOIN graph_edges ge ON ge.to_node_id = gn.id AND ge.kind = 'EXPRESSES'
         WHERE gn.kind = 'PAIN_POINT'
         GROUP BY gn.id ORDER BY signal_count DESC`,
      )
      .all()
  })

  ipcMain.handle(IPC.AEP_RUN_A1, async (_e, { painPointIds }: { painPointIds: number[] }) => {
    try {
      const { db } = requireCtx(accessors)
      return await new A1IntakeAgent(db, getProvider()).run({ painPointIds })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_RUN_A2,
    async (_e, { briefId, featureId }: { briefId: number; featureId: number }) => {
      try {
        const { db } = requireCtx(accessors)
        return await new A2BusinessImpactAgent(db, getProvider()).run(briefId, featureId)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_A3,
    async (_e, { featureId, briefId }: { featureId: number; briefId: number }) => {
      try {
        const { db } = requireCtx(accessors)
        return await new A3GtmAlignmentAgent(db, getProvider()).run(featureId, briefId)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_A4,
    async (_e, { briefId, featureId }: { briefId: number; featureId: number }) => {
      try {
        const { db } = requireCtx(accessors)
        // A4DevImpactAgent only takes db — no LLM
        return await new A4DevImpactAgent(db).run(briefId, featureId)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_RUN_A5, (_e, { featureId }: { featureId: number }) => {
    try {
      const { db } = requireCtx(accessors)
      return new A5PortfolioAgent(db).run(featureId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_PORTFOLIO_GATE, (_e, input: PortfolioDecision) => {
    try {
      const { db } = requireCtx(accessors)
      return executePortfolioGate(db, input)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_GET_HYPOTHESES, () => {
    const db = accessors.getDb()
    if (!db) return []
    return new HypothesisRegistry(db).getPortfolio()
  })

  ipcMain.handle(IPC.AEP_GET_VALUE_STREAM, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(
        `SELECT gn.id, gn.label, vss.stream_state, vss.entered_state_at, vss.blocked_on_json
         FROM value_stream_state vss
         JOIN graph_nodes gn ON gn.id = vss.feature_node_id
         ORDER BY vss.entered_state_at DESC`,
      )
      .all()
  })

  // ── Downstream ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.AEP_GET_BLAST_RADIUS, (_e, opts: { featureId?: number; releaseCandidateId?: number }) => {
    try {
      const { db } = requireCtx(accessors)
      const id = opts.featureId ?? opts.releaseCandidateId
      if (id == null) return { error: 'featureId or releaseCandidateId required' }
      const type = opts.featureId != null ? 'feature' : 'release_candidate'
      return new BlastRadiusEngine(db).compute(id, type)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_INGEST_BUILD, (_e, { payload }: { payload: unknown }) => {
    try {
      const { db } = requireCtx(accessors)
      return new CicdIngester(db).ingest(payload as Parameters<CicdIngester['ingest']>[0])
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_INGEST_TEST_RUN,
    (_e, { buildId, payload }: { buildId: number; payload: unknown }) => {
      try {
        const { db } = requireCtx(accessors)
        const p = payload as Record<string, unknown>
        return new TestRunIngester(db).ingest({
          buildId,
          runnerLabel: (p['runnerLabel'] as string | undefined) ?? 'unknown',
          status: (p['status'] as string | undefined) ?? 'passed',
          totalTests: (p['totalTests'] as number | undefined) ?? 0,
          passedTests: (p['passedTests'] as number | undefined) ?? 0,
          failedTests: (p['failedTests'] as number | undefined) ?? 0,
          durationMs: p['durationMs'] as number | undefined,
          qualityGateLabel: p['qualityGateLabel'] as string | undefined,
        })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_INGEST_DEPLOYMENT,
    (_e, { buildId, environmentLabel, deployedBy, version }: {
      buildId: number
      environmentLabel: string
      deployedBy?: string
      version?: string
    }) => {
      try {
        const { db } = requireCtx(accessors)
        return new DeploymentIngester(db).ingest({ buildId, environmentLabel, deployedBy, version })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_SNAPSHOT_KPIS, () => {
    try {
      const { db } = requireCtx(accessors)
      return new KpiObservationIngester(db).snapshotKPIs()
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_RECORD_KPI_MANUAL,
    (_e, { kpiNodeId, value, window }: { kpiNodeId: number; value: number; window: string }) => {
      try {
        const { db } = requireCtx(accessors)
        return new KpiObservationIngester(db).recordManual(kpiNodeId, value, window)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_RUN_A10, async (_e, { featureId }: { featureId: number }) => {
    try {
      const { db } = requireCtx(accessors)
      return await new A10ConsolidationAgent(db, getProvider()).run({ featureId })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_RUN_A11,
    async (
      _e,
      opts: {
        buildId: number
        environmentLabel: string
        kpiNodeIds?: number[]
        breachThresholdPct?: number
        deployedBy?: string
        version?: string
      },
    ) => {
      try {
        const { db } = requireCtx(accessors)
        return await new A11DeploymentAgent(db, getProvider()).run({
          buildId: opts.buildId,
          environmentLabel: opts.environmentLabel,
          kpiNodeIds: opts.kpiNodeIds,
          breachThresholdPct: opts.breachThresholdPct,
          deployedBy: opts.deployedBy,
          version: opts.version,
        })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_A12,
    async (_e, { featureId, observationWindow }: { featureId: number; observationWindow?: string }) => {
      try {
        const { db } = requireCtx(accessors)
        return await new A12AttributionAgent(db, getProvider()).run({ featureId, observationWindow })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_A13,
    async (_e, { featureId, deploymentId }: { featureId: number; deploymentId: number }) => {
      try {
        const { db } = requireCtx(accessors)
        return await new A13CrossFunctionalAgent(db, getProvider()).run({ featureId, deploymentId })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_A14,
    (
      _e,
      {
        featureId,
        verdicts,
        learningNotes,
      }: { featureId: number; verdicts?: VerdictSummary[]; learningNotes?: string },
    ) => {
      try {
        const { db } = requireCtx(accessors)
        const report: OutcomeReport = { featureId, verdicts: verdicts ?? [], learningNotes }
        // A14LearningAgent only takes db — no LLM
        return new A14LearningAgent(db).run(report)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.AEP_RUN_PASS_G,
    async (
      _e,
      {
        deploymentId,
        featureId,
        observationWindow,
        triggerLearningHook,
      }: {
        deploymentId: number
        featureId: number
        observationWindow?: string
        triggerLearningHook?: boolean
      },
    ) => {
      try {
        const { db, win } = requireCtx(accessors)
        const push = (p: AEPPassProgress) => pushProgress(win, p)
        const result = await new PassGOrchestrator(db, getProvider()).run(
          { deploymentId, featureId, observationWindow, triggerLearningHook },
          push,
        )
        win.webContents.send(IPC.AEP_PASS_COMPLETE, { pass: 'G' })

        // Seed calibration row for the feature
        const db2 = accessors.getDb()
        if (db2) {
          try {
            govApi = wireAEP({ db: db2 })
            govApi.calibration.seedPassGRow(featureId)
          } catch {
            /* non-fatal */
          }
        }

        return result
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── Governance ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.AEP_TICK_ORCHESTRATOR, () => {
    try {
      const { db } = requireCtx(accessors)
      govApi = wireAEP({ db })
      const result = govApi.orchestrator.tick()
      accessors.getWin()?.webContents.send(IPC.AEP_STATE_CHANGED, result)
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_FORCE_ADVANCE,
    (_e, { featureId, targetState, reason }: { featureId: number; targetState: ValueStreamState; reason: string }) => {
      try {
        const { db } = requireCtx(accessors)
        govApi = wireAEP({ db })
        return govApi.orchestrator.forceAdvance(featureId, targetState, reason)
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_GET_PENDING_GATES, () => {
    try {
      const { db } = requireCtx(accessors)
      govApi = wireAEP({ db })
      return govApi.gateManager.listPending()
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.AEP_APPROVE_GATE,
    (
      _e,
      {
        featureId,
        role,
        decision,
        reason,
      }: { featureId: number; role: string; decision: 'admit' | 'defer' | 'reject' | 'approve'; reason: string },
    ) => {
      try {
        const { db } = requireCtx(accessors)
        govApi = wireAEP({ db })
        return govApi.gateManager.approve({ featureId, role, decision, reason })
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.AEP_GET_APPROVAL_SET, (_e, { featureId }: { featureId: number }) => {
    try {
      const { db } = requireCtx(accessors)
      govApi = wireAEP({ db })
      return govApi.getApprovalSet(featureId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_GET_CALIBRATION, (_e, opts?: { agentId?: string }) => {
    try {
      const { db } = requireCtx(accessors)
      govApi = wireAEP({ db })
      return govApi.calibration.getReport(opts?.agentId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.AEP_GET_GOLDEN_THREAD, (_e, { featureId }: { featureId: number }) => {
    const db = accessors.getDb()
    if (!db) return { error: 'No workspace open' }
    return getGoldenThread(db, featureId)
  })

  ipcMain.handle(IPC.AEP_DOMAIN_FIS, async (_e, { query, mode }: { query: string; mode?: string }) => {
    try {
      const { db } = requireCtx(accessors)
      return await new DomainAwareFIS(db).score(query, (mode as never) ?? 'auto')
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}
