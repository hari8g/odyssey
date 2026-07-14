# ISS Graph — Complete Implementation Plan (with Manual Feature Injection)
## Part 1 of 2: Architecture, Schema, Passes A & B, Fallback Chain Design

> **Scope**: The Intent-Semantic-Structural (ISS) Graph layer on RIAF Studio, with a
> fully-architected manual feature injection system so that C4 (embedding alignment)
> can always run regardless of external source availability.
>
> **Key design addition vs. previous plan**: A 4-level fallback chain guarantees
> FEATURE nodes always exist before C4 runs. C4 itself also has a BM25 fallback
> when the embedding endpoint is down.
>
> **Pre-condition**: RIAF Studio Parts 1 & 2 fully implemented.

---

## Table of Contents — Part 1

1. [The Core Problem & Fallback Chain Design](#1-the-core-problem--fallback-chain-design)
2. [New File Structure](#2-new-file-structure)
3. [Schema Extensions](#3-schema-extensions)
4. [Shared Types & IPC Channel Extensions](#4-shared-types--ipc-channel-extensions)
5. [ISS Orchestrator](#5-iss-orchestrator)
6. [Pass A — Static Analysis Graph](#6-pass-a--static-analysis-graph)
7. [Pass B — Git Log Mining](#7-pass-b--git-log-mining)
8. [SDLC Phase Classifier](#8-sdlc-phase-classifier)
9. [PageRank Engine](#9-pagerank-engine)
10. [Feature Traces Materializer](#10-feature-traces-materializer)

---

## 1. The Core Problem & Fallback Chain Design

### 1.1 The problem being solved

C4 (embedding alignment) creates IMPLEMENTS edges — the intent-to-code bridge. Without
FEATURE nodes to align from, C4 produces zero edges. Without IMPLEMENTS edges, six PO
tools are reduced to three. The previous plan left this as an acceptable degradation.
This plan treats it as a hard constraint: **the system must always have FEATURE nodes**.

The root issue is that external intent sources (Gherkin, GitHub, docs) are all optional
and frequently unavailable in enterprise environments. We cannot make the ISS graph's
core capability depend on any of them.

### 1.2 The four-level fallback chain

```
┌─────────────────────────────────────────────────────────────────────┐
│                   INTENT INGESTION CHAIN                            │
│  (each level runs only if previous levels produced zero features)   │
└─────────────────────────────────────────────────────────────────────┘

LEVEL 1 — External structured sources (Pass C1 + C2)
  C1: Parse .feature files → Gherkin FEATURE/USER_STORY/AC nodes
  C2: GitHub/Jira REST API → EPIC/FEATURE/USER_STORY nodes
  If both produce 0 → fall through ↓

LEVEL 2 — LLM doc mining (Pass C3)
  C3: LLM reads README + ARCHITECTURE.md → FEATURE nodes (confidence 0.60)
  If produces 0 (no docs, LLM unavailable) → fall through ↓

LEVEL 3 — Code structure auto-discovery (Pass C3.5 — NEW)
  C3.5: LLM reads DOMAIN_SERVICE node names + their call graphs
        and synthesizes likely feature names with no external source
        (confidence 0.50 — lowest, but always possible)
        User reviews suggestions in UI and approves before ingestion
  If user rejects all / still 0 → fall through ↓

LEVEL 4 — Manual entry (always available — NEW)
  UI: Feature creation form + bulk import (text/CSV/JSON)
  Gate: C4 is blocked until at least 1 FEATURE node exists from any level
  A "0 features" banner in the UI makes this impossible to overlook

┌─────────────────────────────────────────────────────────────────────┐
│                     C4: EMBEDDING ALIGNMENT                         │
│  Primary: cosine similarity ≥ 0.75 → IMPLEMENTS edges              │
│  Fallback: BM25 matching if embedding endpoint down                 │
│            confidence capped at 0.50, edges still written          │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 C4 dual-mode execution

C4 runs in one of two modes based on embedding availability:

**Mode A — Embedding mode** (when endpoint is reachable):
- Embed feature descriptions + DOMAIN_SERVICE descriptions
- Cosine ≥ 0.75 → IMPLEMENTS edge, confidence = cosine score (0.75–1.0)
- Source tag: `'llm'`

**Mode B — BM25 fallback mode** (when endpoint is unreachable or unconfigured):
- Tokenize feature description → FTS5 query against DOMAIN_SERVICE labels + descriptions
- Rank matches, take top-1 per feature if BM25 score > threshold
- IMPLEMENTS edge written with confidence = 0.50, source tag: `'bm25_fallback'`
- User can see which edges are fallback-quality in the UI (shown with a ⚠ icon)

Both modes produce IMPLEMENTS edges. The ISS graph is always built. Confidence
values tell downstream consumers how much to trust each edge.

### 1.4 Zero-modification guarantee

Only 6 RIAF core files are touched (all additive). The ISS layer is self-contained
in `packages/main/src/iss/` and `packages/renderer/src/panels/iss/`.

---

## 2. New File Structure

```
packages/main/src/iss/
├── issOrchestrator.ts
├── issIpcHandlers.ts
├── issTools.ts
│
├── passA/
│   ├── passAOrchestrator.ts
│   ├── symbolPromoter.ts
│   ├── semanticBootstrapper.ts
│   ├── callGraphBuilder.ts
│   ├── testLinker.ts
│   └── interfaceLinker.ts
│
├── passB/
│   ├── passBOrchestrator.ts
│   ├── commitMiner.ts
│   ├── jaccardNormalizer.ts
│   └── coChangeMaterializer.ts
│
├── passC/
│   ├── passCOrchestrator.ts          ← rewritten: owns fallback chain logic
│   ├── gherkinParser.ts              ← C1 (unchanged)
│   ├── githubIssueIngester.ts        ← C2 (unchanged)
│   ├── docMiner.ts                   ← C3 (unchanged)
│   ├── codeStructureExtractor.ts     ← C3.5 NEW: auto-discovery from graph
│   ├── manualFeatureIngester.ts      ← NEW: create/update/delete/import
│   ├── featureImportParser.ts        ← NEW: text/CSV/JSON/YAML format parsers
│   └── embeddingAligner.ts           ← C4 rewritten: dual-mode (embed + BM25 fallback)
│
├── sdlcClassifier.ts
├── pageRank.ts
├── fisEngine.ts
├── sdlcRouter.ts
├── graphTraversal.ts
├── featureTracesMaterializer.ts
└── approvalGateHook.ts

packages/shared/src/
├── ipc.channels.ts                   ← extended with iss:manual* channels
└── db.types.ts                       ← new types for manual features + suggestions

packages/renderer/src/
├── store/
│   ├── iss.store.ts
│   └── fis.store.ts
└── panels/iss/
    ├── ISSGraphPanel/index.tsx
    ├── FeaturePanel/
    │   ├── index.tsx                 ← rewritten: empty-state + fallback banners
    │   ├── ManualFeatureModal.tsx    ← NEW: create/edit single feature
    │   ├── ImportFeaturesDialog.tsx  ← NEW: bulk import with format selection
    │   └── FeatureSuggestionsPanel.tsx ← NEW: review/approve C3.5 suggestions
    ├── POWorkbenchPanel/index.tsx
    └── ImpactPanel/index.tsx
```

---

## 3. Schema Extensions

### 3.1 Migration V2 additions (appended to RIAF's existing schema)

```typescript
// packages/main/src/db/schema.ts — SCHEMA_V2

export const SCHEMA_V2 = `

-- ══════════════════════════════════════════════════════════════════════
-- ISS PASS B: accumulation tables
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS iss_mining_meta (
  id                INTEGER PRIMARY KEY CHECK(id = 1),
  last_commit_hash  TEXT,
  last_mined_at     INTEGER,
  commits_processed INTEGER NOT NULL DEFAULT 0,
  pairs_found       INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO iss_mining_meta(id) VALUES (1);

CREATE TABLE IF NOT EXISTS co_change_pairs (
  file_a    TEXT NOT NULL,
  file_b    TEXT NOT NULL,
  co_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (file_a, file_b)
);

CREATE TABLE IF NOT EXISTS file_change_counts (
  file_path    TEXT PRIMARY KEY,
  change_count INTEGER NOT NULL DEFAULT 0
);

-- ══════════════════════════════════════════════════════════════════════
-- ISS PASS C: feature suggestions (C3.5 auto-discovery output)
-- User reviews these before they are promoted to graph_nodes
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS feature_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,
  sdlc_phase   TEXT NOT NULL DEFAULT 'requirements',
  confidence   REAL NOT NULL DEFAULT 0.50,
  source       TEXT NOT NULL DEFAULT 'code_structure',
  -- 'pending' | 'approved' | 'rejected'
  status       TEXT NOT NULL DEFAULT 'pending',
  -- FK to graph_nodes.id once approved; NULL while pending/rejected
  node_id      INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  reviewed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fs_status ON feature_suggestions(status);

-- ══════════════════════════════════════════════════════════════════════
-- ISS PASS C: manual feature audit log
-- Tracks every create/update/delete action for traceability
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS manual_feature_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,  -- 'create' | 'update' | 'delete' | 'bulk_import'
  label       TEXT NOT NULL,
  meta_json   TEXT,           -- diff of changed fields, import source filename, etc.
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ══════════════════════════════════════════════════════════════════════
-- ISS: SDLC phase summary (cached completion status per feature)
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sdlc_phase_summary (
  feature_node_id    INTEGER PRIMARY KEY
    REFERENCES graph_nodes(id) ON DELETE CASCADE,
  has_requirements   INTEGER NOT NULL DEFAULT 0,
  has_design         INTEGER NOT NULL DEFAULT 0,
  has_implementation INTEGER NOT NULL DEFAULT 0,
  has_testing        INTEGER NOT NULL DEFAULT 0,
  has_deployment     INTEGER NOT NULL DEFAULT 0,
  completion_pct     REAL NOT NULL DEFAULT 0.0,
  computed_at        INTEGER NOT NULL
);

-- ══════════════════════════════════════════════════════════════════════
-- New indexes on existing graph tables
-- ══════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_gn_domain_service
  ON graph_nodes(kind) WHERE kind = 'DOMAIN_SERVICE';
CREATE INDEX IF NOT EXISTS idx_gn_feature_embedded
  ON graph_nodes(kind) WHERE kind = 'FEATURE' AND embedding_vec IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ge_kind_from  ON graph_edges(kind, from_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_kind_to    ON graph_edges(kind, to_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_cochange_weight
  ON graph_edges(kind, weight DESC) WHERE kind = 'CO_CHANGES_WITH';

UPDATE schema_version SET version = 2;
`
```

### 3.2 Migration registration

```typescript
// packages/main/src/db/migrations.ts — add to MIGRATIONS array:
{ version: 2, up: (db) => db.exec(SCHEMA_V2) }
```

---

## 4. Shared Types & IPC Channel Extensions

### 4.1 Extended IPC channels

```typescript
// packages/shared/src/ipc.channels.ts — additions to the IPC object

// ── ISS: Pass triggers ────────────────────────────────────────────────────
ISS_RUN_PASS_A:             'iss:runPassA',
ISS_RUN_PASS_B:             'iss:runPassB',
ISS_RUN_PASS_C:             'iss:runPassC',
ISS_PASS_PROGRESS:          'iss:passProgress',        // push event
ISS_PASS_COMPLETE:          'iss:passComplete',         // push event
ISS_PASS_ERROR:             'iss:passError',            // push event

// ── ISS: Graph queries ────────────────────────────────────────────────────
ISS_GET_FEATURES:           'iss:getFeatures',
ISS_GET_FEATURE_DETAIL:     'iss:getFeatureDetail',
ISS_GET_GRAPH_NODES:        'iss:getGraphNodes',
ISS_GET_GRAPH_EDGES:        'iss:getGraphEdges',
ISS_GET_COCHANGE:           'iss:getCoChangePartners',
ISS_GET_FEATURE_COUNT:      'iss:getFeatureCount',      // used by gate check

// ── ISS: Manual feature management (NEW) ─────────────────────────────────
ISS_FEATURE_CREATE:         'iss:featureCreate',
ISS_FEATURE_UPDATE:         'iss:featureUpdate',
ISS_FEATURE_DELETE:         'iss:featureDelete',
ISS_FEATURE_IMPORT:         'iss:featureImport',        // bulk
ISS_FEATURE_IMPORT_PREVIEW: 'iss:featureImportPreview', // dry-run
ISS_FEATURE_GET_AUDIT:      'iss:featureGetAudit',

// ── ISS: Auto-discovery (C3.5) (NEW) ─────────────────────────────────────
ISS_DISCOVER_FEATURES:      'iss:discoverFeatures',     // triggers C3.5
ISS_GET_SUGGESTIONS:        'iss:getSuggestions',
ISS_APPROVE_SUGGESTION:     'iss:approveSuggestion',
ISS_REJECT_SUGGESTION:      'iss:rejectSuggestion',
ISS_APPROVE_ALL_SUGGESTIONS:'iss:approveAllSuggestions',

// ── ISS: Alignment ────────────────────────────────────────────────────────
ISS_RUN_ALIGNMENT:          'iss:runAlignment',
ISS_ALIGNMENT_MODE:         'iss:getAlignmentMode',     // 'embedding' | 'bm25_fallback'

// ── ISS: PO Tools ─────────────────────────────────────────────────────────
ISS_TRACE_FEATURE:          'iss:traceFeature',
ISS_IMPACT_ANALYSIS:        'iss:impactAnalysis',
ISS_FEATURE_STATUS:         'iss:featureStatus',
ISS_FIND_SIMILAR:           'iss:findSimilar',
ISS_GEN_CRITERIA:           'iss:genCriteria',
ISS_SUGGEST_ARCH:           'iss:suggestArch',

// ── ISS: SDLC Router ──────────────────────────────────────────────────────
ISS_GET_SDLC_MODE:          'iss:getSdlcMode',
ISS_SET_SDLC_MODE:          'iss:setSdlcMode',

// ── ISS: Write gate ───────────────────────────────────────────────────────
ISS_COCHANGE_WARNING:       'iss:coChangeWarning',      // push event
```

### 4.2 New shared types

```typescript
// packages/shared/src/db.types.ts — APPEND

// ── Manual feature management ──────────────────────────────────────────────
export type FeatureCreateInput = {
  label:       string          // required; 3–200 chars
  description: string          // required; meaningful sentence
  sdlcPhase:   SDLCPhase       // default: 'requirements'
  sourceRef?:  string          // optional: external ref (ticket ID, doc URL, etc.)
}

export type FeatureUpdateInput = {
  id:           number
  label?:       string
  description?: string
  sdlcPhase?:   SDLCPhase
  sourceRef?:   string
}

export type ManualFeatureAuditRow = {
  id:        number
  nodeId:    number | null
  action:    'create' | 'update' | 'delete' | 'bulk_import'
  label:     string
  metaJson:  string | null
  createdAt: number
}

// ── Feature import ─────────────────────────────────────────────────────────
export type ImportFormat = 'text' | 'csv' | 'json' | 'yaml'

export type ImportPreviewItem = {
  label:       string
  description: string
  sdlcPhase:   SDLCPhase
  valid:       boolean
  error?:      string
}

export type ImportPreviewResult = {
  format:     ImportFormat
  total:      number
  valid:      number
  invalid:    number
  duplicates: number
  items:      ImportPreviewItem[]
}

// ── Feature suggestions (C3.5 auto-discovery) ──────────────────────────────
export type FeatureSuggestion = {
  id:          number
  label:       string
  description: string
  sdlcPhase:   SDLCPhase
  confidence:  number
  source:      'code_structure'
  status:      'pending' | 'approved' | 'rejected'
  nodeId:      number | null
  createdAt:   number
  reviewedAt:  number | null
}

// ── C4 alignment mode ──────────────────────────────────────────────────────
export type AlignmentMode = 'embedding' | 'bm25_fallback' | 'unavailable'

export type AlignmentResult = {
  mode:       AlignmentMode
  aligned:    number
  skipped:    number
  fallback:   boolean   // true if bm25_fallback was used
}

// ── ISS pass progress ──────────────────────────────────────────────────────
export type ISSPassId = 'A' | 'B' | 'C1' | 'C2' | 'C3' | 'C3.5' | 'C4' | 'manual'

export type ISSPassProgress = {
  pass:   ISSPassId
  stage:  string
  pct:    number
  detail: string
}

// ── ISS: FIS / router / trace types (same as previous plan) ───────────────
export type SDLCMode =
  | 'requirements' | 'design' | 'implementation'
  | 'testing' | 'deployment' | 'maintenance' | 'auto'

export type FISWeights = {
  alpha: number; beta: number; gamma: number; delta: number; epsilon: number
}

export type FISResult = {
  filePath:       string
  score:          number
  components:     { alpha: number; beta: number; gamma: number; delta: number; epsilon: number }
  sdlcPhase:      SDLCPhase | null
  nodeKind:       string | null
  importedByCount: number
}
```

### 4.3 New settings

```typescript
// packages/main/src/settingsStore.ts — additions to AppSettings:
issEnabled:               boolean     // default: true
issPassBEnabled:          boolean     // default: true
githubToken:              string      // default: ''
githubRepoOwner:          string      // default: ''
githubRepoName:           string      // default: ''
embeddingBaseUrl:         string      // inherited from RIAF settings
embeddingApiKey:          string      // inherited from RIAF settings
defaultSdlcMode:          SDLCMode    // default: 'auto'
fisWeightsRequirements:   FISWeights | null
fisWeightsDesign:         FISWeights | null
fisWeightsImpl:           FISWeights | null
fisWeightsTesting:        FISWeights | null
```

---

## 5. ISS Orchestrator

```typescript
// packages/main/src/iss/issOrchestrator.ts
import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { registerPostIndexHook } from '../indexer/indexingPipeline'
import { PassAOrchestrator }    from './passA/passAOrchestrator'
import { PassBOrchestrator }    from './passB/passBOrchestrator'
import { SDLCClassifier }       from './sdlcClassifier'
import { PageRankEngine }       from './pageRank'
import { FeatureTracesMaterializer } from './featureTracesMaterializer'
import { registerIssIpcHandlers }    from './issIpcHandlers'
import { ApprovalGateHook }          from './approvalGateHook'
import { getSetting }                from '../settingsStore'
import { IPC }                       from '@shared/index'

export class ISSOrchestrator {
  constructor(
    private readonly db:           Database.Database,
    private readonly workspaceRoot: string,
    private readonly win:          BrowserWindow,
    private readonly getProvider:  () => ILLMProvider,
  ) {}

  register(): void {
    // 1. Post-index hook: Pass A + SDLC classify + PageRank
    //    (Pass B is separate: only if git is available)
    registerPostIndexHook(async (db, root) => {
      if (!getSetting('issEnabled')) return
      await this.runPassA(db, root)
      if (getSetting('issPassBEnabled')) await this.runPassB(db, root)
    })

    // 2. All iss:* IPC handlers
    registerIssIpcHandlers(ipcMain, this.db, this.workspaceRoot,
                           this.win, this.getProvider)

    // 3. Write-gate hook
    new ApprovalGateHook(this.db, this.win).register()
  }

  private async runPassA(db: Database.Database, root: string): Promise<void> {
    const push = (p: import('@shared/index').ISSPassProgress) =>
      this.win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
    try {
      await new PassAOrchestrator(db, root).run(push)
      await new SDLCClassifier(db, root, this.getProvider()).classifyAll(push)
      new PageRankEngine(db).compute()
      new FeatureTracesMaterializer(db).materialize()
      this.win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'A' })
    } catch (err) {
      this.win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'A', message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async runPassB(db: Database.Database, root: string): Promise<void> {
    const push = (p: import('@shared/index').ISSPassProgress) =>
      this.win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
    try {
      await new PassBOrchestrator(db, root).run(push)
      this.win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'B' })
    } catch (err) {
      this.win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'B', message: err instanceof Error ? err.message : String(err)
      })
    }
  }
}
```

---

## 6. Pass A — Static Analysis Graph

### 6.0 `passA/passAOrchestrator.ts`

```typescript
// packages/main/src/iss/passA/passAOrchestrator.ts
import type Database from 'better-sqlite3'
import type { ISSPassProgress } from '@shared/index'
import { SymbolPromoter }       from './symbolPromoter'
import { SemanticBootstrapper } from './semanticBootstrapper'
import { CallGraphBuilder }     from './callGraphBuilder'
import { TestLinker }           from './testLinker'
import { InterfaceLinker }      from './interfaceLinker'

export class PassAOrchestrator {
  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {}

  async run(push: (p: ISSPassProgress) => void): Promise<void> {
    push({ pass: 'A', stage: 'symbol_promotion', pct: 0,
           detail: 'Promoting symbols to graph nodes…' })
    const promoted = new SymbolPromoter(this.db).promote()
    push({ pass: 'A', stage: 'symbol_promotion', pct: 100,
           detail: `${promoted} structural nodes created` })

    push({ pass: 'A', stage: 'semantic_bootstrap', pct: 0,
           detail: 'Deriving semantic layer…' })
    const { services, modules, extDeps } =
      new SemanticBootstrapper(this.db, this.root).bootstrap()
    push({ pass: 'A', stage: 'semantic_bootstrap', pct: 100,
           detail: `${services} domain services · ${modules} modules · ${extDeps} ext deps` })

    push({ pass: 'A', stage: 'call_graph', pct: 0, detail: 'Building call graph…' })
    const callEdges = new CallGraphBuilder(this.db).build(
      (pct, detail) => push({ pass: 'A', stage: 'call_graph', pct, detail })
    )
    push({ pass: 'A', stage: 'call_graph', pct: 100,
           detail: `${callEdges} CALLS edges created` })

    push({ pass: 'A', stage: 'test_linkage', pct: 0, detail: 'Linking tests…' })
    const { testNodes, testEdges } = new TestLinker(this.db, this.root).link()
    push({ pass: 'A', stage: 'test_linkage', pct: 100,
           detail: `${testNodes} test nodes · ${testEdges} edges` })

    push({ pass: 'A', stage: 'interface_edges', pct: 0, detail: 'Extracting interface edges…' })
    const ifaceEdges = new InterfaceLinker(this.db, this.root).link()
    push({ pass: 'A', stage: 'interface_edges', pct: 100,
           detail: `${ifaceEdges} IMPLEMENTS_INTERFACE/INHERITS edges` })
  }
}
```

### 6.1 `passA/symbolPromoter.ts`

```typescript
// packages/main/src/iss/passA/symbolPromoter.ts
import type Database from 'better-sqlite3'

const KIND_MAP: Record<string, string> = {
  function:  'FUNCTION', class: 'CLASS', interface: 'INTERFACE',
  type: 'TYPE', enum: 'ENUM', const: 'FUNCTION',
}

export class SymbolPromoter {
  private readonly insert: Database.Statement
  private readonly exists: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         file_path, start_line, end_line, importance_score, symbol_id, file_id, created_at)
      VALUES (?, ?, ?, 'symbol', ?, ?, ?, ?, 0.0, ?, ?, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.exists = db.prepare('SELECT id FROM graph_nodes WHERE symbol_id = ?')
  }

  promote(): number {
    const symbols = this.db
      .prepare<[], {
        id: number; file_id: number; file_path: string; name: string;
        kind: string; start_line: number; end_line: number; docstring: string
      }>('SELECT id, file_id, file_path, name, kind, start_line, end_line, docstring FROM symbols')
      .all()

    let promoted = 0
    const batch = this.db.transaction((rows: typeof symbols) => {
      for (const s of rows) {
        if (this.exists.get(s.id)) continue
        this.insert.run(
          KIND_MAP[s.kind] ?? 'FUNCTION', s.name,
          s.docstring || null, String(s.id),
          s.file_path, s.start_line, s.end_line, s.id, s.file_id
        )
        promoted++
      }
    })
    batch(symbols)
    return promoted
  }
}
```

### 6.2 `passA/semanticBootstrapper.ts`

```typescript
// packages/main/src/iss/passA/semanticBootstrapper.ts
import type Database from 'better-sqlite3'

export class SemanticBootstrapper {
  private readonly insert: Database.Statement
  private readonly edge:   Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, file_path, importance_score, created_at)
      VALUES (?, ?, ?, 'static_analysis', ?, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 0.95, 'static_analysis', unixepoch() * 1000)
    `)
  }

  bootstrap(): { services: number; modules: number; extDeps: number } {
    let services = 0, modules = 0, extDeps = 0

    // DOMAIN_SERVICE: class names matching service patterns
    const serviceRows = this.db.prepare<[], { gn_id: number; name: string; file_path: string }>(`
      SELECT gn.id as gn_id, gn.label as name, gn.file_path
      FROM graph_nodes gn
      WHERE gn.kind = 'CLASS' AND (
        gn.label LIKE '%Service' OR gn.label LIKE '%Repository' OR
        gn.label LIKE '%Controller' OR gn.label LIKE '%Handler' OR
        gn.label LIKE '%Manager' OR gn.label LIKE '%Provider' OR
        gn.label LIKE '%Gateway' OR gn.label LIKE '%Client' OR
        gn.label LIKE '%Adapter'
      )
    `).all()

    const getDs = this.db.prepare<[string, string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'DOMAIN_SERVICE' AND label = ? AND file_path = ?`
    )

    const batchServices = this.db.transaction(() => {
      for (const r of serviceRows) {
        if (!getDs.get(r.name, r.file_path)) {
          this.insert.run(
            'DOMAIN_SERVICE', r.name,
            `Domain service: ${r.name}`, r.file_path
          )
          services++
        }
      }
    })
    batchServices()

    // MODULE: one node per top-level directory
    const dirRows = this.db.prepare<[], { dir: string }>(`
      SELECT DISTINCT
        CASE WHEN instr(file_path, '/') > 0
             THEN substr(file_path, 1, instr(file_path,'/')-1)
             ELSE file_path END as dir
      FROM file_metadata
      WHERE dir NOT IN ('node_modules','.git','dist','out','build','.riaf')
    `).all()

    const getModule = this.db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'MODULE' AND label = ?`
    )
    const batchModules = this.db.transaction(() => {
      for (const { dir } of dirRows) {
        if (!dir || dir.startsWith('.')) continue
        if (!getModule.get(dir)) {
          this.insert.run('MODULE', dir, `Directory module: ${dir}/`, dir + '/')
          modules++
        }
      }
    })
    batchModules()

    // EXTERNAL_DEPENDENCY: from UCG external import edges
    const extRows = this.db.prepare<[], { to_module: string }>(
      'SELECT DISTINCT to_module FROM ucg_import_edges WHERE is_external = 1'
    ).all()

    const getExt = this.db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'EXTERNAL_DEPENDENCY' AND label = ?`
    )
    const batchExt = this.db.transaction(() => {
      for (const { to_module } of extRows) {
        const pkg = to_module.startsWith('@') ?
          to_module.split('/').slice(0, 2).join('/') :
          to_module.split('/')[0]!
        if (!getExt.get(pkg)) {
          this.insert.run('EXTERNAL_DEPENDENCY', pkg, `External package: ${pkg}`, null)
          extDeps++
        }
      }
    })
    batchExt()

    return { services, modules, extDeps }
  }
}
```

### 6.3 `passA/callGraphBuilder.ts`

```typescript
// packages/main/src/iss/passA/callGraphBuilder.ts
// Heuristic CALLS edges: regex match of symbol names within chunk text,
// resolved via the import graph for cross-file calls.
// Confidence: 0.70 (heuristic, not AST)
import fs from 'node:fs'
import type Database from 'better-sqlite3'

export class CallGraphBuilder {
  private readonly insertEdge: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'CALLS', 1.0, 0.70, 'static_analysis', ?, unixepoch() * 1000)
    `)
  }

  build(progress: (pct: number, detail: string) => void): number {
    let edgeCount = 0

    // Name → node ID index for FUNCTION/CLASS/DOMAIN_SERVICE nodes
    const nameIdx = new Map<string, number[]>()
    const allNodes = this.db.prepare<[], { id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE')`
    ).all()
    for (const n of allNodes) {
      const arr = nameIdx.get(n.label) ?? []
      arr.push(n.id)
      nameIdx.set(n.label, arr)
    }

    // Import resolver: fromFile → Set<resolvedFile>
    const importMap = new Map<string, Set<string>>()
    for (const e of this.db.prepare<[], { from_file: string; resolved_file: string }>(
      'SELECT from_file, resolved_file FROM ucg_import_edges WHERE resolved_file IS NOT NULL'
    ).all()) {
      const s = importMap.get(e.from_file) ?? new Set()
      s.add(e.resolved_file)
      importMap.set(e.from_file, s)
    }

    const functions = this.db.prepare<[], {
      node_id: number; label: string; file_path: string; start_line: number
    }>(`SELECT gn.id as node_id, gn.label, gn.file_path, gn.start_line
        FROM graph_nodes gn WHERE gn.kind = 'FUNCTION' AND gn.file_path IS NOT NULL`).all()

    const getChunk = this.db.prepare<[string, number], { chunk_text: string }>(
      `SELECT chunk_text FROM code_chunks WHERE file_path = ? AND start_line <= ? ORDER BY start_line DESC LIMIT 1`
    )
    const getFileSymbols = this.db.prepare<[string], { id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE file_path = ? AND kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE')`
    )

    const total = functions.length
    const pendingEdges: { from: number; to: number; meta: string }[] = []

    const flush = this.db.transaction((rows: typeof pendingEdges) => {
      for (const r of rows) {
        this.insertEdge.run(r.from, r.to, r.meta)
        edgeCount++
      }
    })

    for (let i = 0; i < functions.length; i++) {
      if (i % 200 === 0) {
        progress(Math.round((i / total) * 100), `${i}/${total} functions analyzed`)
      }
      const fn = functions[i]!
      const chunk = getChunk.get(fn.file_path!, fn.start_line)
      if (!chunk) continue
      const text = chunk.chunk_text

      // Intra-file
      for (const target of getFileSymbols.all(fn.file_path!)) {
        if (target.id === fn.node_id) continue
        if (new RegExp(`\\b${target.label}\\s*\\(`).test(text)) {
          pendingEdges.push({ from: fn.node_id, to: target.id,
            meta: JSON.stringify({ type: 'intra_file' }) })
        }
      }

      // Cross-file via import graph
      for (const importedFile of (importMap.get(fn.file_path!) ?? new Set())) {
        for (const target of getFileSymbols.all(importedFile)) {
          if ([
            new RegExp(`\\.${target.label}\\s*\\(`),
            new RegExp(`\\bnew\\s+${target.label}\\s*\\(`),
            new RegExp(`\\b${target.label}\\s*\\.`),
          ].some(p => p.test(text))) {
            pendingEdges.push({ from: fn.node_id, to: target.id,
              meta: JSON.stringify({ type: 'cross_file', via: importedFile }) })
          }
        }
      }

      if (pendingEdges.length >= 500) { flush(pendingEdges.splice(0)) }
    }
    if (pendingEdges.length > 0) flush(pendingEdges)
    return edgeCount
  }
}
```

### 6.4 `passA/testLinker.ts`

```typescript
// packages/main/src/iss/passA/testLinker.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const DESCRIBE_RE = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g
const IT_RE       = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g

