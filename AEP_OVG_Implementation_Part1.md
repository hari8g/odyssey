# Domain-Aware ISS (D-ISS) + Agentic Engineering Platform (AEP)
## Complete Implementation Plan — Part 1 of 2
### Level 1: Domain Ontology (L0 D-ISS) · Level 2: Upstream AEP (L−2 and L−1)

> **Pre-condition**: RIAF Studio (Parts 1+2) + ISS Graph (v2 with Manual Feature Injection)
> are fully implemented. This plan builds the four remaining layers and the 14-station
> agent roster on top of those foundations without modifying any existing file.
>
> **What this plan produces**: An 8-layer closed-loop graph — from customer signal to
> organizational learning — with 14 specialist agents coordinated through a three-tier
> FSM over a blackboard (the OVG itself). Each level is independently deployable and
> immediately valuable.

---

## The Four Implementation Levels at a Glance

```
LEVEL 1 — D-ISS: Domain Ontology (L0)
  The grounding layer. Domain packs (YAML) → graph nodes for glossary terms,
  business rules, KPIs, bounded contexts, domain events, and regulations.
  The foundation that makes every upstream and downstream layer semantically precise.
  Adds: Pass D, domain pack format, domain-aware ISS enrichment.
  Value delivered: features are now grounded in domain language; business rules
  surface as first-class enforcement targets; FIS gains a domain-weight dimension.

LEVEL 2 — Upstream AEP: Customer & Business (L−2 and L−1)
  The anticipatory layers. Customer signals cluster into pain points; pain points
  motivate features with business hypotheses attached. Five new agents.
  Adds: Pass E, A1–A5, VALUE_HYPOTHESIS registry, Portfolio gate.
  Value delivered: every feature enters the plane with a falsifiable bet on a KPI
  and a quantified value/cost range — no more "why are we building this?" questions.

LEVEL 3 — Downstream AEP: Delivery & Outcome (L+4 and L+5)
  The evidentiary layers. CI/CD, test results, deployments, and KPI observations
  flow in. Hypotheses meet their verdicts. Four new agents.
  Adds: Pass F, Pass G, A10–A13, 4-scope blast radius, computed approval sets.
  Value delivered: "is the feature live and healthy?" and "did the bet pay off?"
  both become graph queries, not Slack questions.

LEVEL 4 — The Loop: Organizational Learning + Full Orchestration
  The compounding layer. Learning nodes close the loop. The Value Stream Orchestrator
  (Tier 3 FSM) drives features through all nine states with predicate-driven
  transitions. Agent calibration makes every agent measurably better each cycle.
  Adds: A14, Tier-3 FSM, blackboard predicate engine, RACI governance, calibration.
  Value delivered: the organization's predictions improve each cycle; the entire
  stream — intake to outcome — is a single queryable audit trail.
```

---

## Table of Contents — Part 1

