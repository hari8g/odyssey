// packages/main/src/ux/uxReadModels.ts
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { IPC } from '@shared/index'

const STAGE_TO_VERB: Record<string, string> = {
  SIGNALS: 'LISTEN',
  CLUSTER: 'LISTEN',
  INTAKE: 'DECIDE',
  QUALIFY: 'DECIDE',
  PACKET: 'DECIDE',
  PORTFOLIO_GATE: 'DECIDE',
  BUILD: 'BUILD',
  CONSOLIDATE: 'SHIP',
  RELEASE_GATE: 'SHIP',
  ROLLOUT: 'SHIP',
  OBSERVE: 'LEARN',
  LEARN: 'LEARN',
  DONE: 'LEARN',
}

// BUILD runner stage spans DEFINE+BUILD in the six-verb model;
// use FSM stream_state when available to split DEFINE vs BUILD.
function verbForRun(stage: string, streamState: string | null): string {
  if (stage === 'BUILD' && streamState === 'DEFINE') return 'DEFINE'
  if (stage === 'BUILD') return 'BUILD'
  return STAGE_TO_VERB[stage] ?? 'BUILD'
}

type Accessors = {
  getDb: () => Database.Database | null
}

let registered = false

export function registerUxReadModels(accessors: Accessors): void {
  if (registered) return
  registered = true

  const requireDb = (): Database.Database => {
    const db = accessors.getDb()
    if (!db) throw new Error('No workspace open')
    return db
  }

  ipcMain.handle(IPC.UX_GET_JOURNEY_BOARD, () => {
    try {
      const db = requireDb()
      const rows = db
        .prepare(
          `
        SELECT cr.id, cr.label as title, cr.current_stage, cr.status, cr.error,
               cr.feature_node_id, cr.readiness_report_id, cr.mode,
               (unixepoch()*1000 - cr.updated_at) / 86400000.0 as days_in_stage,
               (SELECT COUNT(*) FROM value_hypotheses vh
                JOIN graph_nodes h ON h.id=vh.hypothesis_node_id
                WHERE h.source_type='committed' AND vh.verdict_node_id IS NULL) as bet_count,
               (SELECT vss.stream_state FROM value_stream_state vss
                WHERE vss.feature_node_id = cr.feature_node_id) as stream_state
        FROM cycle_runs cr
        WHERE cr.status NOT IN ('completed','aborted')
        ORDER BY cr.updated_at DESC
      `,
        )
        .all() as Array<{
        id: number
        title: string
        current_stage: string
        status: string
        error: string | null
        feature_node_id: number | null
        readiness_report_id: number | null
        mode: string
        days_in_stage: number
        bet_count: number
        stream_state: string | null
      }>

      return rows.map((r) => ({
        id: r.id,
        featureId: r.feature_node_id,
        title: r.title,
        verb: verbForRun(r.current_stage, r.stream_state),
        statusLine:
          r.status === 'waiting_gate'
            ? 'Needs a decision'
            : r.status === 'error'
              ? `Needs attention — ${(r.error ?? '').slice(0, 60)}`
              : r.status === 'waiting_external'
                ? 'Waiting on the world'
                : 'Agents working',
        status: r.status,
        needsHuman: r.status === 'waiting_gate',
        daysInStage: Math.max(0, Math.round(r.days_in_stage ?? 0)),
        betCount: r.bet_count ?? 0,
        mode: r.mode,
        stage: r.current_stage,
      }))
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.UX_GET_FEATURE_STORY, (_e, { featureId }: { featureId: number }) => {
    try {
      const db = requireDb()
      const node = db
        .prepare('SELECT id, label, description FROM graph_nodes WHERE id=?')
        .get(featureId) as { id: number; label: string; description: string | null } | undefined
      if (!node) return null

      const painPoints = db
        .prepare(
          `
        SELECT pp.id, pp.label FROM graph_nodes pp
        JOIN graph_edges ge ON ge.to_node_id=? AND ge.from_node_id=pp.id AND ge.kind='MOTIVATES'
        WHERE pp.kind='PAIN_POINT'
      `,
        )
        .all(featureId) as { id: number; label: string }[]

      const signals = db
        .prepare(
          `
        SELECT cs.id, cs.label FROM graph_nodes cs
        JOIN graph_edges ge ON ge.from_node_id=cs.id AND ge.kind='EXPRESSES'
        JOIN graph_nodes pp ON pp.id=ge.to_node_id
        JOIN graph_edges ge2 ON ge2.to_node_id=? AND ge2.from_node_id=pp.id AND ge2.kind='MOTIVATES'
        WHERE cs.kind='CUSTOMER_SIGNAL'
        LIMIT 5
      `,
        )
        .all(featureId) as { id: number; label: string }[]

      const bets = db
        .prepare(
          `
        SELECT gn.id, gn.label, vh.magnitude_pct, vh.direction, vh.timeframe_days,
               vh.prior_confidence, vh.verdict_node_id, vh.actual_delta_pct,
               kpi.label as kpi_label
        FROM value_hypotheses vh
        JOIN graph_nodes gn ON gn.id=vh.hypothesis_node_id
        LEFT JOIN graph_nodes kpi ON kpi.id=vh.kpi_node_id
        WHERE gn.source_type='committed'
        LIMIT 20
      `,
        )
        .all() as Array<Record<string, unknown>>

      const run = db
        .prepare(
          `SELECT * FROM cycle_runs WHERE feature_node_id=? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(featureId)

      const timeline = run
        ? (db
            .prepare(
              `SELECT stage, event, agent_id, artifact_node_id, detail_json, ts
               FROM cycle_stage_log WHERE run_id=? ORDER BY ts ASC LIMIT 200`,
            )
            .all((run as { id: number }).id) as unknown[])
        : []

      const regulations = db
        .prepare(
          `
        SELECT DISTINCT r.id, r.label FROM graph_nodes r
        JOIN graph_edges ge ON ge.to_node_id = r.id AND ge.kind = 'GOVERNED_BY'
        JOIN graph_nodes code ON code.id = ge.from_node_id
        JOIN feature_traces ft ON ft.code_node_id = code.id
        WHERE r.kind = 'REGULATION' AND ft.feature_node_id = ?
        LIMIT 20
      `,
        )
        .all(featureId) as { id: number; label: string }[]

      const involvedRoles = db
        .prepare(
          `
        SELECT DISTINCT gn.label FROM graph_nodes gn
        JOIN graph_edges ge ON ge.to_node_id = gn.id
        WHERE ge.from_node_id = ? AND gn.kind IN ('ROLE','ORG_UNIT')
        LIMIT 20
      `,
        )
        .all(featureId) as { label: string }[]

      const code = db
        .prepare(
          `
        SELECT gn.id, gn.label, gn.file_path, gn.sdlc_phase, gn.importance_score as fis
        FROM feature_traces ft
        JOIN graph_nodes gn ON gn.id = ft.code_node_id
        WHERE ft.feature_node_id = ?
        ORDER BY gn.importance_score DESC
        LIMIT 8
      `,
        )
        .all(featureId) as Array<{
        id: number
        label: string
        file_path: string | null
        sdlc_phase: string | null
        fis: number
      }>

      return {
        id: node.id,
        title: node.label,
        description: node.description,
        originProblem: painPoints[0]?.label ?? null,
        signalCount: signals.length,
        signals,
        painPoints,
        bets,
        run,
        timeline,
        regulations,
        involvedRoles: involvedRoles.map((r) => r.label),
        code,
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.UX_GET_ACTIONS, (_e, opts?: { role?: string }) => {
    try {
      const db = requireDb()
      void opts
      const gates = db
        .prepare(
          `
        SELECT cr.id as run_id, cr.current_stage, cr.label as title, cr.updated_at
        FROM cycle_runs cr
        WHERE cr.status='waiting_gate'
        ORDER BY cr.updated_at ASC
      `,
        )
        .all() as Array<{
        run_id: number
        current_stage: string
        title: string
        updated_at: number
      }>

      return gates.map((g) => ({
        id: `gate-${g.run_id}`,
        verb: g.current_stage === 'PORTFOLIO_GATE' ? 'DECIDE' : 'SIGN',
        title:
          g.current_stage === 'PORTFOLIO_GATE'
            ? `Decide on ${g.title}`
            : `Sign off on ${g.title}`,
        sub:
          g.current_stage === 'PORTFOLIO_GATE'
            ? 'Portfolio admission decision needed'
            : 'Release approval needed',
        age: ageLabel(g.updated_at),
        actionLabel: g.current_stage === 'PORTFOLIO_GATE' ? 'Decide' : 'Review & sign',
        route: `/gate/${g.run_id}/${g.current_stage}`,
      }))
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.UX_GET_GRAPH_NODE, (_e, { nodeId }: { nodeId: number }) => {
    try {
      const db = requireDb()
      return db
        .prepare('SELECT id, kind, label, description FROM graph_nodes WHERE id=?')
        .get(nodeId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.UX_GET_HOME_STATS, () => {
    try {
      const db = requireDb()
      const signalCount = (
        db.prepare(`SELECT COUNT(*) c FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'`).get() as {
          c: number
        }
      ).c
      const painPoints = db
        .prepare(
          `
        SELECT pp.id, pp.label,
               (SELECT COUNT(*) FROM graph_edges ge
                WHERE ge.to_node_id=pp.id AND ge.kind='EXPRESSES') as signal_count
        FROM graph_nodes pp
        WHERE pp.kind='PAIN_POINT'
        ORDER BY signal_count DESC
        LIMIT 10
      `,
        )
        .all()
      const contexts = db
        .prepare(
          `SELECT id, label FROM graph_nodes WHERE kind='BOUNDED_CONTEXT' ORDER BY label LIMIT 50`,
        )
        .all()
      const learnings = db
        .prepare(
          `SELECT id, label, description FROM graph_nodes WHERE kind='LEARNING' ORDER BY created_at DESC LIMIT 10`,
        )
        .all()
      const verdicts = db
        .prepare(
          `SELECT id, label, description FROM graph_nodes WHERE kind='HYPOTHESIS_VERDICT' ORDER BY created_at DESC LIMIT 20`,
        )
        .all()
      const committed = (
        db
          .prepare(
            `SELECT COUNT(*) c FROM value_hypotheses vh
             JOIN graph_nodes h ON h.id=vh.hypothesis_node_id WHERE h.source_type='committed'`,
          )
          .get() as { c: number }
      ).c
      const pending = (
        db
          .prepare(
            `SELECT COUNT(*) c FROM value_hypotheses vh
             JOIN graph_nodes h ON h.id=vh.hypothesis_node_id
             WHERE h.source_type='committed' AND vh.verdict_node_id IS NULL`,
          )
          .get() as { c: number }
      ).c

      return {
        signalCount,
        painPointCount: (painPoints as unknown[]).length,
        painPoints,
        contexts,
        learnings,
        verdicts,
        bets: { committed, pending, validated: committed - pending },
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function ageLabel(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}