export class TestLinker {
  private readonly insert: Database.Statement
  private readonly edge:   Database.Statement
  private readonly getNode: Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {
    this.insert  = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, file_path, start_line, importance_score, created_at)
      VALUES (?, ?, ?, 'static_analysis', ?, ?, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.edge    = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, ?, 'static_analysis', unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  link(): { testNodes: number; testEdges: number } {
    let testNodes = 0, testEdges = 0
    const testFiles = this.db.prepare<[], { file_path: string }>(
      `SELECT file_path FROM file_metadata
       WHERE file_path LIKE '%.spec.%' OR file_path LIKE '%.test.%'
          OR file_path LIKE '%__tests__%'`
    ).all()

    const batch = this.db.transaction(() => {
      for (const tf of testFiles) {
        this.insert.run('TEST_SUITE', tf.file_path,
          `Test suite: ${path.basename(tf.file_path)}`, tf.file_path, 1)
        testNodes++
        const suite = this.getNode.get('TEST_SUITE', tf.file_path)
        if (!suite) continue

        // Link to source via convention
        const srcBase = tf.file_path
          .replace(/\.spec\.(ts|js|tsx|jsx)$/, '.$1')
          .replace(/\.test\.(ts|js|tsx|jsx)$/, '.$1')
        const srcNode = this.db.prepare<[string], { id: number }>(
          'SELECT id FROM graph_nodes WHERE file_path = ? AND kind IN ("CLASS","DOMAIN_SERVICE") LIMIT 1'
        ).get(srcBase)
        if (srcNode) { this.edge.run(suite.id, srcNode.id, 'TESTS', 0.85); testEdges++ }

        // Parse describe/it blocks
        const abs = path.join(this.root, tf.file_path)
        if (!fs.existsSync(abs)) continue
        const content = fs.readFileSync(abs, 'utf8')

        for (const re of [DESCRIBE_RE, IT_RE]) {
          re.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = re.exec(content)) !== null) {
            const label = m[1]!
            const line  = content.slice(0, m.index).split('\n').length
            this.insert.run('TEST_CASE', label,
              `Test case: ${label}`, tf.file_path, line)
            testNodes++
            const tc = this.getNode.get('TEST_CASE', label)
            if (tc) { this.edge.run(suite.id, tc.id, 'TESTS', 1.0); testEdges++ }
          }
        }
      }
    })
    batch()
    return { testNodes, testEdges }
  }
}
```

### 6.5 `passA/interfaceLinker.ts`

```typescript
// packages/main/src/iss/passA/interfaceLinker.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const CLASS_RE = /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s<>]+))?/gm