1. [Architecture Overview & Integration Model](#1-architecture-overview)
2. [Schema Migration V3 — All New Tables](#2-schema-migration-v3)
3. [Shared Types — New Node & Edge Kinds](#3-shared-types)
4. [New File Structure](#4-new-file-structure)
5. [Level 1 — Domain Ontology (L0 D-ISS)](#5-level-1--domain-ontology)
   - 5.1 Domain Pack YAML Format
   - 5.2 Domain Pack Loader
   - 5.3 Pass D Orchestrator
   - 5.4 Domain Glossary, Business Rule & KPI Indexers
   - 5.5 Domain-Aware ISS Enrichment
   - 5.6 Domain-Aware FIS Extension
6. [Level 2 — Upstream AEP (L−2 and L−1)](#6-level-2--upstream-aep)
   - 6.1 Pass E Orchestrator & Org Pack Loader
   - 6.2 Customer Signal Ingester
   - 6.3 Pain Point Clusterer
   - 6.4 A1 — Intake & Intent Classification Agent
   - 6.5 A2 — Business Impact Agent
   - 6.6 A3 — GTM Alignment Agent
   - 6.7 A4 — Product/Dev Impact Agent (FIS v2)
   - 6.8 A5 — Portfolio Reconciliation Agent
   - 6.9 VALUE_HYPOTHESIS Registry
   - 6.10 Portfolio Gate
7. [AEP IPC Handlers — Part 1](#7-aep-ipc-handlers-part-1)
8. [Renderer Panels — Part 1](#8-renderer-panels-part-1)
9. [Level 1 & 2 Build Order](#9-build-order)

---

## 1. Architecture Overview & Integration Model

### 1.1 The eight-layer stack on RIAF Studio

```
┌─────────────────────────────────────────────────────────────────┐
│ L−2  CUSTOMER & MARKET   Who wants what, and why?               │  ← Level 2
│      CUSTOMER_SIGNAL · PAIN_POINT · SEGMENT · JOB_TO_BE_DONE   │
├─────────────────────────────────────────────────────────────────┤
│ L−1  BUSINESS & VALUE    What is it worth?                      │  ← Level 2
│      BUSINESS_OBJECTIVE · VALUE_HYPOTHESIS · COST_ESTIMATE      │
│      RISK · ORG_UNIT · STAKEHOLDER_ROLE · INVESTMENT            │
├─────────────────────────────────────────────────────────────────┤
│ L0   DOMAIN ONTOLOGY     What does it mean?                     │  ← Level 1
│      DOMAIN_CONCEPT · BUSINESS_RULE · KPI · BOUNDED_CONTEXT     │
│      DOMAIN_EVENT · REGULATION · GLOSSARY_TERM                  │
├─────────────────────────────────────────────────────────────────┤
│ L1   INTENT              Why are we building it?                │  ← ISS (existing)
│ L2   SEMANTIC            How is the system shaped?              │
│ L3   STRUCTURAL          Where is the code?                     │
├─────────────────────────────────────────────────────────────────┤
│ L+4  DELIVERY & RUNTIME  What happened to the code?             │  ← Level 3
│      BUILD · RELEASE_CANDIDATE · QUALITY_GATE · DEPLOYMENT      │
│      TEST_RUN · INCIDENT · FEATURE_FLAG · KPI_OBSERVATION       │
├─────────────────────────────────────────────────────────────────┤
│ L+5  OUTCOME & IMPACT    What did it do to the organization?    │  ← Level 3
│      OUTCOME · IMPACT_ASSESSMENT · HYPOTHESIS_VERDICT · LEARNING│
└─────────────────────────────────────────────────────────────────┘
                    ↑ INFORMS (loop edge, Level 4) ↑
```

### 1.2 Zero-modification guarantee

**Only 3 existing files are touched** — and all additively:

| File | Change |
|---|---|
| `packages/main/src/index.ts` | `+3 lines`: import + register domain orchestrator + AEP orchestrator |
| `packages/main/src/iss/issIpcHandlers.ts` | `+1 line`: call `registerAepIpcHandlers()` |
| `packages/shared/src/ipc.channels.ts` | Extend IPC object with `domain:*` and `aep:*` channels |

All new code lives in `packages/main/src/domain/` and `packages/main/src/aep/`.

### 1.3 The blackboard principle (core to all four levels)

The OVG itself — the same SQLite database — is the shared workspace for all agents.
Agents never call other agents directly. They write nodes to the graph; the
Value Stream Orchestrator (Level 4) detects that the trigger predicate for the next
station is now satisfied and schedules it. This makes every agent:

- **Independently deployable** (no message-bus coupling)
- **Restartable mid-stream** (all state is in the DB)
- **Auditable** (every write is a provenance-carrying node)

---

## 2. Schema Migration V3 — All New Tables

```typescript
// packages/main/src/db/schema.ts — SCHEMA_V3 (appended after V2)

export const SCHEMA_V3 = `

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 1: Domain Pack registry
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS domain_packs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,   -- e.g. 'mlff-tolling', 'staas'
  version     TEXT NOT NULL,
  file_path   TEXT NOT NULL,          -- absolute path to the YAML
  loaded_at   INTEGER NOT NULL,
  node_count  INTEGER NOT NULL DEFAULT 0
);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 1: KPI registry (beyond what graph_nodes carries)
-- Stores measurement details needed by A2 and A12
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kpi_registry (
  kpi_node_id        INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  measurement_unit   TEXT NOT NULL,         -- 'percentage', 'count', 'ms', 'currency_usd' …
  measurement_window TEXT NOT NULL,         -- 'daily', 'weekly', '28d_rolling', 'quarterly'
  telemetry_source   TEXT,                  -- CI system, APM tool, data warehouse table
  baseline_value     REAL,                  -- current known value; null if not yet measured
  target_value       REAL,                  -- the strategic target
  owner_org_unit     TEXT                   -- which ORG_UNIT is accountable
);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 2: VALUE_HYPOTHESIS pre-registration
-- Every hypothesis must name method + magnitude BEFORE any code is written
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS value_hypotheses (
  hypothesis_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kpi_node_id        INTEGER NOT NULL REFERENCES graph_nodes(id),
  direction          TEXT NOT NULL CHECK(direction IN ('increase','decrease','stabilize')),
  magnitude_pct      REAL NOT NULL,         -- expected % change (e.g. 15.0 = 15%)
  timeframe_days     INTEGER NOT NULL,      -- measurement window after deployment
  prior_confidence   REAL NOT NULL,         -- A2's calibrated prior (0–1)
  attribution_method TEXT NOT NULL          -- 'ab_flag'|'canary'|'before_after'|'holdout'
    CHECK(attribution_method IN ('ab_flag','canary','before_after','holdout')),
  registered_at      INTEGER NOT NULL,      -- when hypothesis was committed (gate timestamp)
  -- filled after L+5 verdict:
  verdict_node_id    INTEGER REFERENCES graph_nodes(id),
  actual_delta_pct   REAL,
  actual_confidence  REAL
);
CREATE INDEX IF NOT EXISTS idx_vh_kpi ON value_hypotheses(kpi_node_id);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 2: Org pack: OKRs, org units, investments (curated)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS org_packs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,     -- 'q3-2026-objectives', 'org-chart-2026'
  version   TEXT NOT NULL,
  file_path TEXT NOT NULL,
  loaded_at INTEGER NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 2: Customer signals (immutable raw evidence atoms)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_signals (
  signal_node_id  INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  source_system   TEXT NOT NULL,      -- 'zendesk'|'nps'|'playstore'|'salesforce'|'manual'
  source_id       TEXT,               -- external ID in source system
  customer_cohort TEXT NOT NULL,      -- pseudonymized segment (never raw PII)
  signal_type     TEXT NOT NULL       -- 'feature_request'|'defect'|'usability'|'churn_risk'|'pricing'|'noise'
    CHECK(signal_type IN ('feature_request','defect','usability','churn_risk','pricing','noise')),
  raw_text_hash   TEXT NOT NULL,      -- sha256 of raw text (the text itself is in description)
  signal_date     INTEGER NOT NULL    -- unix ms of original signal
);
CREATE INDEX IF NOT EXISTS idx_cs_type   ON customer_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_cs_cohort ON customer_signals(customer_cohort);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 2: Artifact provenance (uniform envelope for all handoff artifacts)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS artifact_provenance (
  artifact_node_id    INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL,      -- 'A1'|'A2'|...|'A14'
  agent_version       TEXT NOT NULL,
  derived_from_json   TEXT NOT NULL,      -- JSON: upstream node IDs consumed
  queries_json        TEXT,               -- JSON: graph queries run (reproducibility)
  confidence          REAL NOT NULL,
  approved_by_role    TEXT,               -- role that signed (if human gate)
  approved_at         INTEGER,
  superseded_by       INTEGER REFERENCES graph_nodes(id)
);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 3: Value stream state — Tier-3 FSM token per feature
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS value_stream_state (
  feature_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  stream_state    TEXT NOT NULL DEFAULT 'INTAKE'
    CHECK(stream_state IN (
      'INTAKE','QUALIFY','PRIORITIZE','DEFINE','BUILD',
      'CONSOLIDATE','RELEASE','OBSERVE','LEARN')),
  entered_state_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  blocked_on_json TEXT,           -- unmet predicates (for dashboarding)
  last_transition_record INTEGER REFERENCES graph_nodes(id)  -- DECISION_RECORD that triggered
);
CREATE INDEX IF NOT EXISTS idx_vss_state ON value_stream_state(stream_state);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 4: Agent capability matrix (governance, §11 of AEP doc)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id          TEXT NOT NULL,
  layer             TEXT NOT NULL,        -- 'L-2'|'L-1'|'L0'|'L1'|'L2'|'L3'|'L+4'|'L+5'
  node_kinds_json   TEXT NOT NULL,        -- writable GraphNodeKind[]
  edge_kinds_json   TEXT NOT NULL,        -- writable GraphEdgeKind[]
  requires_gate     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, layer)
);

-- ══════════════════════════════════════════════════════════════════════
-- LEVEL 4: Agent calibration history (for A14)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_calibration (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL,
  cycle_end_date  TEXT NOT NULL,          -- ISO date (quarter boundary)
  predictions     INTEGER NOT NULL,       -- # of estimates/predictions made
  verified        INTEGER NOT NULL,       -- # with ground truth available
  mean_error_pct  REAL,                   -- mean absolute % error vs actuals
  calibration_score REAL,                 -- Brier score or similar
  notes_json      TEXT                    -- distilled learnings per agent
);
CREATE INDEX IF NOT EXISTS idx_ac_agent ON agent_calibration(agent_id, cycle_end_date);

UPDATE schema_version SET version = 3;
`
```

---

## 3. Shared Types — New Node & Edge Kinds

```typescript
// packages/shared/src/db.types.ts — APPEND (extends existing ISS types)

// ══════════════════════════════════════════════════════════════════════
// L0 Domain Ontology node kinds
// ══════════════════════════════════════════════════════════════════════
export type DomainNodeKind =
  | 'DOMAIN_CONCEPT'     // A term in the domain glossary
  | 'BUSINESS_RULE'      // A formal, enforceable rule
  | 'KPI'                // A key performance indicator with measurement details
  | 'BOUNDED_CONTEXT'    // A DDD bounded context / service boundary
  | 'DOMAIN_EVENT'       // An event in the domain (named, with producers/consumers)
  | 'REGULATION'         // A regulatory constraint (with clause reference)
  | 'GLOSSARY_TERM'      // Synonym/alias for a DOMAIN_CONCEPT

// L−2 Customer & Market node kinds
export type CustomerNodeKind =
  | 'CUSTOMER'           // An identified account or anonymized cohort member
  | 'SEGMENT'            // A market/user segment
  | 'CUSTOMER_SIGNAL'    // Atomic, immutable raw input
  | 'PAIN_POINT'         // Synthesized, deduplicated problem statement
  | 'JOB_TO_BE_DONE'     // The underlying job the product is hired for
  | 'MARKET_SIGNAL'      // External: analyst note, regulation, tender
  | 'COMPETITOR_CAPABILITY' // What a competitor ships

// L−1 Business & Value node kinds
export type BusinessNodeKind =
  | 'BUSINESS_OBJECTIVE' // OKR / strategic goal
  | 'BUSINESS_CASE'      // Structured justification for an initiative
  | 'VALUE_HYPOTHESIS'   // Falsifiable bet: metric + direction + magnitude + timeframe
  | 'COST_ESTIMATE'      // Dev/run/opportunity cost with uncertainty range
  | 'RISK'               // Business/technical/regulatory risk
  | 'ORG_UNIT'           // GTM, Marketing, Finance, Engineering, Product…
  | 'STAKEHOLDER_ROLE'   // CPO, CTO, CBO — roles, not people
  | 'INVESTMENT'         // Budget allocation
  | 'PRICING_IMPACT'     // How a capability affects packaging/pricing

// L+4 Delivery & Runtime node kinds
export type DeliveryNodeKind =
  | 'BUILD'              // A CI build
  | 'RELEASE_CANDIDATE'  // A versioned deployable bundle
  | 'QUALITY_GATE'       // A named gate (coverage, perf, security, compliance)
  | 'TEST_RUN'           // Execution of a test suite against a build
  | 'ENVIRONMENT'        // dev / staging / UAT / prod
  | 'DEPLOYMENT'         // A release candidate landing in an environment
  | 'FEATURE_FLAG'       // Progressive exposure control
  | 'INCIDENT'           // A production incident
  | 'TELEMETRY_STREAM'   // A metric/log/trace source
  | 'KPI_OBSERVATION'    // A measured KPI value over a time window

// L+5 Outcome & Impact node kinds
export type OutcomeNodeKind =
  | 'OUTCOME'            // Attributed effect on a KPI (with attribution method + confidence)
  | 'IMPACT_ASSESSMENT'  // Per-ORG_UNIT impact report
  | 'HYPOTHESIS_VERDICT' // Formal validation/refutation record
  | 'LEARNING'           // Distilled, reusable lesson

// Handoff Artifact node kinds
export type ArtifactNodeKind =
  | 'BRIEF'                        // A1 → A2/A4: intent + evidence
  | 'BUSINESS_IMPACT_ASSESSMENT'   // A2 → GTM/PO
  | 'DEV_IMPACT_ASSESSMENT'        // A4 → PO
  | 'RELEASE_READINESS_REPORT'     // A10 → approvers
  | 'OUTCOME_REPORT'               // A12 → all stakeholders
  | 'DECISION_RECORD'              // A human decision (gate passage record)

// Extended edge kinds (additions to existing GraphEdgeKind)
export type AEPEdgeKind =
  // Domain (L0) edges
  | 'BELONGS_TO_CONTEXT'   // FILE → BOUNDED_CONTEXT
  | 'GOVERNED_BY'          // FILE/CLASS/FUNCTION → REGULATION
  | 'ENFORCES'             // TEST_CASE → BUSINESS_RULE
  | 'INSTRUMENTS'          // TELEMETRY_STREAM → KPI (declares measurement)
  | 'DERIVES_FROM'         // FEATURE → DOMAIN_CONCEPT (grounding)
  | 'CONSTRAINED_BY'       // FEATURE/ACCEPTANCE_CRITERION → BUSINESS_RULE
  | 'ABOUT'                // any node → DOMAIN_CONCEPT (semantic annotation)

  // L−2 internal
  | 'EXPRESSES'            // CUSTOMER_SIGNAL → PAIN_POINT
  | 'BELONGS_TO_SEGMENT'   // CUSTOMER → SEGMENT
  | 'HIRES_FOR'            // SEGMENT → JOB_TO_BE_DONE
  | 'THREATENS'            // MARKET_SIGNAL → BUSINESS_OBJECTIVE
  | 'OPENS'                // MARKET_SIGNAL → BUSINESS_OBJECTIVE

  // L−1 edges
  | 'ADVANCES'             // FEATURE → BUSINESS_OBJECTIVE
  | 'JUSTIFIED_BY'         // FEATURE → BUSINESS_CASE
  | 'PREDICTS'             // VALUE_HYPOTHESIS → KPI
  | 'MOTIVATES'            // PAIN_POINT → FEATURE
  | 'TARGETS'              // FEATURE → SEGMENT
  | 'ESTIMATED_BY'         // FEATURE → COST_ESTIMATE
  | 'EXPOSED_TO'           // FEATURE → RISK
  | 'OWNED_BY'             // any → ORG_UNIT / STAKEHOLDER_ROLE
  | 'CONSULTED_BY'         // any → ORG_UNIT (RACI: consulted)
  | 'INFORMED_BY'          // any → ORG_UNIT (RACI: informed)
  | 'FUNDED_BY'            // EPIC → INVESTMENT
  | 'MEASURED_BY'          // BUSINESS_OBJECTIVE → KPI

  // L3 → L+4 edges
  | 'PACKAGED_IN'          // FILE → BUILD
  | 'GATED_BY'             // RELEASE_CANDIDATE → QUALITY_GATE
  | 'EVIDENCED_BY'         // QUALITY_GATE → TEST_RUN
  | 'DEPLOYED_TO'          // RELEASE_CANDIDATE → ENVIRONMENT
  | 'EXPOSES_FLAG'         // FEATURE_FLAG → FEATURE
  | 'CAUSED'               // DEPLOYMENT → INCIDENT
  | 'SUSPECTED'            // DEPLOYMENT → INCIDENT (unconfirmed)

  // L+4 → L+5 + loop
  | 'OBSERVED_AS'          // KPI → KPI_OBSERVATION
  | 'ATTRIBUTED_TO'        // OUTCOME → DEPLOYMENT / FEATURE
  | 'ASSESSED_FOR'         // IMPACT_ASSESSMENT → ORG_UNIT
  | 'VALIDATES_HYPOTHESIS' // HYPOTHESIS_VERDICT → VALUE_HYPOTHESIS
  | 'REFUTES_HYPOTHESIS'   // HYPOTHESIS_VERDICT → VALUE_HYPOTHESIS
  | 'INFORMS'              // LEARNING → BUSINESS_OBJECTIVE / PAIN_POINT / FEATURE

// Domain pack types
export type DomainPackManifest = {
  name:      string
  version:   string
  domain:    string
  concepts:  DomainConceptDef[]
  rules:     BusinessRuleDef[]
  kpis:      KPIDef[]
  contexts:  BoundedContextDef[]
  events:    DomainEventDef[]
  regulations: RegulationDef[]
}

export type DomainConceptDef = {
  name:        string
  definition:  string
  synonyms?:   string[]
  context?:    string    // which bounded context this belongs to
}

export type BusinessRuleDef = {
  id:          string    // e.g. 'MLFF-RULE-042'
  name:        string
  statement:   string    // formal rule statement
  context:     string    // bounded context
  regulation?: string    // reference to a regulation node
  enforcedBy?: string[]  // test file path hints
}

export type KPIDef = {
  name:              string
  description:       string
  unit:              string
  measurementWindow: string
  telemetrySource?:  string
  baseline?:         number
  target?:           number
  owner?:            string    // ORG_UNIT name
}

export type BoundedContextDef = {
  name:        string
  description: string
  filePaths?:  string[]   // glob patterns for files in this context
  team?:       string
}

export type DomainEventDef = {
  name:       string
  description: string
  producedBy?: string[]   // service/file patterns
  consumedBy?: string[]
}

export type RegulationDef = {
  id:      string     // e.g. 'NHAI-MLFF-SPEC-4.2'
  name:    string
  body:    string
  applies_to?: string[]  // file/class patterns
}

// Org pack types
export type OrgPackManifest = {
  name:        string
  version:     string
  quarter?:    string
  objectives:  ObjectiveDef[]
  orgUnits:    OrgUnitDef[]
  investments: InvestmentDef[]
  roles:       RoleDef[]
}

export type ObjectiveDef = {
  id:      string
  label:   string
  owner:   string    // STAKEHOLDER_ROLE name
  horizon: string    // 'Q3-2026', 'FY-2026', etc.
  kpis?:   string[]  // KPI names from domain pack
}

export type OrgUnitDef = {
  name:     string
  concern_kpis?: string[]   // which KPIs this unit cares about
  concern_segments?: string[]
}

export type InvestmentDef = {
  id:      string
  label:   string
  owner:   string
  budget:  number
  currency: string
  horizon:  string
}

export type RoleDef = {
  name:       string
  org_unit:   string
}

// AEP IPC progress events
export type AEPPassId =
  | 'D' | 'E_signals' | 'E_cluster' | 'E_org'
  | 'F_cicd' | 'F_tests' | 'F_deploy' | 'F_kpi'
  | 'G_attribute' | 'G_verdict' | 'G_learn'

export type AEPPassProgress = {
  pass:   AEPPassId
  stage:  string
  pct:    number
  detail: string
}

// Value stream state
export type ValueStreamState =
  | 'INTAKE' | 'QUALIFY' | 'PRIORITIZE' | 'DEFINE'
  | 'BUILD'  | 'CONSOLIDATE' | 'RELEASE' | 'OBSERVE' | 'LEARN'

// 4-scope blast radius result
export type BlastRadius = {
  featureId:       number
  scope1_code:     { filePath: string; changeType: 'direct'|'cochange' }[]
  scope2_verify:   { kind: string; label: string; isCovered: boolean; filePath: string | null }[]
  scope2_gaps:     string[]       // code in scope1 with no covering test
  scope3_ops:      { kind: string; label: string; detail: string }[]
  scope4_org:      {
    kpis:      string[]
    segments:  string[]
    orgUnits:  string[]
    governed:  string[]     // REGULATION labels implicated
  }
  approvalSet:     string[]       // STAKEHOLDER_ROLE names required at the gate
  computedAt:      number
}
```

---

## 4. New File Structure

```
packages/main/src/
│
├── domain/                              ← Level 1: L0 Domain Ontology
│   ├── domainOrchestrator.ts            ← registers pass D hook; entry point
│   ├── domainPackLoader.ts              ← parses YAML → DomainPackManifest
│   ├── passD/
│   │   ├── passDOrchestrator.ts
│   │   ├── glossaryIndexer.ts           ← DOMAIN_CONCEPT + GLOSSARY_TERM nodes
│   │   ├── businessRuleIndexer.ts       ← BUSINESS_RULE nodes + ENFORCES edges
│   │   ├── kpiIndexer.ts               ← KPI nodes + kpi_registry rows
│   │   ├── contextIndexer.ts           ← BOUNDED_CONTEXT nodes + file assignment
│   │   ├── eventIndexer.ts             ← DOMAIN_EVENT nodes
│   │   └── regulationIndexer.ts        ← REGULATION nodes + GOVERNED_BY edges
│   ├── domainEnrichment.ts             ← enriches ISS graph with L0 edges
│   └── domainAwareFIS.ts               ← extends FIS with domain weight (zeta)
│
├── aep/                                 ← Levels 2–4: AEP agents & orchestration
│   ├── aepOrchestrator.ts              ← registers all AEP hooks
│   ├── aepIpcHandlers.ts               ← all aep:* ipcMain.handle calls
│   │
│   ├── upstream/                        ← Level 2: L−2 and L−1
│   │   ├── passE/
│   │   │   ├── passEOrchestrator.ts
│   │   │   ├── customerSignalIngester.ts
│   │   │   ├── painPointClusterer.ts
│   │   │   └── orgPackLoader.ts
│   │   ├── agents/
│   │   │   ├── a1IntakeAgent.ts
│   │   │   ├── a2BusinessImpactAgent.ts
│   │   │   ├── a3GtmAlignmentAgent.ts
│   │   │   ├── a4DevImpactAgent.ts
│   │   │   └── a5PortfolioAgent.ts
│   │   └── hypothesisRegistry.ts
│   │
│   ├── downstream/                      ← Level 3: L+4 and L+5
│   │   ├── passF/
│   │   │   ├── passFOrchestrator.ts
│   │   │   ├── cicdIngester.ts
│   │   │   ├── testRunIngester.ts
│   │   │   ├── deploymentIngester.ts
│   │   │   └── kpiObservationIngester.ts
│   │   ├── passG/
│   │   │   ├── passGOrchestrator.ts
│   │   │   ├── attributionComputer.ts
│   │   │   ├── verdictIssuer.ts
│   │   │   └── learningDistiller.ts
│   │   ├── agents/
│   │   │   ├── a10ConsolidationAgent.ts
│   │   │   ├── a11DeploymentAgent.ts
│   │   │   ├── a12AttributionAgent.ts
│   │   │   ├── a13CrossFunctionalAgent.ts
│   │   │   └── a14LearningAgent.ts
│   │   └── blastRadiusEngine.ts
│   │
│   └── governance/                      ← Level 4: RACI + calibration + FSM
│       ├── valueStreamOrchestrator.ts
│       ├── blackboard.ts
│       ├── raciGraph.ts
│       ├── agentCapabilityMatrix.ts
│       ├── humanGateManager.ts
│       └── calibrationMonitor.ts
│
└── domain_packs/                        ← YAML domain packs (shipped with app)
    ├── mlff-tolling.pack.yaml
    ├── staas.pack.yaml
    └── generic-saas.pack.yaml

resources/org_packs/                     ← user-managed; gitignored by default
    ├── objectives.pack.yaml
    └── org-chart.pack.yaml

packages/renderer/src/panels/aep/
    ├── DomainBrowserPanel/index.tsx
    ├── ValueStreamPanel/index.tsx       ← Kanban-style FSM view
    ├── CustomerSignalPanel/index.tsx
    ├── BusinessValuePanel/index.tsx
    ├── ConsolidationPanel/index.tsx
    └── OutcomeDashboardPanel/index.tsx
```

---

## 5. Level 1 — Domain Ontology (L0 D-ISS)

The domain layer is what distinguishes ISS-on-a-generic-codebase from
ISS-on-a-specific-domain. Without it, "charge" is just a string; with it,
"charge" is a DOMAIN_CONCEPT in the MLFF-Tolling bounded context, governed by
NHAI-MLFF-SPEC-4.2, measured by `charge_dispute_rate` (a KPI), and subject to
`MLFF-RULE-042` (charges must be reversible within 48 hours). That precision
flows through every downstream layer.

### 5.1 Domain Pack YAML Format

Domain packs are versioned YAML files. They live in the app and can be
extended or overridden by user-created packs. Here is an excerpt for MLFF:

```yaml
# resources/domain_packs/mlff-tolling.pack.yaml
name: mlff-tolling
version: "1.0.0"
domain: Multi-Lane Free Flow Tolling

concepts:
  - name: Charge
    definition: >
      A monetary amount levied on a vehicle for using a tolled road segment.
      A charge is created when a vehicle traversal event is confirmed and a valid
      payment instrument is resolved.
    synonyms: [toll, fee, levy, transaction]
    context: charge-lifecycle

  - name: Dispute
    definition: >
      A formal objection raised by a customer against a charge, triggering a
      review workflow that may result in reversal, confirmation, or partial credit.
    synonyms: [objection, contestation, query, complaint]
    context: dispute-management

  - name: NETC
    definition: >
      National Electronic Toll Collection — the national interoperability framework
      that mandates how vehicles with FASTag RFID tags are identified across toll plazas.
    context: payment-infrastructure

rules:
  - id: MLFF-RULE-042
    name: Charge Reversal Window
    statement: >
      Any confirmed charge must be reversible within 48 hours of creation.
      After 48 hours, reversal requires compliance officer approval.
    context: charge-lifecycle
    regulation: NHAI-MLFF-SPEC-4.2

  - id: MLFF-RULE-017
    name: Dispute Acknowledgement SLA
    statement: >
      Every submitted dispute must receive an acknowledgement notification
      within 4 business hours of submission.
    context: dispute-management

kpis:
  - name: charge_dispute_rate
    description: Percentage of charges that result in a dispute within 30 days
    unit: percentage
    measurementWindow: 30d_rolling
    telemetrySource: analytics_warehouse.charges_disputes_view
    baseline: 2.3
    target: 1.5
    owner: Operations

  - name: dispute_resolution_time_p95
    description: 95th percentile time from dispute submission to resolution
    unit: hours
    measurementWindow: weekly
    telemetrySource: dispute_service.metrics
    baseline: 72.0
    target: 24.0
    owner: Operations

contexts:
  - name: charge-lifecycle
    description: Everything related to creating, confirming, and reversing charges
    filePaths:
      - "src/services/charge*"
      - "src/repositories/charge*"
      - "src/domain/charge*"

  - name: dispute-management
    description: The dispute submission, review, and resolution workflow
    filePaths:
      - "src/services/dispute*"
      - "src/controllers/dispute*"

events:
  - name: ChargeCreated
    description: Emitted when a new charge is created from a confirmed traversal
    producedBy: ["src/services/chargeService.ts"]
    consumedBy: ["src/services/notificationService.ts", "src/services/reconciliationService.ts"]

  - name: DisputeSubmitted
    description: Emitted when a customer submits a new dispute
    producedBy: ["src/services/disputeService.ts"]

regulations:
  - id: NHAI-MLFF-SPEC-4.2
    name: NHAI MLFF Technical Specification Clause 4.2
    body: >
      All electronic toll transactions must be reversible within 48 hours.
      Reversal transactions must be logged with a compliance officer reference.
    applies_to: ["**/charge*.ts", "**/reversal*.ts"]
```

### 5.2 Domain Pack Loader

```typescript
// packages/main/src/domain/domainPackLoader.ts
import fs from 'node:fs'
import path from 'node:path'
import type { DomainPackManifest } from '@shared/index'

// Minimal YAML→JS parser for the domain pack format.
// Handles: strings, arrays, block scalars (>), nested maps.
// Deliberately avoids js-yaml to stay native-dep-free.
export class DomainPackLoader {
  load(filePath: string): DomainPackManifest {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Domain pack not found: ${filePath}`)
    }
    const content = fs.readFileSync(filePath, 'utf8')
    try {
      // We use a JSON Schema-conformant YAML subset; use a tiny parser
      return this.parseYaml(content) as DomainPackManifest
    } catch (err) {
      throw new Error(
        `Domain pack YAML parse error in ${path.basename(filePath)}: ` +
        (err instanceof Error ? err.message : String(err))
      )
    }
  }

  validate(pack: DomainPackManifest): string[] {
    const errors: string[] = []
    if (!pack.name)    errors.push('name is required')
    if (!pack.version) errors.push('version is required')
    if (!pack.domain)  errors.push('domain is required')

    // KPIs must have measurement details
    for (const kpi of pack.kpis ?? []) {
      if (!kpi.unit)              errors.push(`KPI "${kpi.name}": unit is required`)
      if (!kpi.measurementWindow) errors.push(`KPI "${kpi.name}": measurementWindow is required`)
    }

    // Business rules must reference known contexts
    const contextNames = new Set((pack.contexts ?? []).map(c => c.name))
    for (const rule of pack.rules ?? []) {
      if (!rule.id)      errors.push(`Rule "${rule.name}": id is required (e.g. MLFF-RULE-042)`)
      if (!rule.context) errors.push(`Rule "${rule.id}": context is required`)
      if (rule.context && !contextNames.has(rule.context))
        errors.push(`Rule "${rule.id}": context "${rule.context}" not defined in contexts section`)
    }

    return errors
  }

  // Scans a directory for *.pack.yaml files
  discover(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.pack.yaml') || f.endsWith('.pack.yml'))
      .map(f => path.join(dir, f))
  }

  private parseYaml(content: string): unknown {
    // Use JSON.parse via a YAML-to-JSON conversion
    // This works for the strict subset used in domain packs
    // (no complex anchors, no custom types)
    // We convert block scalars and then process as structured data
    const lines = content.split('\n')
    const result = this.parseLines(lines, 0, 0)
    return result.value
  }

  private parseLines(
    lines: string[],
    startIdx: number,
    baseIndent: number,
  ): { value: unknown; nextIdx: number } {
    // Implementation of a simple YAML parser for the pack format
    // Supports: key: value, key: >, - list items, nested maps
    // Full implementation omitted for brevity; in practice use
    // a well-tested minimal YAML parser like 'yaml' (pure JS, no native deps)
    // The actual implementation would be here
    return { value: {}, nextIdx: lines.length }
  }
}
```

> **Implementation note**: In practice, use the `yaml` npm package (pure JS, zero native deps,
> 15KB minified) rather than a hand-rolled parser. It handles the full YAML 1.2 spec
> including block scalars, anchors, and multi-line strings that domain packs will use heavily.
> Add it to `packages/main/package.json` as a dependency.

### 5.3 Pass D Orchestrator

```typescript
// packages/main/src/domain/passD/passDOrchestrator.ts
import type Database from 'better-sqlite3'
import type { AEPPassProgress, DomainPackManifest } from '@shared/index'
import { GlossaryIndexer }     from './glossaryIndexer'
import { BusinessRuleIndexer } from './businessRuleIndexer'
import { KPIIndexer }          from './kpiIndexer'
import { ContextIndexer }      from './contextIndexer'
import { EventIndexer }        from './eventIndexer'
import { RegulationIndexer }   from './regulationIndexer'

export class PassDOrchestrator {
  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {}

  run(
    packs:    DomainPackManifest[],
    progress: (p: AEPPassProgress) => void,
  ): { nodes: number; edges: number } {
    let totalNodes = 0, totalEdges = 0

    for (const pack of packs) {
      progress({ pass: 'D', stage: 'glossary', pct: 0,
                 detail: `${pack.name}: indexing ${pack.concepts?.length ?? 0} concepts…` })

      // A1: Glossary terms + synonyms → DOMAIN_CONCEPT + GLOSSARY_TERM nodes
      const g = new GlossaryIndexer(this.db, pack)
      totalNodes += g.index()

      progress({ pass: 'D', stage: 'rules', pct: 20,
                 detail: `${pack.name}: indexing ${pack.rules?.length ?? 0} business rules…` })

      // A2: Business rules → BUSINESS_RULE nodes
      const r = new BusinessRuleIndexer(this.db, pack)
      totalNodes += r.index()

      progress({ pass: 'D', stage: 'kpis', pct: 40,
                 detail: `${pack.name}: indexing ${pack.kpis?.length ?? 0} KPIs…` })

      // A3: KPIs → KPI nodes + kpi_registry rows
      const k = new KPIIndexer(this.db, pack)
      totalNodes += k.index()

      progress({ pass: 'D', stage: 'contexts', pct: 55,
                 detail: `${pack.name}: assigning files to bounded contexts…` })

      // A4: Bounded contexts → BOUNDED_CONTEXT nodes + BELONGS_TO_CONTEXT edges
      const c = new ContextIndexer(this.db, pack, this.root)
      const { nodes: cn, edges: ce } = c.index()
      totalNodes += cn; totalEdges += ce

      progress({ pass: 'D', stage: 'events', pct: 70,
                 detail: `${pack.name}: indexing ${pack.events?.length ?? 0} domain events…` })

      // A5: Domain events → DOMAIN_EVENT nodes + EMITS/CONSUMES edges
      const e = new EventIndexer(this.db, pack)
      totalNodes += e.index()

      progress({ pass: 'D', stage: 'regulations', pct: 85,
                 detail: `${pack.name}: applying regulation constraints…` })

      // A6: Regulations → REGULATION nodes + GOVERNED_BY edges on matched files
      const reg = new RegulationIndexer(this.db, pack, this.root)
      const { nodes: rn, edges: re } = reg.index()
      totalNodes += rn; totalEdges += re

      progress({ pass: 'D', stage: 'complete', pct: 100,
                 detail: `${pack.name}: ${totalNodes} nodes, ${totalEdges} edges` })
    }

    return { nodes: totalNodes, edges: totalEdges }
  }
}
```

### 5.4 Key Indexers

```typescript
// packages/main/src/domain/passD/glossaryIndexer.ts
import type Database from 'better-sqlite3'
import type { DomainPackManifest } from '@shared/index'

export class GlossaryIndexer {
  private readonly insertNode: Database.Statement
  private readonly insertEdge: Database.Statement
  private readonly getNode:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly pack: DomainPackManifest,
  ) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, 'domain_pack', ?, 'design', 0.95, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'domain_pack', unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  index(): number {
    let count = 0
    const batch = this.db.transaction(() => {
      for (const concept of this.pack.concepts ?? []) {
        // Main DOMAIN_CONCEPT node
        this.insertNode.run(
          'DOMAIN_CONCEPT',
          concept.name,
          concept.definition,
          `${this.pack.name}:concept:${concept.name}`,
        )
        count++

        const conceptNode = this.getNode.get('DOMAIN_CONCEPT', concept.name)
        if (!conceptNode) continue

        // Synonym nodes (GLOSSARY_TERM) → ABOUT → main concept
        for (const syn of concept.synonyms ?? []) {
          this.insertNode.run(
            'GLOSSARY_TERM', syn,
            `Synonym for "${concept.name}" in ${this.pack.domain}`,
            `${this.pack.name}:synonym:${syn}`,
          )
          const synNode = this.getNode.get('GLOSSARY_TERM', syn)
          if (synNode) {
            this.insertEdge.run(synNode.id, conceptNode.id, 'ABOUT')
          }
          count++
        }

        // Link to bounded context if specified
        if (concept.context) {
          const ctxNode = this.getNode.get('BOUNDED_CONTEXT', concept.context)
          if (ctxNode) {
            this.insertEdge.run(conceptNode.id, ctxNode.id, 'BELONGS_TO_CONTEXT')
          }
        }
      }
    })
    batch()
    return count
  }
}
```

```typescript
// packages/main/src/domain/passD/kpiIndexer.ts
import type Database from 'better-sqlite3'
import type { DomainPackManifest } from '@shared/index'

export class KPIIndexer {
  private readonly insertNode: Database.Statement
  private readonly insertKpi:  Database.Statement
  private readonly getNode:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly pack: DomainPackManifest,
  ) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES ('KPI', ?, ?, 'domain_pack', ?, 'requirements', 0.95, 0.5, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertKpi = db.prepare(`
      INSERT INTO kpi_registry
        (kpi_node_id, measurement_unit, measurement_window,
         telemetry_source, baseline_value, target_value, owner_org_unit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kpi_node_id) DO UPDATE SET
        measurement_unit    = excluded.measurement_unit,
        measurement_window  = excluded.measurement_window,
        telemetry_source    = excluded.telemetry_source,
        baseline_value      = excluded.baseline_value,
        target_value        = excluded.target_value,
        owner_org_unit      = excluded.owner_org_unit
    `)
    this.getNode = db.prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = "KPI" AND label = ? LIMIT 1'
    )
  }

  index(): number {
    let count = 0
    const batch = this.db.transaction(() => {
      for (const kpi of this.pack.kpis ?? []) {
        this.insertNode.run(
          kpi.name,
          kpi.description,
          `${this.pack.name}:kpi:${kpi.name}`,
        )
        const node = this.getNode.get(kpi.name)
        if (!node) continue

        this.insertKpi.run(
          node.id,
          kpi.unit,
          kpi.measurementWindow,
          kpi.telemetrySource ?? null,
          kpi.baseline ?? null,
          kpi.target ?? null,
          kpi.owner ?? null,
        )
        count++
      }
    })
    batch()
    return count
  }
}
```

```typescript
// packages/main/src/domain/passD/contextIndexer.ts
import path from 'node:path'
import { minimatch } from 'minimatch'   // npm: minimatch (pure JS, glob matching)
import type Database from 'better-sqlite3'
import type { DomainPackManifest } from '@shared/index'

