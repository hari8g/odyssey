// packages/main/src/cycle/stageDefinitions.ts
import type Database from 'better-sqlite3'
import type { CycleStage, CycleRunRow } from '@shared/index'
import { BlastRadiusEngine } from '../aep/downstream/blastRadiusEngine'

export type { CycleStage, CycleRunRow }

export type StageKind = 'AUTO' | 'WAIT' | 'GATE' | 'TERMINAL'

export type StageDef = {
  id: CycleStage
  kind: StageKind
  next: CycleStage | null
  title: string
  narrative: string
  fsmState: string | null
  exit: (
    db: Database.Database,
    run: CycleRunRow,
  ) => { ok: true } | { ok: false; reason: string }
}

const DEMO_SIGNAL_MIN = 5
const LIVE_SIGNAL_MIN = 20

export const STAGES: StageDef[] = [
  {
    id: 'SIGNALS',
    kind: 'WAIT',
    next: 'CLUSTER',
    title: 'Ingest customer signals',
    narrative: 'Raw customer voice enters the graph as immutable evidence.',
    fsmState: null,
    exit: (db, run) => {
      const min = run.mode === 'demo' ? DEMO_SIGNAL_MIN : LIVE_SIGNAL_MIN
      const n = db
        .prepare<[], { c: number }>(
          `SELECT COUNT(*) c FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'
           AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind='EXPRESSES')`,
        )
        .get()!.c
      return n >= min
        ? { ok: true }
        : { ok: false, reason: `${n}/${min} unclustered signals — ingest more or simulate` }
    },
  },
  {
    id: 'CLUSTER',
    kind: 'AUTO',
    next: 'INTAKE',
    title: 'Cluster into pain points',
    narrative: 'Signals are deduplicated into named, countable problems.',
    fsmState: null,
    exit: (db) => {
      const unclustered = db
        .prepare<[], { c: number }>(
          `SELECT COUNT(*) c FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'
           AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind='EXPRESSES')`,
        )
        .get()!.c
      // Must consume new signals before leaving — otherwise Cycle 2+ never clusters.
      if (unclustered > 0) {
        return { ok: false, reason: `${unclustered} signal(s) awaiting clustering` }
      }
      const n = db
        .prepare<[], { c: number }>(`SELECT COUNT(*) c FROM graph_nodes WHERE kind='PAIN_POINT'`)
        .get()!.c
      return n >= 1
        ? { ok: true }
        : { ok: false, reason: 'no pain points synthesized yet' }
    },
  },
  {
    id: 'INTAKE',
    kind: 'AUTO',
    next: 'QUALIFY',
    title: 'A1 — intake brief',
    narrative: 'Pain points become a classified, deduplicated brief.',
    fsmState: 'INTAKE',
    exit: (_db, run) =>
      run.brief_id ? { ok: true } : { ok: false, reason: 'BRIEF not yet written' },
  },
  {
    id: 'QUALIFY',
    kind: 'AUTO',
    next: 'PACKET',
    title: 'A2 ∥ A4 → A3 — assessments',
    narrative:
      'Business value and engineering cost estimated in parallel; GTM projection follows.',
    fsmState: 'QUALIFY',
    exit: (_db, run) =>
      run.biz_assess_id && run.dev_assess_id
        ? { ok: true }
        : { ok: false, reason: 'waiting for business ∧ dev assessments' },
  },
  {
    id: 'PACKET',
    kind: 'AUTO',
    next: 'PORTFOLIO_GATE',
    title: 'A5 — portfolio packet',
    narrative: 'Evidence assembled for the human forum. A5 prepares; it never decides.',
    fsmState: 'PRIORITIZE',
    exit: (_db, run) =>
      run.packet_id ? { ok: true } : { ok: false, reason: 'packet not yet assembled' },
  },
  {
    id: 'PORTFOLIO_GATE',
    kind: 'GATE',
    next: 'BUILD',
    title: '★ Portfolio admission (human)',
    narrative:
      'Admit / defer / reject. On admit, hypotheses are committed — locked before code.',
    fsmState: 'PRIORITIZE',
    exit: (db, run) => {
      if (!run.feature_node_id) return { ok: false, reason: 'awaiting gate decision' }
      const st = db
        .prepare<[number], { s: string }>(
          `SELECT stream_state s FROM value_stream_state WHERE feature_node_id=?`,
        )
        .get(run.feature_node_id)
      return st && (st.s === 'DEFINE' || st.s === 'BUILD')
        ? { ok: true }
        : { ok: false, reason: 'awaiting gate decision' }
    },
  },
  {
    id: 'BUILD',
    kind: 'WAIT',
    next: 'CONSOLIDATE',
    title: 'Define → build (ISS plane)',
    narrative: 'A6–A9 turn intent into code; CI results flow in via Pass F.',
    fsmState: 'BUILD',
    exit: (db, run) => {
      if (!run.feature_node_id) return { ok: false, reason: 'no feature token' }
      if (run.rc_id) return { ok: true }
      const rc = db
        .prepare<[number], { rc_id: number }>(
          `
        SELECT DISTINCT ge2.to_node_id rc_id
        FROM feature_traces ft
        JOIN graph_edges ge  ON ge.from_node_id = ft.code_node_id AND ge.kind='PACKAGED_IN'
        JOIN graph_nodes b   ON b.id = ge.to_node_id AND b.kind='BUILD'
        JOIN graph_edges ge2 ON ge2.from_node_id = b.id AND ge2.kind='PACKAGED_IN'
        JOIN graph_nodes rc  ON rc.id = ge2.to_node_id AND rc.kind='RELEASE_CANDIDATE'
        WHERE ft.feature_node_id = ? LIMIT 1
      `,
        )
        .get(run.feature_node_id)
      if (rc) return { ok: true }
      // Fallback: feature→BUILD IMPLEMENTS from CicdIngester + any RC from that build
      const viaFeature = db
        .prepare<[number], { rc_id: number }>(
          `
        SELECT rc.id rc_id
        FROM graph_edges ge
        JOIN graph_nodes b ON b.id = ge.to_node_id AND b.kind='BUILD'
        JOIN graph_edges ge2 ON ge2.from_node_id = b.id AND ge2.kind='PACKAGED_IN'
        JOIN graph_nodes rc ON rc.id = ge2.to_node_id AND rc.kind='RELEASE_CANDIDATE'
        WHERE ge.from_node_id = ? AND ge.kind='IMPLEMENTS'
        LIMIT 1
      `,
        )
        .get(run.feature_node_id)
      return viaFeature
        ? { ok: true }
        : {
            ok: false,
            reason: 'no build containing traced code yet — push commits or simulate CI',
          }
    },
  },
  {
    id: 'CONSOLIDATE',
    kind: 'AUTO',
    next: 'RELEASE_GATE',
    title: 'A10 — readiness computed',
    narrative: '4-scope blast radius; approval set derived from organizational exposure.',
    fsmState: 'CONSOLIDATE',
    exit: (db, run) => {
      if (!run.readiness_report_id) return { ok: false, reason: 'report not yet produced' }
      if (!run.feature_node_id) return { ok: false, reason: 'no feature token' }
      const br = new BlastRadiusEngine(db).compute(run.feature_node_id, 'feature')
      if (br.scope2_gaps.length > 0) {
        return {
          ok: false,
          reason: `scope-2 gaps: ${br.scope2_gaps.length} untested files — bounce to BUILD`,
        }
      }
      return { ok: true }
    },
  },
  {
    id: 'RELEASE_GATE',
    kind: 'GATE',
    next: 'ROLLOUT',
    title: '★ Release approval (human, role-validated)',
    narrative:
      'Every role in the computed approval set signs. Compliance auto-added for governed code.',
    fsmState: 'CONSOLIDATE',
    exit: (db, run) => {
      if (!run.feature_node_id || !run.readiness_report_id) {
        return { ok: false, reason: 'no readiness report' }
      }
      const required = new BlastRadiusEngine(db).compute(run.feature_node_id, 'feature')
        .approvalSet
      if (required.length === 0) return { ok: true }
      const signed = db
        .prepare<[number], { role: string | null }>(
          `
        SELECT ap.approved_by_role AS role
        FROM graph_edges ge
        JOIN graph_nodes dr ON dr.id = ge.to_node_id AND dr.kind = 'DECISION_RECORD'
        LEFT JOIN artifact_provenance ap ON ap.artifact_node_id = dr.id
        WHERE ge.from_node_id = ? AND ge.kind = 'HAS_DECISION'
      `,
        )
        .all(run.feature_node_id)
        .map((r) => r.role ?? '')
        .filter(Boolean)
      const missing = required.filter((role) => !signed.includes(role))
      return missing.length === 0
        ? { ok: true }
        : { ok: false, reason: `awaiting signatures: ${missing.join(', ')}` }
    },
  },
  {
    id: 'ROLLOUT',
    kind: 'AUTO',
    next: 'OBSERVE',
    title: 'A11 — staged rollout',
    narrative:
      'Canary → gradual → full, guard metrics checked each stage. A11 may halt, never widen.',
    fsmState: 'RELEASE',
    exit: (_db, run) =>
      run.deployment_id ? { ok: true } : { ok: false, reason: 'deployment not yet recorded' },
  },
  {
    id: 'OBSERVE',
    kind: 'WAIT',
    next: 'LEARN',
    title: 'Observe — the bet meets reality',
    narrative: 'KPI observations accumulate over the pre-registered timeframe.',
    fsmState: 'OBSERVE',
    exit: (db, run) => {
      const scoped = db
        .prepare<[], { kpi_id: number; obs: number }>(
          `
        SELECT vh.kpi_node_id kpi_id,
               (SELECT COUNT(*) FROM graph_edges ge
                JOIN graph_nodes o ON o.id=ge.to_node_id AND o.kind='KPI_OBSERVATION'
                WHERE ge.from_node_id=vh.kpi_node_id AND ge.kind='OBSERVED_AS') obs
        FROM value_hypotheses vh
        JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
        WHERE vh.verdict_node_id IS NULL
      `,
        )
        .all()
      if (scoped.length === 0) return { ok: false, reason: 'no committed hypotheses to observe' }
      const starved = scoped.filter((r) => r.obs < 2)
      if (starved.length > 0) {
        return {
          ok: false,
          reason: `${starved.length} KPI(s) need ≥2 observations — wait or simulate`,
        }
      }
      if (run.mode === 'live') {
        const young = db
          .prepare<[], { c: number }>(
            `
          SELECT COUNT(*) c FROM value_hypotheses vh
          JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
          WHERE vh.verdict_node_id IS NULL
            AND (unixepoch()*1000 - vh.registered_at) < vh.timeframe_days * 86400000
        `,
          )
          .get()!.c
        if (young > 0) return { ok: false, reason: `${young} hypothesis timeframe(s) still running` }
      }
      return { ok: true }
    },
  },
  {
    id: 'LEARN',
    kind: 'AUTO',
    next: 'DONE',
    title: 'Pass G — verdict · impact · learning',
    narrative: 'A12 judges the bets, A13 projects per org unit, A14 wires learnings upstream.',
    fsmState: 'LEARN',
    exit: (_db, run) =>
      run.outcome_report_id
        ? { ok: true }
        : { ok: false, reason: 'Pass G not yet complete' },
  },
  {
    id: 'DONE',
    kind: 'TERMINAL',
    next: null,
    title: '↺ Cycle complete',
    narrative: 'Learnings inform the next cycle. Start the next bet with better priors.',
    fsmState: 'LEARN',
    exit: () => ({ ok: true }),
  },
]

export const stageById = (id: CycleStage): StageDef => {
  const s = STAGES.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown cycle stage: ${id}`)
  return s
}