export class InterfaceLinker {
  private readonly edge: Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 0.95, 'static_analysis', unixepoch() * 1000)
    `)
  }

  link(): number {
    let count = 0
    const nameMap = new Map<string, number>()
    for (const n of this.db.prepare<[], { id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind IN ('CLASS','INTERFACE')`
    ).all()) nameMap.set(n.label, n.id)

    const tsFiles = this.db.prepare<[], { file_path: string }>(
      `SELECT file_path FROM file_metadata WHERE language IN ('typescript','javascript')`
    ).all()

    const pending: { from: number; to: number; kind: string }[] = []

    for (const tf of tsFiles) {
      const abs = path.join(this.root, tf.file_path)
      if (!fs.existsSync(abs)) continue
      const content = fs.readFileSync(abs, 'utf8')
      CLASS_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CLASS_RE.exec(content)) !== null) {
        const fromId = m[1] ? nameMap.get(m[1]) : undefined
        if (!fromId) continue
        if (m[2]) {
          const toId = nameMap.get(m[2])
          if (toId) pending.push({ from: fromId, to: toId, kind: 'INHERITS' })
        }
        if (m[3]) {
          for (const iface of m[3].split(',').map(s => s.replace(/<.*>/, '').trim())) {
            const toId = nameMap.get(iface)
            if (toId) pending.push({ from: fromId, to: toId, kind: 'IMPLEMENTS_INTERFACE' })
          }
        }
      }
    }

    const batch = this.db.transaction(() => {
      for (const r of pending) { this.edge.run(r.from, r.to, r.kind); count++ }
    })
    batch()
    return count
  }
}
```

---

## 7. Pass B — Git Log Mining

### 7.0 `passB/passBOrchestrator.ts`

```typescript
// packages/main/src/iss/passB/passBOrchestrator.ts
import type Database from 'better-sqlite3'
import type { ISSPassProgress } from '@shared/index'
import { CommitMiner }          from './commitMiner'
import { JaccardNormalizer }    from './jaccardNormalizer'
import { CoChangeMaterializer } from './coChangeMaterializer'