export class ContextIndexer {
  private readonly insertNode: Database.Statement
  private readonly insertEdge: Database.Statement
  private readonly getNode:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly pack: DomainPackManifest,
    private readonly root: string,
  ) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES ('BOUNDED_CONTEXT', ?, ?, 'domain_pack', ?, 'design', 0.95, 0.8, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'BELONGS_TO_CONTEXT', 1.0, 0.90, 'domain_pack', unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  index(): { nodes: number; edges: number } {
    let nodes = 0, edges = 0

    const allFiles = this.db
      .prepare<[], { file_path: string }>('SELECT file_path FROM file_metadata')
      .all()

    const batch = this.db.transaction(() => {
      for (const ctx of this.pack.contexts ?? []) {
        // Create BOUNDED_CONTEXT node
        this.insertNode.run(
          ctx.name, ctx.description,
          `${this.pack.name}:context:${ctx.name}`,
        )
        const ctxNode = this.getNode.get('BOUNDED_CONTEXT', ctx.name)
        if (!ctxNode) continue
        nodes++

        // Assign matching files → BELONGS_TO_CONTEXT edges
        for (const pattern of ctx.filePaths ?? []) {
          for (const { file_path } of allFiles) {
            if (minimatch(file_path, pattern, { matchBase: true })) {
              // Find the file's primary graph node (CLASS or DOMAIN_SERVICE)
              const fileNode = this.db
                .prepare<[string], { id: number }>(
                  `SELECT id FROM graph_nodes WHERE file_path = ?
                   AND kind IN ('DOMAIN_SERVICE','CLASS','MODULE') LIMIT 1`
                )
                .get(file_path)
              if (fileNode) {
                this.insertEdge.run(fileNode.id, ctxNode.id)
                edges++
              }
            }
          }
        }
      }
    })
    batch()

    return { nodes, edges }
  }
}
```

```typescript
// packages/main/src/domain/passD/regulationIndexer.ts
import { minimatch } from 'minimatch'
import type Database from 'better-sqlite3'
import type { DomainPackManifest } from '@shared/index'

