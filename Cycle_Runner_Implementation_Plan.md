# Cycle Runner — Sequential Value-Stream Implementation Plan
### Integrating a guided customer→learning sequence into RIAF Studio + AEP

> **Pre-conditions**: RIAF Studio core, ISS v2, and AEP/OVG (Parts 1 + 2) are implemented.
> All agents A1–A14, Passes D–G, the ValueStreamOrchestrator, Blackboard, HumanGateManager,
> and the aep:* IPC surface exist and work when invoked individually.
>
> **What this plan adds**: a *sequencing layer* — the Cycle Runner — that chains those
> pieces into one enforced, resumable, visually-guided journey per feature:
> signal → pain point → brief → assessments → portfolio gate → build → consolidation →
> release gate → rollout → observation → verdict → learning → next cycle.
>
> **What this plan does NOT do**: it does not reimplement any agent, pass, or gate.
> Every stage delegates to the existing module. The Cycle Runner is a conductor, not
> a second orchestra.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [What Exists vs. What Is New](#2-what-exists-vs-what-is-new)
3. [Architecture Overview](#3-architecture-overview)
4. [Schema V4 — Cycle Persistence](#4-schema-v4)
5. [The Canonical Stage Sequence](#5-the-canonical-stage-sequence)
6. [Backend — Stage Definitions](#6-backend--stage-definitions)
7. [Backend — CycleOrchestrator](#7-backend--cycleorchestrator)
8. [Backend — Demo Simulator](#8-backend--demo-simulator)
9. [Backend — IPC Surface](#9-backend--ipc-surface)
10. [Frontend — Cycle Store](#10-frontend--cycle-store)
11. [Frontend — CycleRunnerPanel](#11-frontend--cyclerunnerpanel)
12. [Integration Patch](#12-integration-patch)
13. [Demo Seed Data](#13-demo-seed-data)
14. [Milestones & Acceptance Gates](#14-milestones--acceptance-gates)
15. [Cursor Prompt Pack](#15-cursor-prompt-pack)

---

## 1. Design Principles

**P1 — Sequence-first UX.** The existing panels are workbenches: each exposes one layer
and assumes the user knows where they are in the process. The Cycle Runner inverts this:
the *process* is the primary object. The user sees a vertical stepper of 12 stages; exactly
one stage is active; everything before it is collapsed evidence; everything after it is
locked. Nobody has to remember what comes next — the app is the checklist.

**P2 — Wrapper, not rewrite.** Every stage action calls the same functions the
individual panels call (`A1IntakeAgent.run`, `executePortfolioGate`,
`A10ConsolidationAgent.run`, `PassGOrchestrator.run`, …). If a stage works in its panel,
it works in the runner. The runner adds ordering, prerequisite enforcement, persistence,
and narrative — nothing else.

**P3 — Suspendable by construction.** A real cycle spans weeks (BUILD) and months
(OBSERVE). The runner is therefore *not* one long async function. It is an event-driven
state machine persisted in `cycle_runs`: auto stages run immediately on entry; wait
stages park with status `waiting_external` and are advanced by the existing 30-second
blackboard tick when their exit predicate becomes true; gate stages park with
`waiting_gate` and advance only on a human IPC action. Kill the app at any stage;
on restart, `resumeAll()` re-hydrates every run exactly where it stopped.

**P4 — The FSM stays the single source of truth.** The runner never writes
`value_stream_state` directly except through the same code paths the FSM already uses
(`executePortfolioGate`, deployment ingestion, Pass G). Runner stage and FSM state are
kept consistent by mapping, not duplication — see the mapping column in Section 5.

**P5 — Demo mode is first-class.** A full live cycle takes weeks. A full demo cycle
must take under ten minutes. Every wait stage gets a `simulate` affordance (visible only
when the run's mode is `demo`) that injects realistic synthetic events through the SAME
ingestion paths real events use: `simulateCI` posts a fake GitHub Actions payload into
`CICDIngester`, `simulateKpi` calls `KPIObservationIngester.recordManual`. Simulated data
is real data with a `demo` provenance tag — the pipeline downstream cannot tell the
difference, which is exactly the point.

---

## 2. What Exists vs. What Is New

| Concern | Existing module (do not modify) | Cycle Runner addition |
|---|---|---|
| Signal ingestion | `CustomerSignalIngester`, `PainPointClusterer` | Stage 0/1 wraps them; seeds demo CSV |
| Intake brief | `A1IntakeAgent` | Stage 2 auto-runs it, stores `brief_id` on the run |
| Assessments | `A2`, `A3`, `A4` agents | Stage 3 runs A2‖A4 in parallel, then A3; stores IDs |
| Portfolio packet | `A5PortfolioAgent` | Stage 4 auto-runs on entry |
| Portfolio gate | `executePortfolioGate`, `HypothesisRegistry` | Stage 5 renders the gate form; delegates decision |
| Build tracking | Pass F ingesters, feature_traces | Stage 6 is a wait stage; shows live trace/build counts |
| Readiness | `A10ConsolidationAgent`, `BlastRadiusEngine` | Stage 7 auto-runs A10 when RC predicate true |
| Release gate | `HumanGateManager` | Stage 8 renders role-signature form; delegates |
| Rollout | `A11DeploymentAgent`, `DeploymentIngester` | Stage 9 executes plan; surfaces halt events |
| Observation | `KPIObservationIngester` | Stage 10 wait stage; manual/simulated KPI entry |
| Verdict→Learning | `PassGOrchestrator` (A12→A13→A14) | Stage 11 auto-runs when observation predicate true |
| FSM | `ValueStreamOrchestrator`, `Blackboard` | Tick handler extended by ONE call: `cycleOrch.handleTick()` |
| Gates registry | `agent_capabilities`, `artifact_provenance` | Unchanged; runner reads for display |

**New files: 9 backend + 5 renderer + 3 seed-data. Modified existing files: 3 (all additive).**

---

## 3. Architecture Overview

```
┌────────────────────────────  RENDERER  ────────────────────────────┐
│  CycleRunnerPanel                                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ RunHeaderBar   (run selector · mode badge · abort)           │  │
│  │ StageStepper   (12 StageCards, one active)                   │  │
│  │   StageCard    → AgentProgress | GateForm | WaitCard          │  │
│  │ TimelineStrip  (cycle_stage_log, newest first)                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  cycle.store.ts (Zustand)  ← cycle:update / aep:passProgress push │
└──────────────────────────────┬─────────────────────────────────────┘
                        cycle:* IPC channels
┌──────────────────────────────┴─────────────────────────────────────┐
│  MAIN                                                              │
│  CycleOrchestrator ──┬── stageDefinitions.ts (the sequence spec)   │
│    startCycle        ├── prerequisites.ts    (predicate + reason)  │
│    advance           ├── demoSimulator.ts    (synthetic events)    │
│    approveGate       └── delegates to: A1..A14, Pass E/F/G,        │
│    handleTick             executePortfolioGate, HumanGateManager   │
│    resumeAll                                                        │
│  Persistence: cycle_runs · cycle_stage_log  (Schema V4)            │
│  Hook: AEPOrchestrator blackboard tick → cycleOrch.handleTick()    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Schema V4

```typescript
// packages/main/src/db/schema.ts — append SCHEMA_V4; register in migrations.ts

export const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS cycle_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  label               TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'live' CHECK(mode IN ('live','demo')),
  current_stage       TEXT NOT NULL DEFAULT 'SIGNALS',
  status              TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','waiting_gate','waiting_external','completed','aborted','error')),
  error               TEXT,
  -- accumulated artifact anchors (filled as stages complete)
  pain_point_ids_json TEXT,
  feature_node_id     INTEGER REFERENCES graph_nodes(id),
  brief_id            INTEGER REFERENCES graph_nodes(id),
  biz_assess_id       INTEGER REFERENCES graph_nodes(id),
  dev_assess_id       INTEGER REFERENCES graph_nodes(id),
  gtm_assess_id       INTEGER REFERENCES graph_nodes(id),
  packet_id           INTEGER REFERENCES graph_nodes(id),
  readiness_report_id INTEGER REFERENCES graph_nodes(id),
  rc_id               INTEGER REFERENCES graph_nodes(id),
  deployment_id       INTEGER REFERENCES graph_nodes(id),
  outcome_report_id   INTEGER REFERENCES graph_nodes(id),
  created_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_cr_status ON cycle_runs(status);

CREATE TABLE IF NOT EXISTS cycle_stage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES cycle_runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  event       TEXT NOT NULL
    CHECK(event IN ('entered','agent_started','agent_finished','gate_approved',
                    'gate_rejected','simulated','advanced','bounced','halted','error')),
  agent_id    TEXT,
  artifact_node_id INTEGER REFERENCES graph_nodes(id),
  detail_json TEXT,
  ts          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_csl_run ON cycle_stage_log(run_id, ts);

UPDATE schema_version SET version = 4;
`
```

---

## 5. The Canonical Stage Sequence

This table is the specification. `stageDefinitions.ts` is its direct transcription;
the StageStepper renders it; acceptance tests assert it. Twelve stages, three kinds:

- **AUTO** — agent(s) run immediately on entry; advance when exit predicate true
- **WAIT** — external reality must happen; blackboard tick advances; demo mode may simulate
- **GATE** — human decision required; only the gate IPC advances

| # | Stage id | Kind | FSM state | Entry action (delegates to) | Exit predicate | Bounce path |
|---|---|---|---|---|---|---|
| 0 | `SIGNALS` | WAIT | — | none (user ingests via form, or `simulateSignals`) | ≥ N unclustered CUSTOMER_SIGNALs (N=5 demo, 20 live) | — |
| 1 | `CLUSTER` | AUTO | — | `PainPointClusterer.cluster()` | ≥ 1 PAIN_POINT exists | — |
| 2 | `INTAKE` | AUTO | INTAKE | `A1IntakeAgent.run(painPointIds)` → brief_id | BRIEF node exists for run | — |
| 3 | `QUALIFY` | AUTO | QUALIFY | `Promise.all([A2.run(brief), A4.run(brief)])` then `A3.run(bizAssess)` | biz ∧ dev assessments exist | — |
| 4 | `PACKET` | AUTO | PRIORITIZE | `A5.assemblePacket(brief, biz, dev)` → packet_id | PORTFOLIO packet exists | — |
| 5 | `PORTFOLIO_GATE` | GATE | PRIORITIZE★ | render packet + hypothesis list; on approve → `executePortfolioGate({admit})` | DECISION_RECORD(admit) exists | defer→SIGNALS · reject→terminal `aborted` |
| 6 | `BUILD` | WAIT | DEFINE→BUILD | none (dev work; A6–A9 via RIAF panel; Pass F ingests CI) · demo: `simulateCI` | RC has ≥1 PACKAGED_IN edge for feature's traced files | — |
| 7 | `CONSOLIDATE` | AUTO | CONSOLIDATE | `A10.run(rcId)` → readiness_report_id + blast radius | report exists ∧ ready:true ∧ scope2_gaps=∅ | gaps → bounce to `BUILD` (log `bounced`) |
| 8 | `RELEASE_GATE` | GATE | CONSOLIDATE★ | render approval set from report; each signature → `HumanGateManager.approve` | every role in approvalSet has DECISION_RECORD | — |
| 9 | `ROLLOUT` | AUTO | RELEASE | `A11.executeRollout(plan, reportId, role)` → deployment_id | DEPLOYMENT node exists | guard breach → status stays, log `halted`, surface INCIDENT; user may bounce to `BUILD` |
| 10 | `OBSERVE` | WAIT | OBSERVE | none (KPI snapshots accrue) · demo: `simulateKpi(kpiId, value)` ×n | every committed hypothesis has ≥2 KPI_OBSERVATIONs in window ∧ timeframe elapsed (demo: timeframe waived) | — |
| 11 | `LEARN` | AUTO | LEARN | `PassGOrchestrator.run(deploymentId)` (A12→A13→A14) → outcome_report_id | ≥1 HYPOTHESIS_VERDICT ∧ ≥1 LEARNING for cycle | refuted → offer "iterate: bounce to BUILD" or complete |
| — | `DONE` | terminal | LEARN↺ | mark run `completed`; surface "Start next cycle" seeded with INFORMS context | — | — |

**Sequencing invariants the runner enforces (and tests assert):**

1. A stage's entry action never fires unless the previous stage's exit predicate is true.
2. GATE stages are un-skippable except via explicit `forceAdvance`, which writes a
   DECISION_RECORD with a mandatory reason (reuses the existing FSM override).
3. Artifact anchors (`brief_id` … `outcome_report_id`) are written to `cycle_runs`
   the moment they exist, so the golden thread for a run is one row read.
4. Every transition, agent start/finish, gate action, simulation, bounce, and halt is a
   `cycle_stage_log` row — the timeline strip is a table scan, not reconstruction.

---

## 6. Backend — Stage Definitions

```typescript
// packages/main/src/cycle/stageDefinitions.ts
import type Database from 'better-sqlite3'

export type CycleStage =
  | 'SIGNALS' | 'CLUSTER' | 'INTAKE' | 'QUALIFY' | 'PACKET'
  | 'PORTFOLIO_GATE' | 'BUILD' | 'CONSOLIDATE' | 'RELEASE_GATE'
  | 'ROLLOUT' | 'OBSERVE' | 'LEARN' | 'DONE'

export type StageKind = 'AUTO' | 'WAIT' | 'GATE' | 'TERMINAL'

export type CycleRunRow = {
  id: number; label: string; mode: 'live' | 'demo'
  current_stage: CycleStage; status: string
  pain_point_ids_json: string | null
  feature_node_id: number | null; brief_id: number | null
  biz_assess_id: number | null; dev_assess_id: number | null
  gtm_assess_id: number | null; packet_id: number | null
  readiness_report_id: number | null; rc_id: number | null
  deployment_id: number | null; outcome_report_id: number | null
}

export type StageDef = {
  id:        CycleStage
  kind:      StageKind
  next:      CycleStage | null
  title:     string
  narrative: string          // one sentence shown under the title in the stepper
  fsmState:  string | null   // value_stream_state this stage corresponds to
  // Exit predicate. Returns { ok } or { ok:false, reason } for the UI.
  exit: (db: Database.Database, run: CycleRunRow) =>
    { ok: true } | { ok: false; reason: string }
}

const DEMO_SIGNAL_MIN = 5
const LIVE_SIGNAL_MIN = 20

export const STAGES: StageDef[] = [
  {
    id: 'SIGNALS', kind: 'WAIT', next: 'CLUSTER',
    title: 'Ingest customer signals',
    narrative: 'Raw customer voice enters the graph as immutable evidence.',
    fsmState: null,
    exit: (db, run) => {
      const min = run.mode === 'demo' ? DEMO_SIGNAL_MIN : LIVE_SIGNAL_MIN
      const n = db.prepare<[], { c: number }>(
        `SELECT COUNT(*) c FROM graph_nodes WHERE kind='CUSTOMER_SIGNAL'
         AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind='EXPRESSES')`
      ).get()!.c
      return n >= min ? { ok: true }
        : { ok: false, reason: `${n}/${min} unclustered signals — ingest more or simulate` }
    },
  },
  {
    id: 'CLUSTER', kind: 'AUTO', next: 'INTAKE',
    title: 'Cluster into pain points',
    narrative: 'Signals are deduplicated into named, countable problems.',
    fsmState: null,
    exit: (db) => {
      const n = db.prepare<[], { c: number }>(
        `SELECT COUNT(*) c FROM graph_nodes WHERE kind='PAIN_POINT'`
      ).get()!.c
      return n >= 1 ? { ok: true } : { ok: false, reason: 'no pain points synthesized yet' }
    },
  },
  {
    id: 'INTAKE', kind: 'AUTO', next: 'QUALIFY',
    title: 'A1 — intake brief',
    narrative: 'Pain points become a classified, deduplicated brief.',
    fsmState: 'INTAKE',
    exit: (_db, run) =>
      run.brief_id ? { ok: true } : { ok: false, reason: 'BRIEF not yet written' },
  },
  {
    id: 'QUALIFY', kind: 'AUTO', next: 'PACKET',
    title: 'A2 ∥ A4 → A3 — assessments',
    narrative: 'Business value and engineering cost estimated in parallel; GTM projection follows.',
    fsmState: 'QUALIFY',
    exit: (_db, run) =>
      run.biz_assess_id && run.dev_assess_id
        ? { ok: true }
        : { ok: false, reason: 'waiting for business ∧ dev assessments' },
  },
  {
    id: 'PACKET', kind: 'AUTO', next: 'PORTFOLIO_GATE',
    title: 'A5 — portfolio packet',
    narrative: 'Evidence assembled for the human forum. A5 prepares; it never decides.',
    fsmState: 'PRIORITIZE',
    exit: (_db, run) =>
      run.packet_id ? { ok: true } : { ok: false, reason: 'packet not yet assembled' },
  },
  {
    id: 'PORTFOLIO_GATE', kind: 'GATE', next: 'BUILD',
    title: '★ Portfolio admission (human)',
    narrative: 'Admit / defer / reject. On admit, hypotheses are committed — locked before code.',
    fsmState: 'PRIORITIZE',
    exit: (db, run) => {
      if (!run.feature_node_id) return { ok: false, reason: 'awaiting gate decision' }
      const st = db.prepare<[number], { s: string }>(
        `SELECT stream_state s FROM value_stream_state WHERE feature_node_id=?`
      ).get(run.feature_node_id)
      return st && (st.s === 'DEFINE' || st.s === 'BUILD')
        ? { ok: true } : { ok: false, reason: 'awaiting gate decision' }
    },
  },
  {
    id: 'BUILD', kind: 'WAIT', next: 'CONSOLIDATE',
    title: 'Define → build (ISS plane)',
    narrative: 'A6–A9 turn intent into code; CI results flow in via Pass F.',
    fsmState: 'BUILD',
    exit: (db, run) => {
      if (!run.feature_node_id) return { ok: false, reason: 'no feature token' }
      const rc = db.prepare<[number], { rc_id: number }>(`
        SELECT DISTINCT ge2.to_node_id rc_id
        FROM feature_traces ft
        JOIN graph_edges ge  ON ge.from_node_id = ft.code_node_id AND ge.kind='PACKAGED_IN'
        JOIN graph_nodes b   ON b.id = ge.to_node_id AND b.kind='BUILD'
        JOIN graph_edges ge2 ON ge2.from_node_id = b.id AND ge2.kind='PACKAGED_IN'
        WHERE ft.feature_node_id = ? LIMIT 1
      `).get(run.feature_node_id)
      return rc ? { ok: true }
        : { ok: false, reason: 'no build containing traced code yet — push commits or simulate CI' }
    },
  },
  {
    id: 'CONSOLIDATE', kind: 'AUTO', next: 'RELEASE_GATE',
    title: 'A10 — readiness computed',
    narrative: '4-scope blast radius; approval set derived from organizational exposure.',
    fsmState: 'CONSOLIDATE',
    exit: (db, run) => {
      if (!run.readiness_report_id) return { ok: false, reason: 'report not yet produced' }
      const r = db.prepare<[number], { d: string }>(
        `SELECT description d FROM graph_nodes WHERE id=?`
      ).get(run.readiness_report_id)
      try {
        const rep = JSON.parse(r!.d) as { assessment?: { ready?: boolean }, blastRadius?: { scope2_gaps?: string[] } }
        if ((rep.blastRadius?.scope2_gaps?.length ?? 0) > 0)
          return { ok: false, reason: `scope-2 gaps: ${rep.blastRadius!.scope2_gaps!.length} untested files — bounce to BUILD` }
        return rep.assessment?.ready ? { ok: true }
          : { ok: false, reason: 'A10 assessed not-ready — see blocking issues' }
      } catch { return { ok: false, reason: 'report unreadable' } }
    },
  },
  {
    id: 'RELEASE_GATE', kind: 'GATE', next: 'ROLLOUT',
    title: '★ Release approval (human, role-validated)',
    narrative: 'Every role in the computed approval set signs. Compliance auto-added for governed code.',
    fsmState: 'CONSOLIDATE',
    exit: (db, run) => {
      if (!run.readiness_report_id) return { ok: false, reason: 'no readiness report' }
      const r = db.prepare<[number], { d: string }>(
        `SELECT description d FROM graph_nodes WHERE id=?`).get(run.readiness_report_id)!
      let required: string[] = []
      try { required = (JSON.parse(r.d) as { approvalSet?: string[] }).approvalSet ?? [] }
      catch { return { ok: false, reason: 'report unreadable' } }
      const signed = db.prepare<[number], { d: string }>(`
        SELECT dr.description d FROM graph_edges ge
        JOIN graph_nodes dr ON dr.id=ge.to_node_id AND dr.kind='DECISION_RECORD'
        WHERE ge.from_node_id=? AND ge.kind='JUSTIFIED_BY'
      `).all(run.readiness_report_id).map(x => {
        try { return (JSON.parse(x.d) as { approvedByRole?: string }).approvedByRole ?? '' }
        catch { return '' }
      })
      const missing = required.filter(role => !signed.includes(role))
      return missing.length === 0 ? { ok: true }
        : { ok: false, reason: `awaiting signatures: ${missing.join(', ')}` }
    },
  },
  {
    id: 'ROLLOUT', kind: 'AUTO', next: 'OBSERVE',
    title: 'A11 — staged rollout',
    narrative: 'Canary → gradual → full, guard metrics checked each stage. A11 may halt, never widen.',
    fsmState: 'RELEASE',
    exit: (_db, run) =>
      run.deployment_id ? { ok: true } : { ok: false, reason: 'deployment not yet recorded' },
  },
  {
    id: 'OBSERVE', kind: 'WAIT', next: 'LEARN',
    title: 'Observe — the bet meets reality',
    narrative: 'KPI observations accumulate over the pre-registered timeframe.',
    fsmState: 'OBSERVE',
    exit: (db, run) => {
      const rows = db.prepare<[], { kpi_id: number; obs: number }>(`
        SELECT vh.kpi_node_id kpi_id,
               (SELECT COUNT(*) FROM graph_edges ge
                JOIN graph_nodes o ON o.id=ge.to_node_id AND o.kind='KPI_OBSERVATION'
                WHERE ge.from_node_id=vh.kpi_node_id AND ge.kind='OBSERVED_AS') obs
        FROM value_hypotheses vh
        JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
        WHERE vh.verdict_node_id IS NULL
      `).all()
      if (rows.length === 0) return { ok: false, reason: 'no committed hypotheses to observe' }
      const starved = rows.filter(r => r.obs < 2)
      if (starved.length > 0)
        return { ok: false, reason: `${starved.length} KPI(s) need ≥2 observations — wait or simulate` }
      // live mode also requires timeframe elapsed; demo waives it
      if (run.mode === 'live') {
        const young = db.prepare<[], { c: number }>(`
          SELECT COUNT(*) c FROM value_hypotheses vh
          JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
          WHERE vh.verdict_node_id IS NULL
            AND (unixepoch()*1000 - vh.registered_at) < vh.timeframe_days * 86400000
        `).get()!.c
        if (young > 0) return { ok: false, reason: `${young} hypothesis timeframe(s) still running` }
      }
      return { ok: true }
    },
  },
  {
    id: 'LEARN', kind: 'AUTO', next: 'DONE',
    title: 'Pass G — verdict · impact · learning',
    narrative: 'A12 judges the bets, A13 projects per org unit, A14 wires learnings upstream.',
    fsmState: 'LEARN',
    exit: (db, run) =>
      run.outcome_report_id ? { ok: true } : { ok: false, reason: 'Pass G not yet complete' },
  },
  {
    id: 'DONE', kind: 'TERMINAL', next: null,
    title: '↺ Cycle complete',
    narrative: 'Learnings inform the next cycle. Start the next bet with better priors.',
    fsmState: 'LEARN',
    exit: () => ({ ok: true }),
  },
]

export const stageById = (id: CycleStage): StageDef =>
  STAGES.find(s => s.id === id)!
```

---

## 7. Backend — CycleOrchestrator

```typescript
// packages/main/src/cycle/cycleOrchestrator.ts
// The conductor. Event-driven: advance() is idempotent and safe to call from
// (a) stage completion, (b) the blackboard tick, (c) gate approval, (d) resumeAll.
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { STAGES, stageById, type CycleStage, type CycleRunRow } from './stageDefinitions'
import { PainPointClusterer }     from '../aep/upstream/passE/painPointClusterer'
import { A1IntakeAgent }          from '../aep/upstream/agents/a1IntakeAgent'
import { A2BusinessImpactAgent }  from '../aep/upstream/agents/a2BusinessImpactAgent'
import { A3GtmAlignmentAgent }    from '../aep/upstream/agents/a3GtmAlignmentAgent'
import { A4DevImpactAgent }       from '../aep/upstream/agents/a4DevImpactAgent'
import { A5PortfolioAgent }       from '../aep/upstream/agents/a5PortfolioAgent'
import { executePortfolioGate }   from '../aep/upstream/portfolioGate'
import { A10ConsolidationAgent }  from '../aep/downstream/agents/a10ConsolidationAgent'
import { A11DeploymentAgent }     from '../aep/downstream/agents/a11DeploymentAgent'
import { PassGOrchestrator }      from '../aep/downstream/passG/passGOrchestrator'
import { HumanGateManager }       from '../aep/governance/humanGateManager'

export class CycleOrchestrator {
  constructor(
    private readonly db:          Database.Database,
    private readonly win:         BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────────────
  startCycle(input: { label: string; mode: 'live' | 'demo'; painPointIds?: number[] }): number {
    const r = this.db.prepare(`
      INSERT INTO cycle_runs (label, mode, current_stage, status, pain_point_ids_json)
      VALUES (?, ?, 'SIGNALS', 'running', ?)
    `).run(input.label, input.mode, JSON.stringify(input.painPointIds ?? []))
    const runId = Number(r.lastInsertRowid)
    this.log(runId, 'SIGNALS', 'entered')
    // If pain points were pre-selected, we can fast-forward past SIGNALS/CLUSTER.
    void this.advance(runId)
    return runId
  }

  resumeAll(): void {
    const open = this.db.prepare<[], { id: number }>(
      `SELECT id FROM cycle_runs WHERE status IN ('running','waiting_external','waiting_gate')`
    ).all()
    for (const { id } of open) void this.advance(id)
  }

  /** Hooked into the existing 30 s blackboard tick — costs one predicate check per waiting run. */
  handleTick(): void {
    const waiting = this.db.prepare<[], { id: number }>(
      `SELECT id FROM cycle_runs WHERE status = 'waiting_external'`
    ).all()
    for (const { id } of waiting) void this.advance(id)
  }

  // ── the core loop ──────────────────────────────────────────────────────────
  /** Advance a run as far as it can go right now. Idempotent; re-entrant safe
   *  because each step re-reads the row and checks predicates before acting. */
  async advance(runId: number): Promise<void> {
    for (let guard = 0; guard < STAGES.length + 2; guard++) {
      const run = this.getRun(runId)
      if (!run || ['completed', 'aborted', 'error'].includes(run.status)) return

      const def = stageById(run.current_stage)

      // 1. If current stage's exit predicate holds → move to next stage
      const exit = def.exit(this.db, run)
      if (exit.ok) {
        if (def.kind === 'TERMINAL' || !def.next) {
          this.setStatus(runId, 'completed')
          this.push(runId)
          return
        }
        this.setStage(runId, def.next)
        this.log(runId, def.next, 'entered')
        continue  // fall through to run the new stage's entry action
      }

      // 2. Exit not satisfied — behave per stage kind
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

      // 3. AUTO stage whose exit is unmet → its entry action hasn't produced
      //    the artifact yet. Run it exactly once (artifact anchors make this
      //    idempotent: if the anchor is set, skip execution and re-check).
      try {
        const acted = await this.runEntryAction(run)
        if (!acted) {
          // Entry action already done but predicate still false → genuine block.
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

  /** Executes the entry action for the run's current AUTO stage.
   *  Returns false if the action's artifact anchor already exists (nothing to do). */
  private async runEntryAction(run: CycleRunRow): Promise<boolean> {
    const provider = this.getProvider()
    const set = (col: string, val: number) =>
      this.db.prepare(`UPDATE cycle_runs SET ${col}=?, updated_at=unixepoch()*1000 WHERE id=?`)
        .run(val, run.id)

    switch (run.current_stage) {
      case 'CLUSTER': {
        this.log(run.id, 'CLUSTER', 'agent_started', { agent: 'clusterer' })
        const n = await new PainPointClusterer(this.db, provider)
          .cluster((pct, detail) => this.progress(run.id, 'CLUSTER', pct, detail))
        this.log(run.id, 'CLUSTER', 'agent_finished', { detail: `${n} pain points` })
        return true
      }
      case 'INTAKE': {
        if (run.brief_id) return false
        const ppIds: number[] = JSON.parse(run.pain_point_ids_json ?? '[]')
        const ids = ppIds.length > 0 ? ppIds : this.topPainPoints(3)
        this.log(run.id, 'INTAKE', 'agent_started', { agent: 'A1' })
        const briefId = await new A1IntakeAgent(this.db, provider).run(ids)
        set('brief_id', briefId)
        this.log(run.id, 'INTAKE', 'agent_finished', { agent: 'A1', artifact: briefId })
        return true
      }
      case 'QUALIFY': {
        if (run.biz_assess_id && run.dev_assess_id) return false
        this.log(run.id, 'QUALIFY', 'agent_started', { agent: 'A2‖A4' })
        const [a2, devId] = await Promise.all([
          new A2BusinessImpactAgent(this.db, provider).run(run.brief_id!),
          new A4DevImpactAgent(this.db, provider).run(run.brief_id!),
        ])
        set('biz_assess_id', a2.assessmentId)
        set('dev_assess_id', devId)
        this.log(run.id, 'QUALIFY', 'agent_finished', { agent: 'A2‖A4' })
        // A3 depends on A2 — strictly after
        const gtmId = await new A3GtmAlignmentAgent(this.db, provider).run(a2.assessmentId)
        set('gtm_assess_id', gtmId)
        this.log(run.id, 'QUALIFY', 'agent_finished', { agent: 'A3', artifact: gtmId })
        return true
      }
      case 'PACKET': {
        if (run.packet_id) return false
        this.log(run.id, 'PACKET', 'agent_started', { agent: 'A5' })
        const packetId = await new A5PortfolioAgent(this.db, provider)
          .assemblePacket(run.brief_id!, run.biz_assess_id!, run.dev_assess_id!)
        set('packet_id', packetId)
        this.log(run.id, 'PACKET', 'agent_finished', { agent: 'A5', artifact: packetId })
        return true
      }
      case 'CONSOLIDATE': {
        if (run.readiness_report_id) {
          // Report exists but predicate false → scope-2 gaps or not-ready → bounce
          this.bounce(run.id, 'BUILD', 'scope-2 gaps or not-ready — returning to BUILD')
          return true
        }
        const rcId = run.rc_id ?? this.findRcForRun(run)
        if (!rcId) throw new Error('no release candidate found for this run')
        set('rc_id', rcId)
        this.log(run.id, 'CONSOLIDATE', 'agent_started', { agent: 'A10' })
        const reportId = await new A10ConsolidationAgent(this.db, provider).run(rcId)
        set('readiness_report_id', reportId)
        this.log(run.id, 'CONSOLIDATE', 'agent_finished', { agent: 'A10', artifact: reportId })
        return true
      }
      case 'ROLLOUT': {
        if (run.deployment_id) return false
        this.log(run.id, 'ROLLOUT', 'agent_started', { agent: 'A11' })
        await new A11DeploymentAgent(this.db).executeRollout(
          this.defaultRolloutPlan(run),
          run.readiness_report_id!,
          'Engineering Lead',
        )
        const dep = this.db.prepare<[], { id: number }>(
          `SELECT id FROM graph_nodes WHERE kind='DEPLOYMENT' ORDER BY created_at DESC LIMIT 1`
        ).get()
        if (dep) set('deployment_id', dep.id)
        this.log(run.id, 'ROLLOUT', 'agent_finished', { agent: 'A11', artifact: dep?.id })
        return true
      }
      case 'LEARN': {
        if (run.outcome_report_id) return false
        this.log(run.id, 'LEARN', 'agent_started', { agent: 'A12→A13→A14' })
        await new PassGOrchestrator(this.db, this.win, this.getProvider).run(run.deployment_id!)
        const rep = this.db.prepare<[], { id: number }>(
          `SELECT id FROM graph_nodes WHERE kind='OUTCOME_REPORT' ORDER BY created_at DESC LIMIT 1`
        ).get()
        if (rep) set('outcome_report_id', rep.id)
        this.log(run.id, 'LEARN', 'agent_finished', { artifact: rep?.id })
        return true
      }
      default:
        return false   // WAIT / GATE / SIGNALS / DONE have no entry action
    }
  }

  // ── gates ──────────────────────────────────────────────────────────────────
  async approvePortfolioGate(runId: number, input: {
    decision: 'admit' | 'defer' | 'reject'
    approvedByRole: string; rationale: string
    featureNodeId: number
    advancesObjectiveId?: number; fundedByInvestmentId?: number
  }): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.current_stage !== 'PORTFOLIO_GATE') throw new Error('run not at portfolio gate')
    executePortfolioGate(this.db, {
      featureNodeId: input.featureNodeId,
      portfolioPacketId: run.packet_id!,
      decision: input.decision,
      approvedByRole: input.approvedByRole,
      rationale: input.rationale,
      advancesObjectiveId: input.advancesObjectiveId,
      fundedByInvestmentId: input.fundedByInvestmentId,
    })
    this.db.prepare(`UPDATE cycle_runs SET feature_node_id=? WHERE id=?`)
      .run(input.featureNodeId, runId)
    this.log(runId, 'PORTFOLIO_GATE',
      input.decision === 'admit' ? 'gate_approved' : 'gate_rejected',
      { role: input.approvedByRole, decision: input.decision })
    if (input.decision === 'reject') { this.setStatus(runId, 'aborted'); this.push(runId); return }
    if (input.decision === 'defer')  { this.setStage(runId, 'SIGNALS'); this.push(runId); return }
    await this.advance(runId)
  }

  async signReleaseGate(runId: number, role: string, rationale: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.current_stage !== 'RELEASE_GATE') throw new Error('run not at release gate')
    new HumanGateManager(this.db).approve(
      'RELEASE_APPROVE', role, run.readiness_report_id!, rationale)
    this.log(runId, 'RELEASE_GATE', 'gate_approved', { role })
    await this.advance(runId)   // advances only when ALL roles have signed
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  getRun(id: number): CycleRunRow | undefined {
    return this.db.prepare(`SELECT * FROM cycle_runs WHERE id=?`).get(id) as CycleRunRow | undefined
  }

  getTimeline(runId: number) {
    return this.db.prepare(
      `SELECT stage, event, agent_id, artifact_node_id, detail_json, ts
       FROM cycle_stage_log WHERE run_id=? ORDER BY ts DESC LIMIT 200`
    ).all(runId)
  }

  private bounce(runId: number, to: CycleStage, reason: string): void {
    this.log(runId, to, 'bounced', { reason })
    // clear the stale readiness report so CONSOLIDATE re-runs after the fix
    this.db.prepare(`UPDATE cycle_runs SET readiness_report_id=NULL, current_stage=?, status='running' WHERE id=?`)
      .run(to, runId)
    this.push(runId)
  }

  private topPainPoints(n: number): number[] {
    return this.db.prepare<[number], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind='PAIN_POINT' ORDER BY importance_score DESC LIMIT ?`
    ).all(n).map(r => r.id)
  }

  private findRcForRun(run: CycleRunRow): number | null {
    const rc = this.db.prepare<[number], { id: number }>(`
      SELECT DISTINCT ge2.to_node_id id
      FROM feature_traces ft
      JOIN graph_edges ge  ON ge.from_node_id=ft.code_node_id AND ge.kind='PACKAGED_IN'
      JOIN graph_nodes b   ON b.id=ge.to_node_id AND b.kind='BUILD'
      JOIN graph_edges ge2 ON ge2.from_node_id=b.id AND ge2.kind='PACKAGED_IN'
      JOIN graph_nodes rc  ON rc.id=ge2.to_node_id AND rc.kind='RELEASE_CANDIDATE'
      WHERE ft.feature_node_id=? LIMIT 1
    `).get(run.feature_node_id!) as { id: number } | undefined
    return rc?.id ?? null
  }

  private defaultRolloutPlan(run: CycleRunRow) {
    const guards = this.db.prepare<[], { id: number }>(
      `SELECT kpi_node_id id FROM value_hypotheses vh
       JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
       LIMIT 3`
    ).all()
    return {
      releaseCandidateId: run.rc_id!,
      strategy: 'canary' as const,
      stages: run.mode === 'demo'
        ? [{ pct: 100, durationMs: 0, environment: 'production' }]
        : [
            { pct: 5,   durationMs: 3600_000,  environment: 'production' },
            { pct: 50,  durationMs: 21600_000, environment: 'production' },
            { pct: 100, durationMs: 0,         environment: 'production' },
          ],
      guardMetrics: guards.map(g => ({ kpiNodeId: g.id, maxDeltaPct: 20 })),
    }
  }

  private setStage(runId: number, stage: CycleStage): void {
    this.db.prepare(
      `UPDATE cycle_runs SET current_stage=?, status='running', error=NULL, updated_at=unixepoch()*1000 WHERE id=?`
    ).run(stage, runId)
  }
  private setStatus(runId: number, status: string, error?: string): void {
    this.db.prepare(
      `UPDATE cycle_runs SET status=?, error=?, updated_at=unixepoch()*1000 WHERE id=?`
    ).run(status, error ?? null, runId)
  }
  private log(runId: number, stage: string, event: string,
              d?: { agent?: string; artifact?: number; detail?: string; role?: string; decision?: string; reason?: string }): void {
    this.db.prepare(`
      INSERT INTO cycle_stage_log (run_id, stage, event, agent_id, artifact_node_id, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, stage, event, d?.agent ?? null, d?.artifact ?? null,
           d ? JSON.stringify(d) : null)
  }
  private progress(runId: number, stage: string, pct: number, detail: string): void {
    this.win.webContents.send('cycle:progress', { runId, stage, pct, detail })
  }
  private push(runId: number): void {
    const run = this.getRun(runId)
    this.win.webContents.send('cycle:update', run)
  }
}
```

---

## 8. Backend — Demo Simulator

```typescript
// packages/main/src/cycle/demoSimulator.ts
// Injects synthetic events through the SAME ingestion paths real events use.
// Only callable when the run's mode is 'demo' (enforced here AND in the IPC layer).
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { CustomerSignalIngester }   from '../aep/upstream/passE/customerSignalIngester'
import { CICDIngester }             from '../aep/downstream/passF/cicdIngester'
import { KPIObservationIngester }   from '../aep/downstream/passF/kpiObservationIngester'

export class DemoSimulator {
  constructor(private readonly db: Database.Database) {}

  private assertDemo(runId: number): void {
    const r = this.db.prepare<[number], { mode: string }>(
      `SELECT mode FROM cycle_runs WHERE id=?`).get(runId)
    if (r?.mode !== 'demo') throw new Error('simulation is only allowed on demo runs')
  }

  /** Stage 0: load the bundled sample signal CSV (fleet dispute scenario). */
  simulateSignals(runId: number): number {
    this.assertDemo(runId)
    const fp = path.join(app.getAppPath(), 'resources', 'demo', 'sample_signals.csv')
    const csv = fs.readFileSync(fp, 'utf8')
    return new CustomerSignalIngester(this.db).ingest('csv', csv)
  }

  /** Stage 6: fabricate a GitHub-Actions-shaped build event whose commit
   *  "touches" the feature's traced files (we write PACKAGED_IN directly since
   *  no real git commit exists in demo mode — provenance is tagged demo). */
  async simulateCI(runId: number): Promise<void> {
    this.assertDemo(runId)
    const run = this.db.prepare<[number], { feature_node_id: number | null }>(
      `SELECT feature_node_id FROM cycle_runs WHERE id=?`).get(runId)
    if (!run?.feature_node_id) throw new Error('no feature token yet — pass the portfolio gate first')

    const ing = new CICDIngester(this.db)
    const buildId = await ing.ingestBuild({
      provider: 'generic', buildId: `demo-${Date.now()}`,
      commitSha: 'demo', branchName: 'main', status: 'success',
      startedAt: new Date().toISOString(), pipelineName: 'demo-pipeline',
    })

    // Bridge: PACKAGED_IN edges from the feature's traced code nodes → build
    const edge = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'PACKAGED_IN', 1.0, 1.0, 'demo', '{"demo":true}', unixepoch()*1000)
    `)
    const traced = this.db.prepare<[number], { code_node_id: number }>(
      `SELECT code_node_id FROM feature_traces WHERE feature_node_id=? LIMIT 10`
    ).all(run.feature_node_id)
    for (const t of traced) edge.run(t.code_node_id, buildId)
  }

  /** Stage 10: record a plausible KPI observation for every committed hypothesis.
   *  drift ∈ [0,1]: 1.0 = lands exactly on prediction (validated),
   *  0.0 = no movement (refuted). Call twice with different drift for a trend. */
  simulateKpi(runId: number, drift: number): number {
    this.assertDemo(runId)
    const ing = new KPIObservationIngester(this.db)
    const hyps = this.db.prepare<[], {
      kpi_id: number; baseline: number | null; direction: string; magnitude: number
    }>(`
      SELECT vh.kpi_node_id kpi_id, kr.baseline_value baseline,
             vh.direction, vh.magnitude_pct magnitude
      FROM value_hypotheses vh
      JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
      JOIN kpi_registry kr ON kr.kpi_node_id=vh.kpi_node_id
      WHERE vh.verdict_node_id IS NULL
    `).all()
    for (const h of hyps) {
      const base = h.baseline ?? 100
      const sign = h.direction === 'decrease' ? -1 : 1
      const value = base * (1 + sign * (h.magnitude / 100) * drift)
      ing.recordManual(h.kpi_id, Number(value.toFixed(3)), 'demo_snapshot')
    }
    return hyps.length
  }
}
```

---

## 9. Backend — IPC Surface

```typescript
// packages/main/src/cycle/cycleIpcHandlers.ts
import type { IpcMain, BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { CycleOrchestrator } from './cycleOrchestrator'
import { DemoSimulator }     from './demoSimulator'

export function registerCycleIpcHandlers(
  ipcMain: IpcMain, db: Database.Database, win: BrowserWindow,
  getProvider: () => ILLMProvider,
): CycleOrchestrator {
  const orch = new CycleOrchestrator(db, win, getProvider)
  const sim  = new DemoSimulator(db)

  ipcMain.handle('cycle:start', (_e, input) => orch.startCycle(input))
  ipcMain.handle('cycle:list',  () =>
    db.prepare(`SELECT * FROM cycle_runs ORDER BY updated_at DESC LIMIT 20`).all())
  ipcMain.handle('cycle:get',      (_e, { runId }) => orch.getRun(runId))
  ipcMain.handle('cycle:timeline', (_e, { runId }) => orch.getTimeline(runId))
  ipcMain.handle('cycle:advance',  (_e, { runId }) => orch.advance(runId))
  ipcMain.handle('cycle:abort',    (_e, { runId }) => {
    db.prepare(`UPDATE cycle_runs SET status='aborted' WHERE id=?`).run(runId)
  })

  ipcMain.handle('cycle:portfolioGate', (_e, { runId, input }) =>
    orch.approvePortfolioGate(runId, input))
  ipcMain.handle('cycle:signRelease',   (_e, { runId, role, rationale }) =>
    orch.signReleaseGate(runId, role, rationale))

  // demo simulation (mode-guarded in DemoSimulator)
  ipcMain.handle('cycle:simulateSignals', (_e, { runId }) => sim.simulateSignals(runId))
  ipcMain.handle('cycle:simulateCI',      (_e, { runId }) => sim.simulateCI(runId).then(() => orch.advance(runId)))
  ipcMain.handle('cycle:simulateKpi',     (_e, { runId, drift }) => {
    const n = sim.simulateKpi(runId, drift)
    void orch.advance(runId)
    return n
  })

  return orch   // AEPOrchestrator wires orch.handleTick() into the blackboard loop
}
```

---

## 10. Frontend — Cycle Store

```typescript
// packages/renderer/src/store/cycle/cycle.store.ts
import { create } from 'zustand'
import { immer }  from 'zustand/middleware/immer'
import type { CycleStage } from '@shared/index'   // re-export CycleStage + CycleRunRow in shared

export type CycleRun = {
  id: number; label: string; mode: 'live' | 'demo'
  current_stage: CycleStage; status: string; error: string | null
  brief_id: number | null; biz_assess_id: number | null; dev_assess_id: number | null
  gtm_assess_id: number | null; packet_id: number | null
  feature_node_id: number | null; readiness_report_id: number | null
  rc_id: number | null; deployment_id: number | null; outcome_report_id: number | null
  created_at: number; updated_at: number
}
export type TimelineRow = {
  stage: string; event: string; agent_id: string | null
  artifact_node_id: number | null; detail_json: string | null; ts: number
}
export type StageProgress = { runId: number; stage: string; pct: number; detail: string }

type CycleState = {
  runs: CycleRun[]; activeRunId: number | null
  timeline: TimelineRow[]; progress: StageProgress | null
  setRuns: (r: CycleRun[]) => void
  upsertRun: (r: CycleRun) => void
  setActive: (id: number | null) => void
  setTimeline: (t: TimelineRow[]) => void
  setProgress: (p: StageProgress | null) => void
  activeRun: () => CycleRun | undefined
}

export const useCycleStore = create<CycleState>()(immer((set, get) => ({
  runs: [], activeRunId: null, timeline: [], progress: null,
  setRuns:     r  => set(s => { s.runs = r }),
  upsertRun:   r  => set(s => {
    const i = s.runs.findIndex(x => x.id === r.id)
    if (i >= 0) s.runs[i] = r; else s.runs.unshift(r)
  }),
  setActive:   id => set(s => { s.activeRunId = id }),
  setTimeline: t  => set(s => { s.timeline = t }),
  setProgress: p  => set(s => { s.progress = p }),
  activeRun:   () => get().runs.find(r => r.id === get().activeRunId),
})))
```

---

## 11. Frontend — CycleRunnerPanel

Component tree and behavioral spec (Cursor implements against this; visual language
matches the existing AEP panels — zinc surfaces, `#7c6aff` primary, amber gates,
red halt/bounce):

```
CycleRunnerPanel
├─ RunHeaderBar
│    · run selector dropdown (cycle:list) · mode badge (LIVE / DEMO)
│    · "New Cycle" button → modal: label, mode, optional pain-point multi-select
│    · Abort button (confirm dialog)
├─ StageStepper                       ← the centerpiece
│    · renders STAGES in order as StageCards
│    · card state = done | active | locked   (derived from run.current_stage index)
│    · done cards: collapsed; title + ✓ + artifact chips (click chip → ArtifactModal)
│    · active card: expanded; content depends on stage kind:
│         AUTO  → AgentProgressBlock: live cycle:progress bar, agent chips,
│                 spinner while status=running, error box + Retry (cycle:advance) on error
│         WAIT  → WaitBlock: unmet-predicate reason (from run.error / status detail),
│                 live counters (e.g. BUILD: traced files, builds ingested),
│                 demo-only Simulate button (simulateSignals / simulateCI / simulateKpi ×2)
│         GATE  → GateBlock:
│                 PORTFOLIO_GATE → packet JSON summary, hypothesis review table
│                   (label · KPI · direction · magnitude · prior conf), feature picker
│                   (existing FEATURE node or "create from brief"), decision radio
│                   admit/defer/reject, role + rationale inputs → cycle:portfolioGate
│                 RELEASE_GATE → approval checklist from readiness report approvalSet,
│                   signed roles struck through, per-role Sign button (role select +
│                   rationale) → cycle:signRelease; blast-radius summary reuses
│                   the ScopeCard component from ConsolidationPanel
│    · locked cards: dimmed title + narrative only
│    · bounce events render as a red connector annotation between the two cards
├─ TimelineStrip (right side or bottom)
│    · cycle_stage_log newest-first: ts · stage · event · agent · artifact link
└─ ArtifactModal
     · fetches node by id, pretty-prints description JSON, deep-links:
       BRIEF→BusinessValuePanel · report→ConsolidationPanel · verdicts→OutcomeDashboard
```

Event wiring in `App.tsx` (additions):

```typescript
api.on('cycle:update',   r => useCycleStore.getState().upsertRun(r as CycleRun))
api.on('cycle:progress', p => useCycleStore.getState().setProgress(p as StageProgress))
// refresh timeline whenever the active run updates
```

Completed-stage artifact chip mapping: INTAKE→`brief_id` · QUALIFY→`biz/dev/gtm` ·
PACKET→`packet_id` · PORTFOLIO_GATE→`feature_node_id` · CONSOLIDATE→`readiness_report_id` ·
ROLLOUT→`deployment_id` · LEARN→`outcome_report_id`.

---

## 12. Integration Patch

Exactly three existing files change:

**`packages/main/src/db/migrations.ts`** — add `{ version: 4, up: db => db.exec(SCHEMA_V4) }`.

**`packages/main/src/aep/aepOrchestrator.ts`** — two additions:

```typescript
// in register(), after registerAepIpcHandlers(...):
this.cycleOrch = registerCycleIpcHandlers(ipcMain, this.db, this.win, this.getProvider)
this.cycleOrch.resumeAll()

// inside the existing blackboard setInterval, after orchestrator.tick():
this.cycleOrch?.handleTick()
```

**`packages/renderer/src/App.tsx`** — import `CycleRunnerPanel`, add sidebar entry
`{ id: 'cycle', label: 'Cycle Runner', icon: '⟳' }` as the FIRST item (it is now the
front door of the app), add the two `cycle:*` event subscriptions.

---

## 13. Demo Seed Data

**`resources/demo/sample_signals.csv`** — 24 lines, fleet-dispute scenario matching the
mlff-tolling pack:

```csv
2026-06-01,fleet-operators,feature_request,We manage 40 trucks and have to dispute each wrong charge one by one. Need bulk dispute.
2026-06-02,fleet-operators,feature_request,Please add CSV upload for disputing multiple toll charges at once
2026-06-03,fleet-operators,defect,Charged twice on NH-48 gantry 12 for vehicle KA01AB1234, dispute portal only lets me pick one txn
2026-06-04,enterprise,feature_request,Our accounts team spends 3 days/month filing individual disputes. Batch API please.
2026-06-05,fleet-operators,churn_risk,Considering switching providers because dispute handling wastes hours weekly
2026-06-06,individual,usability,Dispute form asks for transaction id which I can never find
2026-06-07,fleet-operators,feature_request,Bulk dispute with one evidence upload shared across selected charges
2026-06-08,fleet-operators,pricing,Toll reconciliation costs us more in admin time than the tolls themselves
... (repeat/vary to 24 rows)
```

The remaining demo path needs no files: `simulateCI` fabricates the build, and
`simulateKpi(0.9)` twice produces observations that land ~90 % of predicted movement —
close enough to validate under the 50 % tolerance rule, so the demo ends with a
validated hypothesis, a refutation can be shown by re-running with `drift: 0.1`.

---

## 14. Milestones & Acceptance Gates

| Milestone | Scope | Acceptance gate |
|---|---|---|
| **M-CR0** | Schema V4 + migration | fresh DB reaches version 4; both tables queryable |
| **M-CR1** | `stageDefinitions.ts` | unit test: every stage's `exit()` returns `{ok:false,reason}` on empty DB, in order |
| **M-CR2** | `CycleOrchestrator` core (start/advance/resume, AUTO stages through PACKET) | `startCycle` on seeded pain points auto-advances SIGNALS→…→PORTFOLIO_GATE and parks `waiting_gate`; kill+restart resumes identically |
| **M-CR3** | Portfolio gate path | `cycle:portfolioGate(admit)` commits hypotheses, sets feature id, advances to BUILD; defer returns to SIGNALS; reject aborts |
| **M-CR4** | `DemoSimulator` + BUILD exit | `simulateCI` creates BUILD + PACKAGED_IN; tick advances BUILD→CONSOLIDATE; A10 runs |
| **M-CR5** | Bounce + release gate | seeding an untested traced file causes CONSOLIDATE→BUILD bounce with log row; after fix, RELEASE_GATE lists computed roles; signing all advances |
| **M-CR6** | ROLLOUT + OBSERVE + LEARN | demo plan deploys; `simulateKpi(0.9)`×2 satisfies OBSERVE; Pass G runs; run reaches DONE with verdict + LEARNING nodes |
| **M-CR7** | `cycle.store` + CycleRunnerPanel stepper (read-only) | stepper reflects a mid-flight run correctly after reload; artifact chips open modal |
| **M-CR8** | Gate forms + simulate buttons + timeline | full demo cycle drivable from the panel alone, no other panel needed |
| **M-CR9** | Golden-path E2E script | `pnpm test:e2e:cycle` runs M-CR2→M-CR6 headlessly in <10 min with a mock LLM provider |

---

## 15. Cursor Prompt Pack

Paste these sequentially; each assumes the previous milestone passed.

**Prompt 1 (M-CR0/1):**
> Read `AEP_OVG_Implementation_Part1.md` §2 (schema) and this plan §4–6. Add SCHEMA_V4
> to `packages/main/src/db/schema.ts`, register migration v4 in `migrations.ts`, then
> create `packages/main/src/cycle/stageDefinitions.ts` exactly as specified in §6.
> Add `CycleStage` and `CycleRunRow` re-exports to `packages/shared/src/index.ts`.
> Write a vitest file asserting stage order and that every exit() returns a reason on
> an empty in-memory DB.

**Prompt 2 (M-CR2):**
> Implement `packages/main/src/cycle/cycleOrchestrator.ts` from §7 of the plan verbatim,
> fixing imports to match our actual agent file paths. Do not modify any agent. Add
> `registerCycleIpcHandlers` from §9. Wire both into `aepOrchestrator.ts` per §12
> (two additions only). Verify: with seeded pain points, `cycle:start` advances to
> PORTFOLIO_GATE and persists across app restart via `resumeAll()`.

**Prompt 3 (M-CR3):**
> Implement `approvePortfolioGate` and `signReleaseGate` paths end-to-end including the
> defer→SIGNALS and reject→aborted branches. Confirm `executePortfolioGate` is called
> with the run's `packet_id` and that hypotheses flip to `source_type='committed'`.

**Prompt 4 (M-CR4/5):**
> Implement `packages/main/src/cycle/demoSimulator.ts` from §8. Create
> `resources/demo/sample_signals.csv` with 24 rows per §13. Then verify the bounce path:
> CONSOLIDATE must clear `readiness_report_id` and return the run to BUILD when
> scope2_gaps is non-empty, logging a `bounced` event.

**Prompt 5 (M-CR6):**
> Complete ROLLOUT, OBSERVE, LEARN stages. In demo mode the rollout plan is single-stage
> 100 %. Verify `simulateKpi(0.9)` twice then tick reaches DONE with ≥1
> HYPOTHESIS_VERDICT and ≥1 LEARNING node, and `outcome_report_id` set on the run.

**Prompt 6 (M-CR7/8):**
> Create `cycle.store.ts` (§10) and `packages/renderer/src/panels/cycle/CycleRunnerPanel/`
> implementing the component spec in §11. Reuse ScopeCard from ConsolidationPanel for the
> release-gate blast summary. Match existing panel styling (zinc-900 surfaces, #7c6aff
> primary, amber gates, red bounce). Add the sidebar entry and event subscriptions per §12.

**Prompt 7 (M-CR9):**
> Write `e2e/cycle.golden.spec.ts`: mock ILLMProvider with canned JSON per agent, seed
> signals, run the full demo cycle programmatically through the IPC handlers, assert the
> final run row, the log event sequence (entered/agent_finished/gate_approved/advanced…),
> and the golden-thread query returning signal→verdict for the created feature.

---

*End of plan. Total new files: 17 (9 backend, 5 renderer, 3 seed/test). Modified: 3, all additive. The Cycle Runner turns fourteen agents, four passes, and nine FSM states into one button labeled "New Cycle".*