export class PassBOrchestrator {
  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {}

  async run(push: (p: ISSPassProgress) => void): Promise<void> {
    push({ pass: 'B', stage: 'commit_mining', pct: 0, detail: 'Mining git history…' })
    const miner = new CommitMiner(this.db, this.root)
    const { commits, pairs, traces } = await miner.mine(
      (pct, detail) => push({ pass: 'B', stage: 'commit_mining', pct, detail })
    )
    push({ pass: 'B', stage: 'commit_mining', pct: 100,
           detail: `${commits} commits · ${pairs} pairs · ${traces} TRACES_TO edges` })

    push({ pass: 'B', stage: 'jaccard', pct: 0, detail: 'Normalizing…' })
    const above = new JaccardNormalizer(this.db).normalize()
    push({ pass: 'B', stage: 'jaccard', pct: 100,
           detail: `${above} pairs above threshold 0.3` })

    push({ pass: 'B', stage: 'materialize', pct: 0, detail: 'Writing CO_CHANGES_WITH…' })
    const written = new CoChangeMaterializer(this.db).materialize()
    push({ pass: 'B', stage: 'materialize', pct: 100,
           detail: `${written} CO_CHANGES_WITH edges written` })
  }
}
```

### 7.1 `passB/commitMiner.ts`

```typescript
// packages/main/src/iss/passB/commitMiner.ts
import { execFile }  from 'node:child_process'
import { promisify } from 'node:util'
import type Database from 'better-sqlite3'