export class RegulationIndexer {
  private readonly insertNode: Database.Statement
  private readonly insertEdge: Database.Statement
  private readonly getNode:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly pack: DomainPackManifest,
    private readonly root: string,
  ) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES ('REGULATION', ?, ?, 'domain_pack', ?, 'design', 0.99, 0.9, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 0.99, 'domain_pack', unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  index(): { nodes: number; edges: number } {
    let nodes = 0, edges = 0
    const allFiles = this.db.prepare<[], { file_path: string }>(
      'SELECT file_path FROM file_metadata'
    ).all()

    const batch = this.db.transaction(() => {
      for (const reg of this.pack.regulations ?? []) {
        // REGULATION node (label = reg.id for precision)
        this.insertNode.run(reg.id, `${reg.name}\n\n${reg.body}`,
          `${this.pack.name}:regulation:${reg.id}`)
        const regNode = this.getNode.get('REGULATION', reg.id)
        if (!regNode) continue
        nodes++

        // GOVERNED_BY edges to matching files
        for (const pattern of reg.applies_to ?? []) {
          for (const { file_path } of allFiles) {
            if (minimatch(file_path, pattern, { matchBase: true })) {
              const fileNode = this.db
                .prepare<[string], { id: number }>(
                  `SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1`
                )
                .get(file_path)
              if (fileNode) {
                this.insertEdge.run(fileNode.id, regNode.id, 'GOVERNED_BY')
                edges++
              }
            }
          }
        }

        // CONSTRAINED_BY edges: rules that reference this regulation
        for (const rule of this.pack.rules?.filter(r => r.regulation === reg.id) ?? []) {
          const ruleNode = this.getNode.get('BUSINESS_RULE', rule.id)
          if (ruleNode) {
            this.insertEdge.run(ruleNode.id, regNode.id, 'GOVERNED_BY')
          }
        }
      }
    })
    batch()
    return { nodes, edges }
  }
}
```

### 5.5 Domain Enrichment — Connecting L0 to the ISS Graph

This module runs after Pass D and enriches ISS feature nodes with domain context.
It answers: "which domain concepts does this feature deal with?" — creating
`ABOUT` edges from FEATURE nodes to DOMAIN_CONCEPT nodes.

```typescript
// packages/main/src/domain/domainEnrichment.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { EmbeddingService } from '../indexer/embeddingService'

const ABOUT_CONFIDENCE_THRESHOLD = 0.72

export class DomainEnrichment {
  private readonly embedSvc: EmbeddingService
  private readonly insertEdge: Database.Statement

  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.embedSvc  = EmbeddingService.getInstance()
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'ABOUT', 1.0, ?, 'domain_enrichment', ?, unixepoch() * 1000)
    `)
  }

  /**
   * For each FEATURE/USER_STORY node without ABOUT edges,
   * embed its description and match against DOMAIN_CONCEPT embeddings.
   * Also does keyword matching for cases where embeddings are unavailable.
   */
  async enrich(): Promise<number> {
    let enriched = 0

    const features = this.db.prepare<[], { id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind IN ('FEATURE','USER_STORY')
         AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind = 'ABOUT')`
    ).all()

    const concepts = this.db.prepare<[], {
      id: number; label: string; description: string | null; embedding_vec: Buffer | null
    }>(
      `SELECT id, label, description, embedding_vec
       FROM graph_nodes WHERE kind IN ('DOMAIN_CONCEPT','GLOSSARY_TERM')`
    ).all()

    if (features.length === 0 || concepts.length === 0) return 0

    // Build a synonym lookup for keyword matching fallback
    const synonymMap = new Map<string, number>()  // term → concept_id
    for (const c of concepts) {
      synonymMap.set(c.label.toLowerCase(), c.id)
    }

    const batch = this.db.transaction(() => {
      for (const feature of features) {
        const text = `${feature.label} ${feature.description ?? ''}`.toLowerCase()

        // Pass 1: Keyword matching (always available, zero cost)
        for (const [term, conceptId] of synonymMap) {
          if (text.includes(term)) {
            this.insertEdge.run(feature.id, conceptId, 0.85,
              JSON.stringify({ method: 'keyword_match', term }))
            enriched++
          }
        }
      }
    })
    batch()

    // Pass 2: Embedding similarity (if available — enhances recall beyond keywords)
    // Skipped when embedding endpoint is down (graceful degradation)
    try {
      const available = await this.checkEmbeddingAvailable()
      if (!available) return enriched

      const toEmbed = features.filter(f => f.description && f.description.length > 10)
      for (let i = 0; i < toEmbed.length; i += 20) {
        const batch = toEmbed.slice(i, i + 20)
        const texts = batch.map(f => `${f.label}: ${f.description?.slice(0, 200)}`)
        const fVecs = await this.callEmbeddings(texts)
        if (!fVecs) break

        const embeddingBatch = this.db.transaction(() => {
          batch.forEach((f, j) => {
            const fVec = fVecs[j]
            if (!fVec) return
            for (const c of concepts) {
              if (!c.embedding_vec) continue
              const cVec = this.embedSvc.deserialize(c.embedding_vec)
              const cos  = this.embedSvc.cosine(fVec, cVec)
              if (cos >= ABOUT_CONFIDENCE_THRESHOLD) {
                this.insertEdge.run(f.id, c.id, cos,
                  JSON.stringify({ method: 'embedding_cosine', score: cos }))
                enriched++
              }
            }
          })
        })
        embeddingBatch()
      }
    } catch { /* embedding enrichment is optional */ }

    return enriched
  }

  private async checkEmbeddingAvailable(): Promise<boolean> {
    try {
      const r = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST', signal: AbortSignal.timeout(3_000),
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: ['test'] }),
      })
      return r.status !== 0
    } catch { return false }
  }

  private async callEmbeddings(texts: string[]): Promise<number[][] | null> {
    // Delegates to EmbeddingService instance
    return null  // actual implementation calls EmbeddingService.getInstance().hybridSearch
  }
}
```

### 5.6 Domain-Aware FIS Extension

The existing FIS formula gains a sixth signal `ζ` (zeta) — domain relevance:

```
FIS_v2(file, query) =
    α × BM25 + β × cosine + γ × PageRank + δ × CO_CHANGES_WITH
  + ε × phase_weight + ζ × domain_relevance
```

`domain_relevance(file)` = max cosine similarity between the query embedding and
the DOMAIN_CONCEPT nodes that the file's BOUNDED_CONTEXT contains, weighted by
the regulation count on the file (`GOVERNED_BY` degree). This boosts files in
the relevant domain context while surfacing GOVERNED_BY files as higher priority.

```typescript
// packages/main/src/domain/domainAwareFIS.ts
import type Database from 'better-sqlite3'
import { FISEngine } from '../iss/fisEngine'
import type { FISResult, SDLCMode, FISWeights } from '@shared/index'

// Extended weights include zeta
export type FISv2Weights = FISWeights & { zeta: number }

const DEFAULT_ZETA = 0.10  // 10% domain relevance; adjust per domain pack

export class DomainAwareFIS extends FISEngine {
  async scoreWithDomain(
    query:        string,
    sdlcMode:     SDLCMode,
    maxResults:   number = 20,
    domainPack?:  string,   // filter to a specific bounded context
  ): Promise<(FISResult & { domainRelevance: number; isGoverned: boolean })[]> {
    const base = await this.score(query, sdlcMode, maxResults * 2)

    // Enrich each result with domain signals
    return base.map(r => {
      const domainRelevance = this.getDomainRelevance(r.filePath, domainPack)
      const isGoverned = this.isGoverned(r.filePath)

      // Add zeta contribution (domain relevance) to score
      const enrichedScore = r.score * (1 - DEFAULT_ZETA) +
                            domainRelevance * DEFAULT_ZETA

      return {
        ...r,
        score: enrichedScore,
        domainRelevance,
        isGoverned,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
  }

  private getDomainRelevance(filePath: string, domainPack?: string): number {
    // Check if file belongs to a bounded context and what concepts it relates to
    const ctxRow = this.db
      .prepare<[string], { label: string; concept_count: number }>(`
        SELECT bc.label, COUNT(gn2.id) as concept_count
        FROM graph_nodes gn
        JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'BELONGS_TO_CONTEXT'
        JOIN graph_nodes bc ON bc.id = ge.to_node_id AND bc.kind = 'BOUNDED_CONTEXT'
        LEFT JOIN graph_edges ge2 ON ge2.to_node_id = bc.id AND ge2.kind = 'ABOUT'
        LEFT JOIN graph_nodes gn2 ON gn2.id = ge2.from_node_id
        WHERE gn.file_path = ?
        GROUP BY bc.label LIMIT 1
      `)
      .get(filePath)

    if (!ctxRow) return 0.0
    // Normalize by max concept count in any context (simple heuristic)
    return Math.min(1.0, ctxRow.concept_count / 10)
  }

  private isGoverned(filePath: string): boolean {
    const row = this.db
      .prepare<[string], { cnt: number }>(`
        SELECT COUNT(*) as cnt FROM graph_edges ge
        JOIN graph_nodes gn ON gn.file_path = ? AND gn.id = ge.from_node_id
        WHERE ge.kind = 'GOVERNED_BY'
      `)
      .get(filePath)
    return (row?.cnt ?? 0) > 0
  }
}
```

---

## 6. Level 2 — Upstream AEP (L−2 and L−1)

### 6.1 Pass E Orchestrator & Org Pack Loader

```typescript
// packages/main/src/aep/upstream/passE/passEOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import type { AEPPassProgress, OrgPackManifest } from '@shared/index'
import { CustomerSignalIngester } from './customerSignalIngester'
import { PainPointClusterer }     from './painPointClusterer'
import { OrgPackLoader }          from './orgPackLoader'
import { IPC } from '@shared/index'

export class PassEOrchestrator {
  constructor(
    private readonly db:          Database.Database,
    private readonly root:        string,
    private readonly win:         BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  private push = (p: AEPPassProgress) =>
    this.win.webContents.send('aep:passProgress', p)

  async ingestOrgPacks(packPaths: string[]): Promise<void> {
    this.push({ pass: 'E_org', stage: 'loading', pct: 0,
                detail: `Loading ${packPaths.length} org packs…` })
    const loader = new OrgPackLoader(this.db)
    for (const fp of packPaths) {
      await loader.load(fp)
    }
    this.push({ pass: 'E_org', stage: 'complete', pct: 100,
                detail: 'Org units, objectives, investments ingested' })
  }

  async ingestCustomerSignals(
    source:   string,    // 'zendesk'|'nps'|'manual'|'csv'
    content:  string,    // raw data (JSON/CSV/text depending on source)
  ): Promise<number> {
    this.push({ pass: 'E_signals', stage: 'ingesting', pct: 0,
                detail: `Ingesting signals from ${source}…` })
    const ingester = new CustomerSignalIngester(this.db)
    const count = ingester.ingest(source, content)
    this.push({ pass: 'E_signals', stage: 'complete', pct: 100,
                detail: `${count} signals ingested` })
    return count
  }

  async clusterPainPoints(): Promise<number> {
    this.push({ pass: 'E_cluster', stage: 'clustering', pct: 0,
                detail: 'Clustering signals into pain points…' })
    const clusterer = new PainPointClusterer(this.db, this.getProvider())
    const count = await clusterer.cluster(
      (pct, detail) => this.push({ pass: 'E_cluster', stage: 'clustering', pct, detail })
    )
    this.push({ pass: 'E_cluster', stage: 'complete', pct: 100,
                detail: `${count} pain points synthesized` })
    return count
  }
}
```

```typescript
// packages/main/src/aep/upstream/passE/orgPackLoader.ts
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import type { OrgPackManifest } from '@shared/index'

export class OrgPackLoader {
  private readonly insertNode: Database.Statement
  private readonly insertPack: Database.Statement
  private readonly getNode:    Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, 'org_pack', ?, 'requirements', 0.95, 0.5, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertPack = db.prepare(`
      INSERT INTO org_packs(name, version, file_path, loaded_at)
      VALUES (?, ?, ?, unixepoch() * 1000)
      ON CONFLICT(name) DO UPDATE SET version=excluded.version, loaded_at=excluded.loaded_at
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  async load(filePath: string): Promise<void> {
    const yaml = await import('yaml')
    const content = fs.readFileSync(filePath, 'utf8')
    const pack    = yaml.parse(content) as OrgPackManifest

    this.insertPack.run(pack.name, pack.version, filePath)

    const insertEdge = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'org_pack', unixepoch() * 1000)
    `)

    const batch = this.db.transaction(() => {
      // ORG_UNIT nodes
      for (const unit of pack.orgUnits ?? []) {
        this.insertNode.run('ORG_UNIT', unit.name,
          `Organizational unit: ${unit.name}`, `${pack.name}:unit:${unit.name}`)
      }

      // STAKEHOLDER_ROLE nodes
      for (const role of pack.roles ?? []) {
        this.insertNode.run('STAKEHOLDER_ROLE', role.name,
          `Role: ${role.name} in ${role.org_unit}`, `${pack.name}:role:${role.name}`)
        const roleNode = this.getNode.get('STAKEHOLDER_ROLE', role.name)
        const unitNode = this.getNode.get('ORG_UNIT', role.org_unit)
        if (roleNode && unitNode) insertEdge.run(roleNode.id, unitNode.id, 'OWNED_BY')
      }

      // BUSINESS_OBJECTIVE nodes + MEASURED_BY edges to KPIs
      for (const obj of pack.objectives ?? []) {
        this.insertNode.run('BUSINESS_OBJECTIVE', obj.label,
          `Objective: ${obj.label} (${obj.horizon})`,
          `${pack.name}:objective:${obj.id}`)
        const objNode = this.getNode.get('BUSINESS_OBJECTIVE', obj.label)
        if (!objNode) continue

        // OWNED_BY stakeholder role
        const roleNode = this.getNode.get('STAKEHOLDER_ROLE', obj.owner)
        if (roleNode) insertEdge.run(objNode.id, roleNode.id, 'OWNED_BY')

        // MEASURED_BY KPI links
        for (const kpiName of obj.kpis ?? []) {
          const kpiNode = this.getNode.get('KPI', kpiName)
          if (kpiNode) insertEdge.run(objNode.id, kpiNode.id, 'MEASURED_BY')
        }
      }

      // INVESTMENT nodes
      for (const inv of pack.investments ?? []) {
        this.insertNode.run('INVESTMENT', inv.label,
          `Investment: ${inv.label} — ${inv.budget} ${inv.currency} (${inv.horizon})`,
          `${pack.name}:investment:${inv.id}`)
      }
    })
    batch()
  }
}
```

### 6.2 Customer Signal Ingester

```typescript
// packages/main/src/aep/upstream/passE/customerSignalIngester.ts
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

// Normalizes raw signal data from various sources into graph_nodes + customer_signals rows.
// Privacy: raw text is stored in description field (graph is internal);
// customer identity is pseudonymized to a segment cohort immediately on ingestion.
export class CustomerSignalIngester {
  private readonly insertNode:   Database.Statement
  private readonly insertSignal: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase, sdlc_confidence,
         importance_score, created_at)
      VALUES ('CUSTOMER_SIGNAL', ?, ?, ?, 'requirements', 0.90, 0.0, unixepoch() * 1000)
    `)
    this.insertSignal = db.prepare(`
      INSERT INTO customer_signals
        (signal_node_id, source_system, source_id, customer_cohort, signal_type,
         raw_text_hash, signal_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
  }

  ingest(source: string, content: string): number {
    let records: { text: string; date: number; id?: string; cohort?: string; type?: string }[] = []

    try {
      if (source === 'zendesk' || source === 'json') {
        const parsed = JSON.parse(content) as { tickets?: unknown[]; data?: unknown[] }
        const arr = parsed.tickets ?? parsed.data ?? []
        records = (arr as Record<string, unknown>[]).map(t => ({
          text:   String(t['description'] ?? t['body'] ?? t['text'] ?? ''),
          date:   Number(t['created_at'] ? new Date(String(t['created_at'])).getTime() : Date.now()),
          id:     String(t['id'] ?? ''),
          cohort: this.extractCohort(t),
          type:   this.classifyType(String(t['description'] ?? '')),
        }))
      } else if (source === 'nps') {
        const parsed = JSON.parse(content) as { responses?: unknown[] }
        records = ((parsed.responses ?? []) as Record<string, unknown>[]).map(r => ({
          text:   String(r['comment'] ?? r['verbatim'] ?? ''),
          date:   Number(r['date'] ? new Date(String(r['date'])).getTime() : Date.now()),
          cohort: this.extractNpsCohort(r),
          type:   this.npsToType(Number(r['score'] ?? 7)),
        }))
      } else if (source === 'csv' || source === 'manual') {
        // One signal per line: date,cohort,type,text
        records = content.split('\n')
          .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
          .map(l => {
            const parts = l.split(',')
            const text  = parts.slice(3).join(',').trim()
            return {
              date:   new Date(parts[0]?.trim() ?? '').getTime() || Date.now(),
              cohort: parts[1]?.trim() ?? 'unknown',
              type:   parts[2]?.trim() ?? 'feature_request',
              text,
            }
          })
      }
    } catch { return 0 }

    let count = 0
    const batch = this.db.transaction(() => {
      for (const rec of records) {
        if (!rec.text || rec.text.length < 5) continue
        const label = rec.text.slice(0, 120) + (rec.text.length > 120 ? '…' : '')
        const hash  = crypto.createHash('sha256').update(rec.text).digest('hex')
        const result = this.insertNode.run(
          label, rec.text.slice(0, 2000), source
        )
        const nodeId = Number(result.lastInsertRowid)
        this.insertSignal.run(
          nodeId, source, rec.id ?? null,
          rec.cohort ?? 'unknown',
          rec.type ?? 'feature_request',
          hash, rec.date,
        )
        count++
      }
    })
    batch()
    return count
  }

  // Pseudonymize: extract segment label, not identity
  private extractCohort(ticket: Record<string, unknown>): string {
    const tags  = (ticket['tags'] as string[] | undefined) ?? []
    const org   = ticket['organization_name']
    // Map to segment names, never customer names/IDs
    if (tags.includes('fleet')) return 'fleet-operators'
    if (tags.includes('enterprise')) return 'enterprise'
    if (org) return 'enterprise'
    return 'individual'
  }

  private extractNpsCohort(r: Record<string, unknown>): string {
    return String(r['segment'] ?? r['plan'] ?? 'unknown')
  }

  private npsToType(score: number): string {
    if (score <= 6) return 'churn_risk'
    if (score <= 8) return 'usability'
    return 'feature_request'
  }

  private classifyType(text: string): string {
    const lower = text.toLowerCase()
    if (/bug|broken|error|crash|not working/i.test(lower)) return 'defect'
    if (/cancel|churn|leaving|switching/i.test(lower))      return 'churn_risk'
    if (/price|cost|expensive|cheaper/i.test(lower))        return 'pricing'
    if (/request|feature|please add|would love/i.test(lower)) return 'feature_request'
    return 'usability'
  }
}
```

### 6.3 Pain Point Clusterer

```typescript
// packages/main/src/aep/upstream/passE/painPointClusterer.ts
// Clusters CUSTOMER_SIGNAL nodes into PAIN_POINT nodes.
// Primary: embedding-based similarity clustering.
// Fallback: LLM-based grouping of signal descriptions.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { EmbeddingService } from '../../../indexer/embeddingService'

const CLUSTER_THRESHOLD = 0.78   // signals with cosine ≥ this → same pain point candidate

export class PainPointClusterer {
  private readonly insertNode:  Database.Statement
  private readonly insertEdge:  Database.Statement
  private readonly getNode:     Database.Statement
  private readonly embedSvc:    EmbeddingService

  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('PAIN_POINT', ?, ?, 'clustered', 'requirements', 0.75, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, ?, 'clusterer', ?, unixepoch() * 1000)
    `)
    this.getNode   = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
    this.embedSvc  = EmbeddingService.getInstance()
  }

  async cluster(
    progress: (pct: number, detail: string) => void,
  ): Promise<number> {
    // Get all unclustered signals (not yet connected to any PAIN_POINT)
    const signals = this.db.prepare<[], { id: number; label: string; description: string }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind = 'CUSTOMER_SIGNAL'
         AND id NOT IN (
           SELECT from_node_id FROM graph_edges WHERE kind = 'EXPRESSES'
         )
       LIMIT 500`   // batch limit per run
    ).all()

    if (signals.length === 0) return 0

    progress(0, `Clustering ${signals.length} unclustered signals…`)

    // Strategy: LLM-based grouping (always works; embedding enhances it)
    // Group signals into batches of 20 and ask the LLM to identify themes
    const themes: { theme: string; description: string; signalIds: number[] }[] = []
    const BATCH = 20

    for (let i = 0; i < signals.length; i += BATCH) {
      const batch = signals.slice(i, i + BATCH)
      const numbered = batch
        .map((s, j) => `[${i + j}] ${s.label.slice(0, 150)}`)
        .join('\n')

      progress(Math.round((i / signals.length) * 80),
               `Processing signals ${i}–${i + batch.length}…`)

      try {
        const resp = await this.provider.complete({
          model:   'claude-haiku-4-5',
          system:  'You identify common pain points from customer feedback. Return only JSON.',
          messages: [{
            role: 'user',
            content:
              `Group these customer signals into 2–5 pain points.\n` +
              `Return ONLY: [{"theme":"Pain point name","description":"One sentence","indices":[0,2,5]}]\n\n${numbered}`,
          }],
          max_tokens: 600,
        })

        const groups = JSON.parse(resp.replace(/```json|```/g, '').trim()) as
          { theme: string; description: string; indices: number[] }[]

        for (const g of groups) {
          themes.push({
            theme:       g.theme,
            description: g.description,
            signalIds:   g.indices.map(idx => batch[idx - i]?.id).filter((id): id is number => !!id),
          })
        }
      } catch { /* skip this batch on error */ }
    }

    // Write pain point nodes and EXPRESSES edges
    let painPointCount = 0
    const batch = this.db.transaction(() => {
      for (const t of themes) {
        this.insertNode.run(t.theme, t.description)
        const ppNode = this.getNode.get('PAIN_POINT', t.theme)
        if (!ppNode) continue
        painPointCount++

        for (const sigId of t.signalIds) {
          this.insertEdge.run(
            sigId, ppNode.id, 'EXPRESSES', 1.0,
            JSON.stringify({ clusterMethod: 'llm_grouping' })
          )
        }

        // Update importance_score: pain points with more signals are more important
        this.db.prepare(
          'UPDATE graph_nodes SET importance_score = ? WHERE id = ?'
        ).run(Math.min(1.0, t.signalIds.length / 20), ppNode.id)
      }
    })
    batch()

    progress(100, `${painPointCount} pain points synthesized from ${signals.length} signals`)
    return painPointCount
  }
}
```

### 6.4 A1 — Intake & Intent Classification Agent

```typescript
// packages/main/src/aep/upstream/agents/a1IntakeAgent.ts
// A1 reads unclustered pain points and existing features, deduplicates,
// and produces a BRIEF artifact node that routes to A2 and A4.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../artifactWriter'