const exec = promisify(execFile)
const MAX_FILES_PER_COMMIT = 50

const FEATURE_REFS = [
  { pattern: /#(\d+)/g,                       group: 1 },
  { pattern: /closes?\s+#(\d+)/gi,            group: 1 },
  { pattern: /fixes?\s+#(\d+)/gi,             group: 1 },
  { pattern: /implements?\s+#(\d+)/gi,        group: 1 },
  { pattern: /JIRA-(\d+)/gi,                  group: 1 },
  { pattern: /feat(?:ure)?\s*:\s*([^(\n]{4,60})/gi, group: 1 },
]

export class CommitMiner {
  private readonly upsertPair:    Database.Statement
  private readonly upsertCount:   Database.Statement
  private readonly findFeature:   Database.Statement
  private readonly createFeature: Database.Statement
  private readonly insertTrace:   Database.Statement
  private readonly getMeta:       Database.Statement
  private readonly updateMeta:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {
    this.upsertPair = db.prepare(`
      INSERT INTO co_change_pairs(file_a, file_b, co_count) VALUES (?, ?, 1)
      ON CONFLICT(file_a, file_b) DO UPDATE SET co_count = co_count + 1
    `)
    this.upsertCount = db.prepare(`
      INSERT INTO file_change_counts(file_path, change_count) VALUES (?, 1)
      ON CONFLICT(file_path) DO UPDATE SET change_count = change_count + 1
    `)
    this.findFeature   = db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'FEATURE' AND source_ref = ? LIMIT 1`
    )
    this.createFeature = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref, importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'git', ?, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertTrace   = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'TRACES_TO', 1.0, 0.80, 'git_log', ?, unixepoch() * 1000)
    `)
    this.getMeta    = db.prepare('SELECT last_commit_hash FROM iss_mining_meta WHERE id = 1')
    this.updateMeta = db.prepare(`
      UPDATE iss_mining_meta
      SET last_commit_hash = ?, last_mined_at = unixepoch() * 1000,
          commits_processed = commits_processed + ?, pairs_found = pairs_found + ?
      WHERE id = 1
    `)
  }

  async mine(
    progress: (pct: number, detail: string) => void,
  ): Promise<{ commits: number; pairs: number; traces: number }> {
    let commits = 0, pairs = 0, traces = 0
    const meta = this.getMeta.get() as { last_commit_hash: string | null }
    const sinceArg = meta.last_commit_hash ? [`${meta.last_commit_hash}..HEAD`] : []

    let raw: string
    try {
      const { stdout } = await exec('git', [
        'log', '--no-merges', '--pretty=format:COMMIT_START%H%x09%s%x09%b',
        '--name-only', '--diff-filter=ACMR', ...sinceArg,
      ], { cwd: this.root, timeout: 60_000 })
      raw = stdout
    } catch {
      progress(100, 'Git mining skipped (not a git repo or git not found)')
      return { commits: 0, pairs: 0, traces: 0 }
    }

    if (!raw.trim()) {
      progress(100, 'No new commits to mine')
      return { commits: 0, pairs: 0, traces: 0 }
    }

    const blocks = raw.split('COMMIT_START').filter(Boolean)
    const total  = blocks.length
    let lastHash = ''

    for (let i = 0; i < blocks.length; i++) {
      const block   = blocks[i]!
      const nlIdx   = block.indexOf('\n')
      const header  = block.slice(0, nlIdx).split('\t')
      const hash    = header[0]?.trim() ?? ''
      const subject = header[1]?.trim() ?? ''
      const body    = header[2]?.trim() ?? ''
      const files   = block.slice(nlIdx + 1).trim().split('\n')
        .map(l => l.trim()).filter(Boolean)

      if (!hash) continue
      if (i === 0) lastHash = hash
      if (files.length > MAX_FILES_PER_COMMIT) continue
      commits++

      const refs = this.extractRefs(subject + ' ' + body)

      if (refs.length > 0) {
        const fileNodeIds: number[] = files.map(f =>
          (this.db.prepare<[string], { id: number }>(
            `SELECT id FROM graph_nodes WHERE file_path = ? AND kind IN ('FUNCTION','CLASS','MODULE') LIMIT 1`
          ).get(f))?.id ?? 0
        ).filter(Boolean)

        if (fileNodeIds.length > 0) {
          const traceBatch = this.db.transaction(() => {
            for (const ref of refs) {
              if (!this.findFeature.get(ref.ref)) {
                this.createFeature.run(
                  ref.label,
                  `Feature mined from git. Ref: ${ref.ref}`,
                  ref.ref,
                )
              }
              const fn = this.findFeature.get(ref.ref)
              if (!fn) continue
              for (const nid of fileNodeIds) {
                this.insertTrace.run(fn.id, nid,
                  JSON.stringify({ commit: hash, subject }))
                traces++
              }
            }
          })
          traceBatch()
        }
      }

      if (files.length >= 2) {
        const pairBatch = this.db.transaction(() => {
          for (let a = 0; a < files.length; a++) {
            this.upsertCount.run(files[a])
            for (let b = a + 1; b < files.length; b++) {
              const [fa, fb] = files[a]! < files[b]! ?
                [files[a], files[b]] : [files[b], files[a]]
              this.upsertPair.run(fa, fb)
              pairs++
            }
          }
        })
        pairBatch()
      }

      if (i % 50 === 0) {
        progress(Math.round((i / total) * 100),
                 `${i}/${total} commits · ${traces} traces`)
      }
    }

    if (lastHash) this.updateMeta.run(lastHash, commits, pairs)
    return { commits, pairs, traces }
  }

  private extractRefs(text: string): { ref: string; label: string }[] {
    const found: { ref: string; label: string }[] = []
    const seen  = new Set<string>()
    for (const { pattern, group } of FEATURE_REFS) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(text)) !== null) {
        const ref = m[group]?.trim()
        if (!ref || seen.has(ref)) continue
        seen.add(ref)
        found.push({ ref, label: /^\d+$/.test(ref) ? `Issue #${ref}` : ref })
      }
    }
    return found
  }
}
```

### 7.2 `passB/jaccardNormalizer.ts`

```typescript
// packages/main/src/iss/passB/jaccardNormalizer.ts
import type Database from 'better-sqlite3'

export class JaccardNormalizer {
  constructor(private readonly db: Database.Database) {}

  normalize(): number {
    const pairs = this.db.prepare<[], {
      file_a: string; file_b: string; co_count: number;
      count_a: number; count_b: number
    }>(`
      SELECT cp.file_a, cp.file_b, cp.co_count,
             COALESCE(fca.change_count, 1) as count_a,
             COALESCE(fcb.change_count, 1) as count_b
      FROM co_change_pairs cp
      LEFT JOIN file_change_counts fca ON fca.file_path = cp.file_a
      LEFT JOIN file_change_counts fcb ON fcb.file_path = cp.file_b
    `).all()

    const upsert = this.db.prepare(`
      INSERT INTO co_change_pairs(file_a, file_b, co_count) VALUES (?, ?, ?)
      ON CONFLICT(file_a, file_b) DO UPDATE SET co_count = excluded.co_count
    `)

    let above = 0
    const batch = this.db.transaction(() => {
      for (const p of pairs) {
        const jaccard = p.co_count / (p.count_a + p.count_b - p.co_count)
        if (jaccard >= 0.30) {
          upsert.run(p.file_a, p.file_b, Math.round(jaccard * 1000))
          above++
        }
      }
    })
    batch()
    return above
  }
}
```

### 7.3 `passB/coChangeMaterializer.ts`

```typescript
// packages/main/src/iss/passB/coChangeMaterializer.ts
import type Database from 'better-sqlite3'

export class CoChangeMaterializer {
  constructor(private readonly db: Database.Database) {}

  materialize(): number {
    let written = 0
    this.db.exec(`DELETE FROM graph_edges WHERE kind = 'CO_CHANGES_WITH'`)

    const pairs = this.db.prepare<[], {
      file_a: string; file_b: string; co_count: number
    }>('SELECT file_a, file_b, co_count FROM co_change_pairs WHERE co_count >= 300').all()

    const getNode = this.db.prepare<[string], { id: number }>(`
      SELECT id FROM graph_nodes
      WHERE file_path = ? AND kind IN ('DOMAIN_SERVICE','CLASS','MODULE','FUNCTION')
      ORDER BY CASE kind
        WHEN 'DOMAIN_SERVICE' THEN 1 WHEN 'CLASS' THEN 2
        WHEN 'MODULE' THEN 3 WHEN 'FUNCTION' THEN 4 END
      LIMIT 1
    `)
    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'CO_CHANGES_WITH', ?, ?, 'git_log', ?, unixepoch() * 1000)
    `)

    const batch = this.db.transaction(() => {
      for (const p of pairs) {
        const a = getNode.get(p.file_a)
        const b = getNode.get(p.file_b)
        if (!a || !b) continue
        const j = p.co_count / 1000
        const meta = JSON.stringify({ file_a: p.file_a, file_b: p.file_b })
        insertEdge.run(a.id, b.id, j, j, meta)
        insertEdge.run(b.id, a.id, j, j, meta)
        written += 2
      }
    })
    batch()
    return written
  }
}
```

---

## 8. SDLC Phase Classifier

```typescript
// packages/main/src/iss/sdlcClassifier.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import type { ISSPassProgress } from '@shared/index'

type PhaseTag = 'requirements'|'design'|'implementation'|'testing'|'deployment'|'maintenance'
type Rule = { pattern: RegExp; phase: PhaseTag; confidence: number }

const RULES: Rule[] = [
  { pattern: /\.(spec|test)\.(ts|tsx|js|jsx|py|java|go|rs)$/i, phase: 'testing',        confidence: 0.99 },
  { pattern: /__tests__\//i,                                     phase: 'testing',        confidence: 0.98 },
  { pattern: /Dockerfile$|docker-compose/i,                      phase: 'deployment',     confidence: 0.99 },
  { pattern: /\.github\/workflows\//i,                           phase: 'deployment',     confidence: 0.99 },
  { pattern: /terraform\/.*\.tf$/i,                              phase: 'deployment',     confidence: 0.98 },
  { pattern: /kubernetes\/|k8s\//i,                              phase: 'deployment',     confidence: 0.97 },
  { pattern: /migrations?\/.*\.(sql|ts|js|py)$/i,               phase: 'maintenance',    confidence: 0.97 },
  { pattern: /CHANGELOG\.md$/i,                                  phase: 'maintenance',    confidence: 0.95 },
  { pattern: /\.interface\.(ts|tsx)$/i,                          phase: 'design',         confidence: 0.95 },
  { pattern: /openapi\.(ya?ml|json)$|swagger\.(ya?ml|json)$/i,  phase: 'design',         confidence: 0.97 },
  { pattern: /\.proto$/i,                                        phase: 'design',         confidence: 0.97 },
  { pattern: /ARCHITECTURE\.md$/i,                               phase: 'design',         confidence: 0.93 },
  { pattern: /\.feature$/i,                                      phase: 'requirements',   confidence: 0.99 },
  { pattern: /README\.md$/i,                                     phase: 'requirements',   confidence: 0.80 },
  { pattern: /\.service\.(ts|js)$/i,                             phase: 'implementation', confidence: 0.92 },
  { pattern: /\.controller\.(ts|js)$/i,                          phase: 'implementation', confidence: 0.92 },
  { pattern: /\.repository\.(ts|js)$/i,                          phase: 'implementation', confidence: 0.92 },
  { pattern: /\.(ts|tsx|js|jsx|py|java|go|rs|cs|kt)$/i,        phase: 'implementation', confidence: 0.75 },
]

const LLM_THRESHOLD = 0.80

export class SDLCClassifier {
  private readonly updatePhase: Database.Statement

  constructor(
    private readonly db:       Database.Database,
    private readonly root:     string,
    private readonly provider: ILLMProvider,
  ) {
    this.updatePhase = db.prepare(
      'UPDATE graph_nodes SET sdlc_phase = ?, sdlc_confidence = ? WHERE id = ?'
    )
  }

  async classifyAll(push: (p: ISSPassProgress) => void): Promise<void> {
    const nodes = this.db.prepare<[], { id: number; file_path: string | null; label: string }>(
      'SELECT id, file_path, label FROM graph_nodes WHERE sdlc_phase IS NULL'
    ).all()

    const llmQueue: typeof nodes = []
    const ruleBatch: { id: number; phase: PhaseTag; confidence: number }[] = []
    const total = nodes.length

    const flushRules = this.db.transaction((
      rows: { id: number; phase: PhaseTag; confidence: number }[]
    ) => {
      for (const r of rows) this.updatePhase.run(r.phase, r.confidence, r.id)
    })

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const fp   = node.file_path ?? node.label
      const hit  = this.matchRule(fp)

      if (hit) {
        ruleBatch.push({ id: node.id, phase: hit.phase, confidence: hit.confidence })
        if (hit.confidence < LLM_THRESHOLD && node.file_path) llmQueue.push(node)
      } else {
        // Intent-layer nodes with no file_path → requirements by default
        ruleBatch.push({ id: node.id, phase: 'requirements', confidence: 0.50 })
      }

      if (i % 500 === 0) {
        flushRules(ruleBatch.splice(0))
        push({ pass: 'A', stage: 'sdlc_classify',
               pct: Math.round((i / total) * 90), detail: `${i}/${total}` })
      }
    }
    if (ruleBatch.length > 0) flushRules(ruleBatch)

    if (llmQueue.length > 0) {
      push({ pass: 'A', stage: 'sdlc_classify', pct: 90,
             detail: `LLM fallback for ${llmQueue.length} ambiguous files…` })
      await this.llmClassify(llmQueue)
    }

    push({ pass: 'A', stage: 'sdlc_classify', pct: 100,
           detail: `${nodes.length} nodes phase-tagged` })
  }

  private matchRule(fp: string): { phase: PhaseTag; confidence: number } | null {
    for (const r of RULES) if (r.pattern.test(fp)) return r
    return null
  }

  private async llmClassify(nodes: { id: number; file_path: string | null }[]) {
    const BATCH = 10
    const batchUpdate = this.db.transaction((
      rows: { id: number; phase: PhaseTag; confidence: number }[]
    ) => {
      for (const r of rows) this.updatePhase.run(r.phase, r.confidence, r.id)
    })

    for (let i = 0; i < nodes.length; i += BATCH) {
      const batch = nodes.slice(i, i + BATCH)
      const fileList = batch.map(n => {
        const fp = n.file_path!
        let first50 = ''
        try { first50 = fs.readFileSync(path.join(this.root, fp), 'utf8')
                          .split('\n').slice(0, 50).join('\n') } catch { /* ignore */ }
        return `FILE: ${fp}\n${first50}\n---`
      }).join('\n')

      try {
        const resp = await this.provider.complete({
          model:    'claude-haiku-4-5',
          system:   'You classify files by SDLC phase. Return only JSON array, no prose.',
          messages: [{ role: 'user', content:
            `Classify each file. Reply ONLY with JSON:\n` +
            `[{"path":"...","phase":"requirements|design|implementation|testing|deployment|maintenance","confidence":0.0}]\n\n${fileList}`
          }],
          max_tokens: 300,
        })
        const results = JSON.parse(resp.replace(/```json|```/g, '').trim()) as
          { path: string; phase: PhaseTag; confidence: number }[]
        batchUpdate(batch.map(n => {
          const found = results.find(r => r.path === n.file_path)
          return { id: n.id, phase: found?.phase ?? 'implementation',
                   confidence: found?.confidence ?? 0.6 }
        }))
      } catch { /* keep rule-based classification on failure */ }
    }
  }
}
```

---

## 9. PageRank Engine

```typescript
// packages/main/src/iss/pageRank.ts
import type Database from 'better-sqlite3'

const DAMPING    = 0.85
const ITERATIONS = 50
const EPSILON    = 1e-6

export class PageRankEngine {
  constructor(private readonly db: Database.Database) {}

  compute(): void {
    const nodes = this.db.prepare<[], { id: number }>(
      `SELECT DISTINCT id FROM graph_nodes WHERE kind IN
       ('FUNCTION','CLASS','DOMAIN_SERVICE','MODULE','INTERFACE','TYPE','ENUM','EXTERNAL_DEPENDENCY')`
    ).all()
    if (nodes.length === 0) return

    const n      = nodes.length
    const ids    = nodes.map(r => r.id)
    const idxMap = new Map(ids.map((id, i) => [id, i]))
    const rank   = new Float64Array(n).fill(1.0 / n)
    const next   = new Float64Array(n)
    const adj    = new Array<number[]>(n).fill(null!).map(() => [])
    const outDeg = new Int32Array(n)

    for (const e of this.db.prepare<[], { from_node_id: number; to_node_id: number }>(
      `SELECT from_node_id, to_node_id FROM graph_edges
       WHERE kind IN ('CALLS','IMPORTS','DEPENDS_ON')
         AND from_node_id IN (${ids.join(',')})
         AND to_node_id   IN (${ids.join(',')})`
    ).all()) {
      const f = idxMap.get(e.from_node_id)!
      const t = idxMap.get(e.to_node_id)!
      adj[t]!.push(f)
      outDeg[f]++
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      let diff = 0
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (const j of adj[i]!) if (outDeg[j]! > 0) sum += rank[j]! / outDeg[j]!
        next[i] = (1 - DAMPING) / n + DAMPING * sum
        diff += Math.abs(next[i]! - rank[i]!)
      }
      rank.set(next)
      if (diff < EPSILON) break
    }

    const maxRank = Math.max(...rank)
    if (maxRank === 0) return

    const update = this.db.prepare('UPDATE graph_nodes SET importance_score = ? WHERE id = ?')
    const batch  = this.db.transaction(() => {
      for (let i = 0; i < n; i++) update.run(rank[i]! / maxRank, ids[i])
    })
    batch()
  }
}
```

---

## 10. Feature Traces Materializer

```typescript
// packages/main/src/iss/featureTracesMaterializer.ts
import type Database from 'better-sqlite3'

const MAX_DEPTH = 6

export class FeatureTracesMaterializer {
  constructor(private readonly db: Database.Database) {}

  materialize(): void {
    this.db.exec('DELETE FROM feature_traces')

    const features = this.db.prepare<[], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind IN ('FEATURE','EPIC')`
    ).all()

    const traverse = this.db.prepare<[number, number], {
      node_id: number; depth: number; edge_kind: string | null;
      confidence: number; path: string; kind: string
    }>(`
      WITH RECURSIVE traversal(node_id, depth, edge_kind, confidence, path, kind) AS (
        SELECT gn.id, 0, NULL, 1.0, CAST(gn.id AS TEXT), gn.kind
        FROM graph_nodes gn WHERE gn.id = ?
        UNION ALL
        SELECT ge.to_node_id, t.depth + 1, ge.kind,
               t.confidence * ge.confidence,
               t.path || ',' || CAST(ge.to_node_id AS TEXT),
               gn.kind
        FROM traversal t
        JOIN graph_edges ge ON ge.from_node_id = t.node_id
        JOIN graph_nodes gn ON gn.id = ge.to_node_id
        WHERE t.depth < ?
          AND ge.kind NOT IN ('CO_CHANGES_WITH','PRECEDED_BY','EVOLVED_FROM')
          AND ',' || t.path || ',' NOT LIKE '%,' || CAST(ge.to_node_id AS TEXT) || ',%'
      )
      SELECT node_id, depth, edge_kind, confidence, path, kind
      FROM traversal WHERE depth > 0
        AND kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE','INTERFACE','TYPE','ENUM',
                     'TEST_SUITE','TEST_CASE','MIGRATION','CONFIG','DEPLOYMENT_UNIT','MODULE')
      ORDER BY depth ASC, confidence DESC
    `)

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO feature_traces
        (feature_node_id, code_node_id, trace_type, confidence, path_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    const batch = this.db.transaction((featureId: number) => {
      for (const r of traverse.all(featureId, MAX_DEPTH)) {
        const traceType =
          r.depth === 1 ? 'direct' :
          r.edge_kind === 'TRACES_TO' ? 'git_mined' :
          (r.kind === 'TEST_SUITE' || r.kind === 'TEST_CASE') ? 'test_derived' :
          'inferred'
        insert.run(featureId, r.node_id, traceType, r.confidence, r.path)
      }
    })

    for (const f of features) batch(f.id)
  }
}
```

---

*Part 1 ends here. Part 2 covers: The complete Pass C with all four levels of the fallback chain (C1–C4), ManualFeatureIngester, FeatureImportParser, CodeStructureExtractor (C3.5), the rewritten EmbeddingAligner with BM25 fallback, FIS Engine, SDLC Router, 6 PO Tools, Approval Gate, ISS IPC Handlers, all Renderer panels including the new ManualFeatureModal and FeatureSuggestionsPanel, and the complete build order.*