export class A1IntakeAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(painPointIds: number[]): Promise<number> {
    const painPoints = painPointIds.map(id =>
      this.db.prepare<[number], { id: number; label: string; description: string; signal_count: number }>(
        `SELECT gn.id, gn.label, gn.description,
                COUNT(ge.from_node_id) as signal_count
         FROM graph_nodes gn
         LEFT JOIN graph_edges ge ON ge.to_node_id = gn.id AND ge.kind = 'EXPRESSES'
         WHERE gn.id = ? GROUP BY gn.id`
      ).get(id)
    ).filter((r): r is NonNullable<typeof r> => !!r)

    if (painPoints.length === 0) throw new Error('No pain points provided to A1')

    // Check for existing features that might already address these pain points
    const existingFeatures = this.db.prepare<[], { label: string }>(
      `SELECT label FROM graph_nodes WHERE kind IN ('FEATURE','EPIC') LIMIT 20`
    ).all().map(r => r.label).join('\n')

    const painPointSummary = painPoints.map(pp =>
      `PAIN POINT: "${pp.label}" (${pp.signal_count} signals)\n  ${pp.description}`
    ).join('\n\n')

    const prompt = `You are the Intake Agent for a product engineering platform.
Given the following synthesized pain points from customer signals, produce a structured BRIEF
that will be used by the Business Impact Agent (A2) and Product Impact Agent (A4).

Pain points to analyze:
${painPointSummary}

Existing features already in the backlog (for deduplication):
${existingFeatures || 'None yet'}

Produce a JSON BRIEF:
{
  "title": "Brief title — 10 words max",
  "classification": "new_feature|enhancement|defect|pricing_packaging|noise",
  "summary": "2–3 sentence description of what customers need",
  "evidence_strength": 0.0–1.0,
  "suggested_feature_name": "Short name for the feature",
  "is_duplicate_of": "existing feature name if duplicate, else null",
  "urgency": "high|medium|low",
  "recommended_segments": ["segment names likely affected"],
  "key_questions_for_a2": ["1-2 questions for business quantification"],
  "key_questions_for_a4": ["1-2 questions for technical assessment"]
}`

    const resp = await this.provider.complete({
      model:    'claude-sonnet-4-6',
      system:   'You produce structured product intake briefs. Return only JSON.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
    })

    const brief = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
      title: string; classification: string; summary: string;
      evidence_strength: number; suggested_feature_name: string;
      is_duplicate_of: string | null; urgency: string;
      recommended_segments: string[];
    }

    // Write the BRIEF artifact node
    const briefId = writeArtifactNode(this.db, {
      kind:          'BRIEF',
      label:         brief.title,
      description:   JSON.stringify(brief),
      agentId:       'A1',
      agentVersion:  '1.0.0',
      derivedFrom:   painPointIds,
      confidence:    brief.evidence_strength,
    })

    // Link pain points to the brief
    const linkEdge = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'MOTIVATES', 1.0, 1.0, 'A1', unixepoch() * 1000)
    `)
    for (const pp of painPoints) {
      linkEdge.run(pp.id, briefId)
    }

    return briefId
  }
}

// packages/main/src/aep/upstream/artifactWriter.ts
import type Database from 'better-sqlite3'

type ArtifactInput = {
  kind:          string
  label:         string
  description:   string
  agentId:       string
  agentVersion:  string
  derivedFrom:   number[]
  confidence:    number
  approvedByRole?: string
}

export function writeArtifactNode(db: Database.Database, input: ArtifactInput): number {
  const result = db.prepare(`
    INSERT INTO graph_nodes
      (kind, label, description, source_type, sdlc_phase,
       sdlc_confidence, importance_score, created_at)
    VALUES (?, ?, ?, 'agent_artifact', 'requirements', ?, 0.0, unixepoch() * 1000)
  `).run(input.kind, input.label, input.description, input.confidence)

  const nodeId = Number(result.lastInsertRowid)

  db.prepare(`
    INSERT INTO artifact_provenance
      (artifact_node_id, agent_id, agent_version, derived_from_json, confidence, approved_by_role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nodeId, input.agentId, input.agentVersion,
         JSON.stringify(input.derivedFrom), input.confidence,
         input.approvedByRole ?? null)

  return nodeId
}
```

### 6.5 A2 — Business Impact Agent

```typescript
// packages/main/src/aep/upstream/agents/a2BusinessImpactAgent.ts
// A2 quantifies business value as ranges with stated assumptions
// and drafts VALUE_HYPOTHESIS nodes.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../artifactWriter'

export class A2BusinessImpactAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(briefId: number): Promise<{
    assessmentId: number
    hypothesisIds: number[]
  }> {
    // Read the brief
    const brief = this.db
      .prepare<[number], { label: string; description: string }>(
        'SELECT label, description FROM graph_nodes WHERE id = ? LIMIT 1'
      )
      .get(briefId)
    if (!brief) throw new Error(`Brief node ${briefId} not found`)

    // Read relevant business context
    const objectives = this.db.prepare<[], { label: string }>(
      'SELECT label FROM graph_nodes WHERE kind = "BUSINESS_OBJECTIVE" LIMIT 10'
    ).all().map(r => r.label).join('\n')

    const kpis = this.db.prepare<[], { label: string; description: string; baseline: number | null }>(
      `SELECT gn.label, gn.description, kr.baseline_value as baseline
       FROM graph_nodes gn LEFT JOIN kpi_registry kr ON kr.kpi_node_id = gn.id
       WHERE gn.kind = 'KPI' LIMIT 15`
    ).all().map(k => `${k.label}: ${k.description} (baseline: ${k.baseline ?? 'unknown'})`).join('\n')

    const segments = this.db.prepare<[], { label: string }>(
      'SELECT label FROM graph_nodes WHERE kind = "SEGMENT" LIMIT 10'
    ).all().map(s => s.label).join(', ')

    // Read similar past hypotheses + their verdicts (the learning loop in action)
    const pastHypotheses = this.db.prepare<[], {
      label: string; magnitude: number; direction: string; actual_delta: number | null
    }>(
      `SELECT gn.label, vh.magnitude_pct as magnitude, vh.direction, vh.actual_delta_pct as actual_delta
       FROM value_hypotheses vh
       JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id
       WHERE vh.verdict_node_id IS NOT NULL
       ORDER BY gn.created_at DESC LIMIT 10`
    ).all()

    const historicalContext = pastHypotheses.length > 0 ?
      `Past hypotheses and outcomes (USE THESE TO CALIBRATE ESTIMATES):\n` +
      pastHypotheses.map(h =>
        `  ${h.label}: predicted ${h.direction} ${h.magnitude}%, actual ${h.actual_delta ?? 'TBD'}`
      ).join('\n') :
      'No past hypothesis verdicts available yet.'

    const prompt = `You are the Business Impact Agent. Given a product brief, quantify the business
impact as RANGES (not point estimates). Draft falsifiable VALUE_HYPOTHESIS entries.

BRIEF:
${brief.label}
${brief.description}

BUSINESS CONTEXT:
Strategic objectives:
${objectives || 'Not yet defined'}

Available KPIs:
${kpis || 'Not yet defined'}

Customer segments:
${segments || 'Not yet identified'}

${historicalContext}

IMPORTANT: Base estimates on historical data where available. State your assumptions explicitly.
Never claim higher confidence than the evidence warrants.

Return JSON:
{
  "value_range": {
    "low_usd": 0,
    "high_usd": 0,
    "timeframe": "quarterly|annual",
    "assumptions": ["assumption 1", "assumption 2"]
  },
  "affected_segment_pct": 0.0,
  "objective_advancement": "which objective this advances and how",
  "hypotheses": [
    {
      "kpi_name": "exact KPI label from the list above",
      "direction": "increase|decrease|stabilize",
      "magnitude_pct": 0.0,
      "timeframe_days": 90,
      "prior_confidence": 0.0,
      "attribution_method": "ab_flag|canary|before_after|holdout",
      "rationale": "why this magnitude is credible"
    }
  ],
  "risks": [
    { "label": "risk label", "description": "risk description", "severity": "high|medium|low" }
  ],
  "agent_confidence": 0.0
}`

    const resp = await this.provider.complete({
      model: 'claude-sonnet-4-6',
      system: 'You are a business impact analyst. Return only JSON. Never overclaim causality.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
    })

    const analysis = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
      value_range: { low_usd: number; high_usd: number; assumptions: string[] }
      hypotheses: { kpi_name: string; direction: string; magnitude_pct: number;
                    timeframe_days: number; prior_confidence: number;
                    attribution_method: string; rationale: string }[]
      risks: { label: string; description: string; severity: string }[]
      agent_confidence: number
    }

    // Write BUSINESS_IMPACT_ASSESSMENT artifact
    const assessmentId = writeArtifactNode(this.db, {
      kind:         'BUSINESS_IMPACT_ASSESSMENT',
      label:        `Business Impact: ${brief.label}`,
      description:  JSON.stringify(analysis),
      agentId:      'A2',
      agentVersion: '1.0.0',
      derivedFrom:  [briefId],
      confidence:   analysis.agent_confidence,
    })

    // Write draft VALUE_HYPOTHESIS nodes (not yet committed — await PRIORITIZE gate)
    const hypothesisIds: number[] = []
    const insertHyp = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('VALUE_HYPOTHESIS', ?, ?, 'agent_draft', 'requirements', ?, 0.0, unixepoch() * 1000)
    `)
    const insertHypDetail = this.db.prepare(`
      INSERT INTO value_hypotheses
        (hypothesis_node_id, kpi_node_id, direction, magnitude_pct,
         timeframe_days, prior_confidence, attribution_method, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
    `)
    const insertEdge = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, ?, 'A2', unixepoch() * 1000)
    `)

    const batchHyp = this.db.transaction(() => {
      for (const hyp of analysis.hypotheses ?? []) {
        const kpiNode = this.db
          .prepare<[string], { id: number }>(
            'SELECT id FROM graph_nodes WHERE kind = "KPI" AND label = ? LIMIT 1'
          )
          .get(hyp.kpi_name)
        if (!kpiNode) continue

        const hypResult = insertHyp.run(
          `H: ${hyp.direction} ${hyp.kpi_name} by ${hyp.magnitude_pct}% in ${hyp.timeframe_days}d`,
          hyp.rationale,
          hyp.prior_confidence,
        )
        const hypId = Number(hypResult.lastInsertRowid)
        insertHypDetail.run(
          hypId, kpiNode.id, hyp.direction, hyp.magnitude_pct,
          hyp.timeframe_days, hyp.prior_confidence, hyp.attribution_method,
        )
        insertEdge.run(hypId, kpiNode.id, 'PREDICTS', hyp.prior_confidence)
        insertEdge.run(assessmentId, hypId, 'JUSTIFIED_BY', 1.0)
        hypothesisIds.push(hypId)
      }

      // Write RISK nodes
      for (const risk of analysis.risks ?? []) {
        const riskResult = this.db.prepare(`
          INSERT INTO graph_nodes
            (kind, label, description, source_type, sdlc_phase,
             sdlc_confidence, importance_score, created_at)
          VALUES ('RISK', ?, ?, 'A2', 'requirements', 0.80, 0.3, unixepoch() * 1000)
        `).run(risk.label, risk.description)
        const riskId = Number(riskResult.lastInsertRowid)
        insertEdge.run(assessmentId, riskId, 'EXPOSED_TO', 0.80)
      }
    })
    batchHyp()

    return { assessmentId, hypothesisIds }
  }
}
```

### 6.6 A3 — GTM Alignment Agent

```typescript
// packages/main/src/aep/upstream/agents/a3GtmAlignmentAgent.ts
// A3 is a lightweight projection of A2's output into GTM vocabulary.
// It does NOT re-run the analysis — it translates and adds GTM-specific concerns.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../artifactWriter'

export class A3GtmAlignmentAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(assessmentId: number): Promise<number> {
    const assessment = this.db
      .prepare<[number], { label: string; description: string }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?'
      )
      .get(assessmentId)
    if (!assessment) throw new Error(`Assessment ${assessmentId} not found`)

    const pricingNodes = this.db.prepare<[], { label: string }>(
      'SELECT label FROM graph_nodes WHERE kind = "PRICING_IMPACT" LIMIT 5'
    ).all().map(p => p.label)

    const prompt = `You are a GTM analyst. Translate a business impact assessment into
GTM-specific recommendations.

Assessment:
${assessment.description}

Existing pricing tiers/impacts:
${pricingNodes.join(', ') || 'Not yet mapped'}

Return JSON:
{
  "positioning": "1–2 sentences: how to position this capability",
  "target_tier": "free|starter|pro|enterprise|custom",
  "launch_tier": "tier1|tier2|tier3",
  "pricing_recommendation": "no change|bundled|add_on|gating_feature",
  "sales_enablement_needs": ["training needed", "competitive card"],
  "competitive_gap_addressed": "which competitor gap this closes or null"
}`

    const resp = await this.provider.complete({
      model: 'claude-haiku-4-5',
      system: 'You are a GTM analyst. Return only JSON.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
    })

    const gtm = JSON.parse(resp.replace(/```json|```/g, '').trim())

    return writeArtifactNode(this.db, {
      kind:         'BUSINESS_IMPACT_ASSESSMENT',
      label:        `GTM: ${assessment.label}`,
      description:  JSON.stringify(gtm),
      agentId:      'A3',
      agentVersion: '1.0.0',
      derivedFrom:  [assessmentId],
      confidence:   0.75,
    })
  }
}
```

### 6.7 A4 — Product/Dev Impact Agent (FIS v2)

```typescript
// packages/main/src/aep/upstream/agents/a4DevImpactAgent.ts
// A4 runs FIS v2 (domain-aware) to produce the technical impact picture:
// files touched, blast radius, governed code, effort estimate, reuse opportunities.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { DomainAwareFIS } from '../../../domain/domainAwareFIS'
import { writeArtifactNode } from '../artifactWriter'

export class A4DevImpactAgent {
  private readonly fis: DomainAwareFIS

  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.fis = new DomainAwareFIS(db)
  }

  async run(briefId: number): Promise<number> {
    const brief = this.db
      .prepare<[number], { label: string; description: string }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?'
      )
      .get(briefId)
    if (!brief) throw new Error(`Brief ${briefId} not found`)

    // Parse the brief to extract the feature description
    let featureDescription = brief.label
    try {
      const parsed = JSON.parse(brief.description) as { summary?: string }
      featureDescription = parsed.summary ?? brief.label
    } catch { /* use label as-is */ }

    // Run FIS v2 (domain-aware) in requirements mode
    const fisResults = await this.fis.scoreWithDomain(featureDescription, 'requirements', 20)

    // Identify governed code in top results
    const governedFiles = fisResults.filter(r => r.isGoverned).map(r => r.filePath)

    // Find reuse opportunities (similar existing DOMAIN_SERVICE patterns)
    const reuseOps = this.db.prepare<[string], { label: string; file_path: string | null }>(
      `SELECT label, file_path FROM graph_nodes WHERE kind = 'DOMAIN_SERVICE'
       AND LOWER(label) LIKE LOWER(?) ORDER BY importance_score DESC LIMIT 5`
    ).all(`%${featureDescription.split(' ').slice(0, 2).join('%')}%`)

    // Effort estimation via LLM
    const topFiles = fisResults.slice(0, 10)
      .map(r => `${r.filePath} (FIS: ${r.score.toFixed(2)}, phase: ${r.sdlcPhase ?? '?'}, ${r.isGoverned ? 'GOVERNED' : ''})`)
      .join('\n')

    const prompt = `You are a senior engineer estimating development effort for a feature.

Feature: ${featureDescription}

Top affected files (FIS v2 scores):
${topFiles}

Governed code files (require compliance review):
${governedFiles.join('\n') || 'None identified'}

Reuse opportunities:
${reuseOps.map(r => `${r.label} in ${r.file_path}`).join('\n') || 'None found'}

Estimate development effort as a RANGE (acknowledge uncertainty):
Return JSON:
{
  "effort_low_weeks": 0,
  "effort_high_weeks": 0,
  "effort_assumptions": ["assumption 1"],
  "compliance_friction": "none|low|medium|high",
  "compliance_detail": "which regulations and what review they need",
  "reuse_savings": "none|small|significant",
  "reuse_detail": "which patterns can be reused",
  "risk_flags": ["technical risk 1"],
  "agent_confidence": 0.0
}`

    const resp = await this.provider.complete({
      model: 'claude-sonnet-4-6',
      system: 'You are a senior engineer. Return only JSON.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    })

    const estimate = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
      effort_low_weeks: number; effort_high_weeks: number;
      compliance_friction: string; agent_confidence: number
    }

    const assessmentData = {
      fisTopFiles: fisResults.slice(0, 10),
      governedFiles,
      reuseOpportunities: reuseOps,
      effortEstimate: estimate,
    }

    // Write COST_ESTIMATE node
    const costResult = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase, sdlc_confidence,
         importance_score, created_at)
      VALUES ('COST_ESTIMATE', ?, ?, 'A4', 'requirements', ?, 0.0, unixepoch() * 1000)
    `).run(
      `Effort: ${estimate.effort_low_weeks}–${estimate.effort_high_weeks} weeks`,
      JSON.stringify(estimate),
      estimate.agent_confidence,
    )

    const assessmentId = writeArtifactNode(this.db, {
      kind:         'DEV_IMPACT_ASSESSMENT',
      label:        `Dev Impact: ${brief.label}`,
      description:  JSON.stringify(assessmentData),
      agentId:      'A4',
      agentVersion: '1.0.0',
      derivedFrom:  [briefId],
      confidence:   estimate.agent_confidence,
    })

    // Link assessment to cost estimate
    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'ESTIMATED_BY', 1.0, 1.0, 'A4', unixepoch() * 1000)
    `).run(assessmentId, Number(costResult.lastInsertRowid))

    return assessmentId
  }
}
```

### 6.8 A5 — Portfolio Reconciliation Agent

```typescript
// packages/main/src/aep/upstream/agents/a5PortfolioAgent.ts
// A5 assembles the decision packet for human review.
// It PREPARES the portfolio decision; it never makes it.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../artifactWriter'

export class A5PortfolioAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async assemblePacket(
    briefId:         number,
    businessAssessId: number,
    devAssessId:     number,
  ): Promise<number> {
    const [brief, bizAssess, devAssess] = [briefId, businessAssessId, devAssessId].map(id =>
      this.db.prepare<[number], { label: string; description: string }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?'
      ).get(id)
    )

    if (!brief || !bizAssess || !devAssess) throw new Error('Missing inputs for A5')

    // Read current capacity
    const investments = this.db.prepare<[], { label: string }>(
      'SELECT label FROM graph_nodes WHERE kind = "INVESTMENT" LIMIT 5'
    ).all().map(i => i.label)

    // Find dependency conflicts (PRECEDED_BY edges from similar in-flight features)
    const inFlight = this.db.prepare<[], { label: string; stream_state: string }>(
      `SELECT gn.label, vss.stream_state FROM value_stream_state vss
       JOIN graph_nodes gn ON gn.id = vss.feature_node_id
       WHERE vss.stream_state NOT IN ('LEARN','RELEASE') LIMIT 10`
    ).all()

    const prompt = `You are the Portfolio Reconciliation Agent. Assemble a decision packet
for human review (CPO/CTO/CBO forum). You DO NOT make the decision — you surface evidence.

Brief: ${brief.label}

Business Assessment:
${bizAssess.description.slice(0, 800)}

Dev Assessment:
${devAssess.description.slice(0, 800)}

Current investment capacity: ${investments.join(', ') || 'Not defined'}

In-flight features (potential contention):
${inFlight.map(f => `${f.label} (state: ${f.stream_state})`).join('\n') || 'None'}

Produce a decision packet. Return JSON:
{
  "recommendation": "admit|defer|reject|needs_more_info",
  "value_score": 0.0–10.0,
  "cost_score": 0.0–10.0,
  "risk_score": 0.0–10.0,
  "dependency_conflicts": ["conflict description"],
  "sequencing_suggestion": "if deferring, suggest when and why",
  "required_human_decision_points": ["what humans must decide"],
  "questions_for_forum": ["1–3 questions for the human forum to answer"]
}`

    const resp = await this.provider.complete({
      model: 'claude-sonnet-4-6',
      system: 'You are a portfolio analyst. Return only JSON. You make recommendations, not decisions.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    })

    const packet = JSON.parse(resp.replace(/```json|```/g, '').trim())

    return writeArtifactNode(this.db, {
      kind:         'BUSINESS_IMPACT_ASSESSMENT',  // reuses artifact kind; label distinguishes
      label:        `Portfolio Packet: ${brief.label}`,
      description:  JSON.stringify(packet),
      agentId:      'A5',
      agentVersion: '1.0.0',
      derivedFrom:  [briefId, businessAssessId, devAssessId],
      confidence:   0.80,
    })
  }
}
```

### 6.9 VALUE_HYPOTHESIS Registry

```typescript
// packages/main/src/aep/upstream/hypothesisRegistry.ts
// Central manager for hypothesis lifecycle: draft → committed → verdict
import type Database from 'better-sqlite3'

export class HypothesisRegistry {
  constructor(private readonly db: Database.Database) {}

  /** Commits a hypothesis — transitions it from draft to registered.
   * This is the PRIORITIZE gate action that locks in the pre-registration. */
  commit(hypothesisNodeId: number, decisionRecordId: number): void {
    // Mark the hypothesis as committed by linking to the decision record
    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'JUSTIFIED_BY', 1.0, 1.0, 'portfolio_gate', unixepoch() * 1000)
    `).run(hypothesisNodeId, decisionRecordId)

    // Update source_type from 'agent_draft' to 'committed'
    this.db.prepare(
      `UPDATE graph_nodes SET source_type = 'committed' WHERE id = ?`
    ).run(hypothesisNodeId)
  }

  /** Returns all uncommitted hypotheses for a feature (to force commitment at PRIORITIZE gate) */
  getUncommittedForFeature(featureNodeId: number): number[] {
    return this.db.prepare<[number], { id: number }>(`
      SELECT vh.hypothesis_node_id as id
      FROM value_hypotheses vh
      JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = vh.hypothesis_node_id
      JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id AND gn.source_type = 'agent_draft'
    `).all(featureNodeId).map(r => r.id)
  }

  /** Summary of all hypotheses and their verdict status */
  getPortfolio(): {
    id: number; label: string; kpi: string; magnitude: number;
    direction: string; priorConf: number; verdict: string | null; actualDelta: number | null
  }[] {
    return this.db.prepare<[], {
      id: number; label: string; kpi: string; magnitude: number;
      direction: string; prior_confidence: number;
      verdict_node_id: number | null; actual_delta: number | null
    }>(`
      SELECT gn.id, gn.label, kpi.label as kpi,
             vh.magnitude_pct as magnitude, vh.direction,
             vh.prior_confidence, vh.verdict_node_id, vh.actual_delta_pct as actual_delta
      FROM value_hypotheses vh
      JOIN graph_nodes gn  ON gn.id  = vh.hypothesis_node_id
      JOIN graph_nodes kpi ON kpi.id = vh.kpi_node_id
      WHERE gn.source_type = 'committed'
      ORDER BY gn.created_at DESC
    `).all() as unknown as ReturnType<typeof this.getPortfolio>
  }
}
```

### 6.10 Portfolio Gate — The PRIORITIZE Transition

```typescript
// packages/main/src/aep/upstream/portfolioGate.ts
// The human-gate mechanism for the PRIORITIZE state.
// A human (CPO/CTO/CBO forum) calls this after reviewing A5's packet.
// This is the moment that formally admits a feature into L1.
import type Database from 'better-sqlite3'
import { HypothesisRegistry } from './hypothesisRegistry'

type PortfolioDecision = {
  featureNodeId: number
  portfolioPacketId: number
  decision:      'admit' | 'defer' | 'reject'
  approvedByRole: string   // STAKEHOLDER_ROLE label — the human who decided
  rationale:     string
  fundedByInvestmentId?: number
  advancesObjectiveId?: number
}

export function executePortfolioGate(
  db:    Database.Database,
  input: PortfolioDecision,
): { decisionRecordId: number } {
  // 1. Write the DECISION_RECORD artifact node
  const drResult = db.prepare(`
    INSERT INTO graph_nodes
      (kind, label, description, source_type, sdlc_phase,
       sdlc_confidence, importance_score, created_at)
    VALUES ('DECISION_RECORD', ?, ?, 'human_gate', 'requirements', 1.0, 1.0, unixepoch() * 1000)
  `).run(
    `Portfolio Decision: ${input.decision} (by ${input.approvedByRole})`,
    JSON.stringify({
      decision:       input.decision,
      approvedByRole: input.approvedByRole,
      rationale:      input.rationale,
    })
  )
  const drId = Number(drResult.lastInsertRowid)

  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO graph_edges
      (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
    VALUES (?, ?, ?, 1.0, 1.0, 'portfolio_gate', unixepoch() * 1000)
  `)

  // 2. Link the packet → decision record
  insertEdge.run(input.portfolioPacketId, drId, 'JUSTIFIED_BY')

  if (input.decision === 'admit') {
    // 3. Commit all draft hypotheses for this feature
    const registry = new HypothesisRegistry(db)
    const uncommitted = registry.getUncommittedForFeature(input.featureNodeId)
    for (const hypId of uncommitted) registry.commit(hypId, drId)

    // 4. Wire ADVANCES + FUNDED_BY edges
    if (input.advancesObjectiveId) {
      insertEdge.run(input.featureNodeId, input.advancesObjectiveId, 'ADVANCES')
    }
    if (input.fundedByInvestmentId) {
      insertEdge.run(input.featureNodeId, input.fundedByInvestmentId, 'FUNDED_BY')
    }

    // 5. Advance value stream state INTAKE → QUALIFY → PRIORITIZE → DEFINE
    db.prepare(`
      INSERT INTO value_stream_state (feature_node_id, stream_state, entered_state_at, last_transition_record)
      VALUES (?, 'DEFINE', unixepoch() * 1000, ?)
      ON CONFLICT(feature_node_id) DO UPDATE SET
        stream_state = 'DEFINE',
        entered_state_at = unixepoch() * 1000,
        last_transition_record = excluded.last_transition_record
    `).run(input.featureNodeId, drId)
  } else {
    // defer or reject: update stream state, record reason
    db.prepare(`
      INSERT INTO value_stream_state (feature_node_id, stream_state, entered_state_at, blocked_on_json)
      VALUES (?, ?, unixepoch() * 1000, ?)
      ON CONFLICT(feature_node_id) DO UPDATE SET
        stream_state = excluded.stream_state,
        entered_state_at = excluded.entered_state_at,
        blocked_on_json = excluded.blocked_on_json
    `).run(
      input.featureNodeId,
      input.decision === 'defer' ? 'INTAKE' : 'LEARN',
      JSON.stringify({ reason: input.rationale, decidedBy: input.approvedByRole })
    )
  }

  return { decisionRecordId: drId }
}
```

---

## 7. AEP IPC Handlers — Part 1

```typescript
// packages/main/src/aep/aepIpcHandlers.ts (excerpt — Level 1 and 2 channels)

export function registerAepIpcHandlers(
  ipcMain:      Electron.IpcMain,
  db:           Database.Database,
  root:         string,
  win:          BrowserWindow,
  getProvider:  () => ILLMProvider,
): void {

  // ── Domain Pack (Level 1) ──────────────────────────────────────────────────
  ipcMain.handle('domain:listPacks', () =>
    db.prepare('SELECT name, version, loaded_at, node_count FROM domain_packs').all()
  )

  ipcMain.handle('domain:loadPack', async (_e, { filePath }: { filePath: string }) => {
    const loader = new DomainPackLoader()
    const pack   = loader.load(filePath)
    const errors = loader.validate(pack)
    if (errors.length > 0) throw new Error(`Validation errors: ${errors.join('; ')}`)

    const push = (p: AEPPassProgress) => win.webContents.send('aep:passProgress', p)
    const { nodes, edges } = new PassDOrchestrator(db, root).run([pack], push)

    db.prepare(`
      INSERT INTO domain_packs(name, version, file_path, loaded_at, node_count)
      VALUES (?, ?, ?, unixepoch() * 1000, ?)
      ON CONFLICT(name) DO UPDATE SET version=excluded.version, node_count=excluded.node_count
    `).run(pack.name, pack.version, filePath, nodes)

    // Enrich ISS graph with new domain context
    await new DomainEnrichment(db, getProvider()).enrich()

    return { nodes, edges }
  })

  ipcMain.handle('domain:getKpis', () =>
    db.prepare(`
      SELECT gn.id, gn.label, gn.description, kr.measurement_unit, kr.measurement_window,
             kr.baseline_value, kr.target_value, kr.owner_org_unit
      FROM graph_nodes gn JOIN kpi_registry kr ON kr.kpi_node_id = gn.id
      WHERE gn.kind = 'KPI' ORDER BY gn.label
    `).all()
  )

  ipcMain.handle('domain:getContexts', () =>
    db.prepare(`SELECT id, label, description FROM graph_nodes WHERE kind = 'BOUNDED_CONTEXT'`).all()
  )

  ipcMain.handle('domain:getRegulations', () =>
    db.prepare(`SELECT id, label, description FROM graph_nodes WHERE kind = 'REGULATION'`).all()
  )

  // ── Customer signals (Level 2) ─────────────────────────────────────────────
  ipcMain.handle('aep:ingestSignals', async (_e, { source, content }) =>
    new PassEOrchestrator(db, root, win, getProvider).ingestCustomerSignals(source, content)
  )

  ipcMain.handle('aep:clusterPainPoints', async () =>
    new PassEOrchestrator(db, root, win, getProvider).clusterPainPoints()
  )

  ipcMain.handle('aep:getPainPoints', () =>
    db.prepare(`
      SELECT gn.id, gn.label, gn.description, gn.importance_score,
             COUNT(ge.from_node_id) as signal_count
      FROM graph_nodes gn
      LEFT JOIN graph_edges ge ON ge.to_node_id = gn.id AND ge.kind = 'EXPRESSES'
      WHERE gn.kind = 'PAIN_POINT'
      GROUP BY gn.id ORDER BY signal_count DESC
    `).all()
  )

  // ── Agent runs (Level 2) ────────────────────────────────────────────────────
  ipcMain.handle('aep:runA1', async (_e, { painPointIds }) =>
    new A1IntakeAgent(db, getProvider()).run(painPointIds)
  )

  ipcMain.handle('aep:runA2', async (_e, { briefId }) =>
    new A2BusinessImpactAgent(db, getProvider()).run(briefId)
  )

  ipcMain.handle('aep:runA4', async (_e, { briefId }) =>
    new A4DevImpactAgent(db, getProvider()).run(briefId)
  )

  ipcMain.handle('aep:runA5', async (_e, { briefId, bizId, devId }) =>
    new A5PortfolioAgent(db, getProvider()).assemblePacket(briefId, bizId, devId)
  )

  // ── Portfolio gate (human action) ──────────────────────────────────────────
  ipcMain.handle('aep:portfolioGate', (_e, input: PortfolioDecision) =>
    executePortfolioGate(db, input)
  )

  // ── Hypotheses ─────────────────────────────────────────────────────────────
  ipcMain.handle('aep:getHypotheses', () =>
    new HypothesisRegistry(db).getPortfolio()
  )

  // ── Value stream state ─────────────────────────────────────────────────────
  ipcMain.handle('aep:getValueStream', () =>
    db.prepare(`
      SELECT gn.id, gn.label, vss.stream_state, vss.entered_state_at, vss.blocked_on_json
      FROM value_stream_state vss
      JOIN graph_nodes gn ON gn.id = vss.feature_node_id
      ORDER BY vss.entered_state_at DESC
    `).all()
  )

  ipcMain.handle('aep:loadOrgPacks', async (_e, { packPaths }) =>
    new PassEOrchestrator(db, root, win, getProvider).ingestOrgPacks(packPaths)
  )
}
```

---

## 8. Renderer Panels — Part 1

### 8.1 DomainBrowserPanel

```
┌──────────────────────────────────────────────────────────────────────┐
│  Domain Ontology                            [ + Load Domain Pack ]   │
│  ──────────────────────────────────────────────────────────────────  │
│  Loaded packs: mlff-tolling v1.0 · generic-saas v1.1                │
│                                                                      │
│  [ Concepts ] [ Business Rules ] [ KPIs ] [ Contexts ] [ Regs ]     │
│  ─────────────────────────── KPIs ───────────────────────────────── │
│  charge_dispute_rate                                                 │
│    Unit: percentage  · Window: 30d rolling                           │
│    Baseline: 2.3%  ←─────────────────→  Target: 1.5%               │
│    Owner: Operations  · Source: analytics_warehouse                  │
│    Hypotheses: 3 committed · 1 validated · 2 pending                │
│                                                                      │
│  dispute_resolution_time_p95                                         │
│    Unit: hours  · Window: weekly                                     │
│    Baseline: 72h  ←────────────────────────────→  Target: 24h       │
│    Owner: Operations                                                 │
│                                                                      │
│  ──────────────────── Bounded Contexts ──────────────────────────── │
│  charge-lifecycle      32 files  ·  2 regulations  ·  1 event       │
│  dispute-management    18 files  ·  1 regulation   ·  2 events      │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 ValueStreamPanel (Kanban-style FSM view)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Value Stream                              Filter: [ All States ▾ ]  │
│                                                                      │
│  INTAKE    QUALIFY   PRIORITIZE   DEFINE    BUILD   CONSOLIDATE     │
│  ────────  ────────  ──────────   ──────    ─────   ────────────     │
│  [Bulk     [OTP                   [Fleet    [Auth   [Recurring       │
│   Dispute   Login]                 Dispute]  Refactor] Billing]      │
│   Request]                                                           │
│                                                                      │
│  2 items   1 item    0 items      3 items   8 items  1 item          │
│                                                                      │
│  ─────────────────── Selected: Fleet Dispute Management ─────────── │
│  State: DEFINE  ·  Entered: 3 days ago                               │
│  Hypotheses: H1 (churn −2pp, conf 0.55) · H2 (cost −60%, conf 0.7)  │
│  Governed code: NHAI-MLFF-SPEC-4.2 (compliance review required)      │
│  Effort: 6–9 dev-weeks                                               │
│                                                                      │
│  [ View Brief ] [ View Hypotheses ] [ Run FIS v2 ] [ Gate: Admit → ] │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.3 BusinessValuePanel

```
┌──────────────────────────────────────────────────────────────────────┐
│  Business Value · Hypotheses            Alignment mode: ● Embedding  │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                      │
│  VALUE HYPOTHESES                                                    │
│  ─────────────────────────────────────────────────────────────────  │
│  H: decrease charge_dispute_rate by 15% in 90d                       │
│    Prior conf: 0.55  ·  Method: canary  ·  State: COMMITTED         │
│    KPI current: 2.3%  →  Target: 1.96%                              │
│    Linked feature: Fleet Dispute Management                           │
│    [ View Verdict ] ← not yet available                              │
│                                                                      │
│  H: decrease dispute_resolution_time_p95 by 60% in 90d               │
│    Prior conf: 0.70  ·  Method: canary  ·  State: VALIDATED ✅       │
│    Actual: −64%  ·  Final conf: 0.90                                 │
│    [ View Verdict ] [ View Learning ]                                │
│                                                                      │
│  CUSTOMER SIGNALS                                                    │
│  34 unclustered · 12 pain points · 3 linked to features             │
│  [ Run Clustering ] [ View Pain Points ] [ Run A1 Intake ]           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 9. Level 1 & 2 Build Order

| Milestone | What | Gate |
|---|---|---|
| **M-D0** | Schema V3 migration | All new tables created; `domain_packs` row insertable |
| **M-D1** | DomainPackLoader + validation | Load `mlff-tolling.pack.yaml`; no parse errors |
| **M-D2** | GlossaryIndexer + KPIIndexer + RegulationIndexer | `graph_nodes` has DOMAIN_CONCEPT + KPI + REGULATION rows; `kpi_registry` populated |
| **M-D3** | ContextIndexer + EventIndexer + BusinessRuleIndexer | BOUNDED_CONTEXT + DOMAIN_EVENT + BUSINESS_RULE nodes; `BELONGS_TO_CONTEXT` edges on matching files |
| **M-D4** | DomainEnrichment (ABOUT edges) | FEATURE nodes have `ABOUT` edges to domain concepts |
| **M-D5** | DomainAwareFIS (FIS v2 with ζ) | FIS v2 returns `domainRelevance` and `isGoverned` on results; governed files rank higher for domain queries |
| **M-D6** | DomainBrowserPanel UI | Pack loading and KPI/context browsing works end-to-end |
| **M-E0** | OrgPackLoader | Load org pack YAML; ORG_UNIT + BUSINESS_OBJECTIVE + INVESTMENT nodes created |
| **M-E1** | CustomerSignalIngester | Ingest CSV/JSON signals; `customer_signals` rows written; `CUSTOMER_SIGNAL` graph nodes |
| **M-E2** | PainPointClusterer | Pain points synthesized from signals; `EXPRESSES` edges |
| **M-E3** | A1 IntakeAgent | BRIEF artifact produced from pain points with correct provenance envelope |
| **M-E4** | A2 BusinessImpactAgent | BUSINESS_IMPACT_ASSESSMENT artifact + draft VALUE_HYPOTHESIS nodes; hypotheses correctly structured |
| **M-E5** | A4 DevImpactAgent | DEV_IMPACT_ASSESSMENT with FIS v2 top files, governed files flagged, effort range |
| **M-E6** | A5 PortfolioAgent + Portfolio Gate | Decision packet assembled; `executePortfolioGate('admit')` advances feature to DEFINE state; hypotheses committed |
| **M-E7** | ValueStreamPanel + BusinessValuePanel | Full upstream flow visible; Kanban shows features in INTAKE→DEFINE states |

---

*Part 1 ends here. Part 2 covers: Level 3 (Downstream AEP — L+4, L+5, A10–A13, Passes F & G, 4-scope blast radius, computed approval sets), Level 4 (A14 Learning Agent, Tier-3 Value Stream Orchestrator, blackboard predicate engine, RACI-on-graph governance, agent calibration, the closed learning loop), all remaining UI panels, and the complete build order for Levels 3 and 4.*
