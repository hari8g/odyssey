# RIAF Studio — Complete From-Scratch Implementation Plan
## Part 1 of 2: Architecture, Scaffold, Database, Indexing Pipeline

> **Scope**: A standalone cross-platform Electron desktop application implementing the full RIAF (Repository Intelligence and Analysis Framework). Built from scratch — no VS Code fork, no trove_v1 dependency. ISS Graph is designed in as a clean next layer from day one.
>
> **Date**: 2026-07-08 | **Target platforms**: Windows 10+ (x64, arm64) · macOS 12+ (Intel + Apple Silicon)

---

## Table of Contents — Part 1

1. [System Overview & Design Decisions](#1-system-overview--design-decisions)
2. [Technology Stack](#2-technology-stack)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Scaffold & Tooling Setup (Step-by-Step)](#4-scaffold--tooling-setup)
5. [Shared Types Package](#5-shared-types-package)
6. [Preload Bridge](#6-preload-bridge)
7. [Database Layer — Complete SQLite Schema](#7-database-layer--complete-sqlite-schema)
8. [Indexing Pipeline — All 12 Subsystems](#8-indexing-pipeline--all-12-subsystems)
9. [Workspace Profile Builder](#9-workspace-profile-builder)

---

## 1. System Overview & Design Decisions

### 1.1 What RIAF Studio is

RIAF Studio is a desktop application that opens a local code repository, runs a multi-stage
indexing pipeline against it, and provides three things:
1. **Instant, ranked codebase search** — FTS5 full-text + embedding-based hybrid retrieval.
2. **Structural intelligence** — UCG (Universal Context Graph) file-level import graph with cycle
   detection, hot files, arch layers.
3. **RIAF Analysis** — an LLM agent that reads the indexed data and writes a rich 12-section
   `{repo}_context.md` file (architecture diagram, call chains, patterns, cookbook, known issues).

The ISS Graph is NOT built in Phase 1 but every schema decision, API shape, and module boundary
is designed so ISS drops in as an additive layer with zero schema breaking changes.

### 1.2 Architecture decisions and rationale

| Decision | Choice | Rationale |
|---|---|---|
| Build system | electron-vite | 3-entrypoint (main/preload/renderer) with hot reload; TypeScript native; minimal config |
| Package manager | pnpm + workspace | Fast installs, hard-links, workspaces for code sharing |
| SQLite driver | better-sqlite3 | Synchronous API (no callback hell in main process); battle-tested; rebuilds cleanly on Electron via @electron/rebuild |
| UI framework | React 18 + Tailwind + shadcn/ui | Well-understood; shadcn components are copy-paste, not a heavy runtime |
| State | Zustand | Minimal, typed, no provider hell |
| LLM SDK | @anthropic-ai/sdk | Primary provider; abstracted behind ILLMProvider interface so any OpenAI-compatible endpoint swaps in |
| File watching | chokidar | De-facto cross-platform; handles Windows NTFS and macOS FSEvents correctly |
| File discovery | fast-glob | 10-100× faster than recursive readdir; built-in gitignore awareness with ignore pkg |
| Graph viz | reactflow | Declarative, headless-friendly; the UCG panel renders import graphs |
| IPC validation | zod | Schema-validates all IPC payloads at the preload boundary; catches serialization bugs early |
| Settings storage | electron-store | Cross-platform JSON persistence in app userData; typed via generics |
| Packaging | Electron Forge + makers | Squirrel for Windows, DMG for macOS; one config file |

### 1.3 Three-process Electron model

```
┌──────────────────────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                                              │
│  • All heavy computation lives here                                  │
│  • better-sqlite3 (synchronous, blocking OK in its own thread)       │
│  • chokidar file watcher                                             │
│  • Indexing pipeline (12 subsystems)                                 │
│  • LLM API calls (streaming via IPC events)                          │
│  • RIAF agent controller                                             │
│  • Settings store                                                    │
└───────────────────┬──────────────────────────────────────────────────┘
                    │ ipcMain.handle / ipcMain.on (request-response)
                    │ webContents.send (push events: progress, stream)
┌───────────────────┴──────────────────────────────────────────────────┐
│  PRELOAD SCRIPT (contextBridge)                                      │
│  • Exposes window.electronAPI — typed, validated surface             │
│  • No business logic; pure routing + zod validation                  │
└───────────────────┬──────────────────────────────────────────────────┘
                    │ window.electronAPI.*
┌───────────────────┴──────────────────────────────────────────────────┐
│  RENDERER PROCESS (Chromium + React)                                 │
│  • All UI: Workspace selector, Indexing panel, UCG graph,            │
│    Search, Symbol browser, RIAF run panel, Settings                  │
│  • Zustand stores subscribe to IPC events via window.electronAPI.on  │
│  • No direct Node.js / file system access                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.4 ISS compatibility layer (designed in from day 1)

Every schema table and service interface is designed with ISS in mind:
- `graph_nodes`, `graph_edges`, `feature_traces` tables are created in Phase 1 as empty tables
  (schema only, no population). ISS Phase 1 fills them.
- The IPC channel registry has reserved namespaces: `iss:*` channels are no-ops in Phase 1.
- The LLM tool-call framework accepts a `ToolPlugin` interface so ISS PO tools register without
  touching core code.
- The RIAF agent `RiafIndexSnapshot` has an `issGraphStats?: ISSGraphStats` optional field.

---

## 2. Technology Stack

### 2.1 Exact package versions (pin these)

```
Electron          31.x
electron-vite     2.x
@electron/rebuild 3.x
Electron Forge    7.x (CLI only — for packaging makers)

Node.js           22.x (LTS)
TypeScript        5.5.x
React             18.3.x
Vite              5.x

better-sqlite3    11.x
chokidar          4.x
fast-glob         3.x
ignore            6.x

@anthropic-ai/sdk 0.27.x
zod               3.23.x
electron-store    10.x
zustand           5.x
immer             10.x           (used with zustand/immer middleware)

reactflow         12.x
tailwindcss       3.4.x
@radix-ui/react-*  (via shadcn components, copy-paste)
lucide-react      0.396.x

@electron-toolkit/utils  3.x
@electron-toolkit/types  1.x

vitest            2.x            (testing)
```

### 2.2 Native module notes

`better-sqlite3` is a native Node.js addon. On every `npm install` (or in CI) run:
```
npx @electron/rebuild -f -w better-sqlite3
```
This recompiles the `.node` binary against the exact Electron ABI. The Forge `packageAfterCopy`
hook runs rebuild automatically. On Apple Silicon the same binary works natively; no Rosetta
needed with Node 22 + Electron 31.

---

## 3. Monorepo Structure

```
riaf-studio/
├── package.json                    ← root (pnpm workspace root)
├── pnpm-workspace.yaml
├── tsconfig.base.json              ← shared compiler base
├── .npmrc                          ← shamefully-hoist=true for electron
├── forge.config.ts                 ← Electron Forge packaging config
│
├── packages/
│   ├── shared/                     ← types shared by all 3 processes
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ipc.channels.ts     ← IPC channel names (const enum)
│   │       ├── ipc.schemas.ts      ← Zod schemas for every IPC payload
│   │       ├── ipc.types.ts        ← inferred TS types from schemas
│   │       ├── db.types.ts         ← DB row shapes (mirrors SQL columns)
│   │       ├── riaf.types.ts       ← RiafConfig, RiafIndexSnapshot, RiafRunState
│   │       ├── indexer.types.ts    ← WorkspaceProfile, CodeChunk, Symbol, UCG*
│   │       └── iss.types.ts        ← ISS stubs (empty in Phase 1; ISS fills them)
│   │
│   ├── main/                       ← Electron main process
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                    ← app entry; BrowserWindow; lifecycle
│   │       ├── ipcHandlers.ts              ← registers all ipcMain.handle calls
│   │       ├── settingsStore.ts            ← electron-store typed settings
│   │       │
│   │       ├── db/
│   │       │   ├── db.ts                   ← Database singleton (better-sqlite3)
│   │       │   ├── schema.ts               ← CREATE TABLE statements + indexes
│   │       │   ├── migrations.ts           ← version-gated DDL migrations
│   │       │   └── queries/
│   │       │       ├── chunks.queries.ts
│   │       │       ├── symbols.queries.ts
│   │       │       ├── ucg.queries.ts
│   │       │       ├── profile.queries.ts
│   │       │       ├── git.queries.ts
│   │       │       ├── graph.queries.ts    ← recursive CTE traversal (ISS-ready)
│   │       │       └── index.ts
│   │       │
│   │       ├── indexer/
│   │       │   ├── indexingPipeline.ts     ← orchestrator; emits progress events
│   │       │   ├── workspaceScanner.ts     ← file discovery + language stats
│   │       │   ├── codeChunker.ts          ← regex-based code chunking
│   │       │   ├── symbolExtractor.ts      ← symbol mining per language
│   │       │   ├── importExtractor.ts      ← universal import graph edges
│   │       │   ├── nodeClassifier.ts       ← archLayer + nodeType per file
│   │       │   ├── graphAnalyzer.ts        ← Tarjan SCC + UCG metrics
│   │       │   ├── commandDetector.ts      ← build/test/lint commands
│   │       │   ├── gitIndexer.ts           ← git context (diff, log, recency)
│   │       │   ├── embeddingService.ts     ← LLM embeddings + cosine + BLOB
│   │       │   ├── fileWatcher.ts          ← chokidar + incremental re-index
│   │       │   └── profileBuilder.ts       ← assembles WorkspaceProfile from DB
│   │       │
│   │       ├── llm/
│   │       │   ├── llmProvider.interface.ts  ← ILLMProvider + IStreamEvent
│   │       │   ├── anthropicProvider.ts
│   │       │   ├── openAICompatProvider.ts   ← any /v1/messages-compatible endpoint
│   │       │   ├── toolRunner.ts             ← tool-call dispatch loop
│   │       │   └── contextAssembler.ts       ← builds system prompt from snapshot
│   │       │
│   │       └── riaf/
│   │           ├── riafPrompts.ts            ← 12-section template
│   │           ├── riafAgent.ts              ← one-shot LLM agent
│   │           └── riafController.ts         ← FSM: idle→running→done|error
│   │
│   ├── preload/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── preload.ts          ← contextBridge exposes window.electronAPI
│   │
│   └── renderer/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── tailwind.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx             ← shell + panel routing
│           ├── api/
│           │   └── electronAPI.ts  ← typed wrapper around window.electronAPI
│           ├── store/
│           │   ├── workspace.store.ts
│           │   ├── indexing.store.ts
│           │   └── riaf.store.ts
│           ├── hooks/
│           │   ├── useIpcEvent.ts
│           │   └── useIndexingProgress.ts
│           └── panels/
│               ├── WorkspacePanel/
│               ├── IndexingPanel/
│               ├── UCGGraphPanel/
│               ├── SearchPanel/
│               ├── SymbolBrowserPanel/
│               ├── RiafPanel/
│               └── SettingsPanel/
│
├── resources/
│   ├── icon.icns           ← macOS
│   ├── icon.ico            ← Windows
│   └── icon.png            ← 512×512 source
│
└── out/                    ← generated by Forge (gitignored)
```

---

## 4. Scaffold & Tooling Setup

Follow these steps in order. Every command is exact.

### Step 4.1 — Initialise the repo

```bash
mkdir riaf-studio && cd riaf-studio
git init
pnpm init                   # creates root package.json

# Create pnpm workspace config
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

# Root .npmrc — required for Electron native modules on pnpm
cat > .npmrc << 'EOF'
shamefully-hoist=true
strict-peer-dependencies=false
EOF
```

### Step 4.2 — Root package.json

```jsonc
// package.json (root)
{
  "name": "riaf-studio",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":     "electron-vite dev",
    "build":   "tsc -b packages/shared && electron-vite build",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "package": "pnpm build && electron-forge package",
    "make":    "pnpm build && electron-forge make",
    "test":    "vitest run"
  },
  "devDependencies": {
    "electron":             "^31.0.0",
    "electron-vite":        "^2.3.0",
    "@electron/rebuild":    "^3.6.0",
    "electron-forge-plugin-vite": "^7.4.0",
    "@electron-forge/cli":       "^7.4.0",
    "@electron-forge/maker-squirrel": "^7.4.0",
    "@electron-forge/maker-dmg":      "^7.4.0",
    "@electron-forge/maker-zip":      "^7.4.0",
    "typescript":  "^5.5.0",
    "vitest":      "^2.0.0"
  }
}
```

### Step 4.3 — tsconfig.base.json (root)

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Step 4.4 — electron-vite.config.ts (root)

```typescript
// electron.vite.config.ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('packages/shared/src') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('packages/main/src/index.ts') },
        external: ['better-sqlite3']   // native — don't bundle
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('packages/shared/src') }
    },
    build: {
      rollupOptions: {
        input: { preload: resolve('packages/preload/src/preload.ts') }
      }
    }
  },
  renderer: {
    root: resolve('packages/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('packages/renderer/src'),
        '@shared': resolve('packages/shared/src')
      }
    }
  }
})
```

### Step 4.5 — forge.config.ts (root)

```typescript
// forge.config.ts
import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'RIAF Studio',
    executableName: 'riaf-studio',
    icon: 'resources/icon',
    asar: true,
    asarUnpack: ['**/node_modules/better-sqlite3/**'],
  },
  rebuildConfig: {
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    new MakerSquirrel({ name: 'riaf_studio' }),       // Windows
    new MakerDMG({ icon: 'resources/icon.icns' }),    // macOS
    new MakerZIP({}, ['linux']),                      // Linux (bonus)
  ],
}
export default config
```

### Step 4.6 — Install all dependencies

```bash
# Shared package
mkdir -p packages/shared/src
cat > packages/shared/package.json << 'EOF'
{
  "name": "@riaf-studio/shared",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": { "zod": "^3.23.0" }
}
EOF

# Main package
mkdir -p packages/main/src/{db/queries,indexer,llm,riaf}
cat > packages/main/package.json << 'EOF'
{
  "name": "@riaf-studio/main",
  "version": "0.1.0",
  "dependencies": {
    "@riaf-studio/shared": "workspace:*",
    "@anthropic-ai/sdk": "^0.27.0",
    "better-sqlite3": "^11.0.0",
    "chokidar": "^4.0.0",
    "fast-glob": "^3.3.0",
    "ignore": "^6.0.0",
    "electron-store": "^10.0.0",
    "@electron-toolkit/utils": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0"
  }
}
EOF

# Preload package
mkdir -p packages/preload/src
cat > packages/preload/package.json << 'EOF'
{
  "name": "@riaf-studio/preload",
  "version": "0.1.0",
  "dependencies": {
    "@riaf-studio/shared": "workspace:*",
    "@electron-toolkit/preload": "^3.0.0"
  }
}
EOF

# Renderer package
mkdir -p packages/renderer/src/{api,store,hooks,panels}
cat > packages/renderer/package.json << 'EOF'
{
  "name": "@riaf-studio/renderer",
  "version": "0.1.0",
  "dependencies": {
    "@riaf-studio/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^5.0.0",
    "immer": "^10.0.0",
    "@reactflow/core": "^12.0.0",
    "reactflow": "^12.0.0",
    "lucide-react": "^0.396.0",
    "tailwindcss": "^3.4.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
EOF

# Install everything
pnpm install

# Rebuild better-sqlite3 against Electron ABI
pnpm rebuild
```

---

## 5. Shared Types Package

### 5.1 `packages/shared/src/ipc.channels.ts`

All IPC channel names as const strings. Both main and renderer import from this file.

```typescript
// packages/shared/src/ipc.channels.ts

export const IPC = {
  // Workspace
  WORKSPACE_OPEN:           'workspace:open',        // → { workspaceRoot: string }
  WORKSPACE_CLOSE:          'workspace:close',
  WORKSPACE_GET_PROFILE:    'workspace:getProfile',

  // Indexing pipeline
  INDEXER_START:            'indexer:start',
  INDEXER_ABORT:            'indexer:abort',
  INDEXER_GET_STATUS:       'indexer:getStatus',
  INDEXER_PROGRESS:         'indexer:progress',      // push event (main → renderer)
  INDEXER_COMPLETE:         'indexer:complete',      // push event
  INDEXER_ERROR:            'indexer:error',         // push event

  // Search
  SEARCH_CODEBASE:          'search:codebase',
  SEARCH_CODEBASE_HYBRID:   'search:codebaseHybrid',
  SEARCH_SYMBOLS:           'search:symbols',

  // UCG graph
  UCG_GET_GRAPH:            'ucg:getGraph',
  UCG_GET_METRICS:          'ucg:getMetrics',
  UCG_GET_IMPORT_GRAPH:     'ucg:getImportGraph',

  // Git
  GIT_DIFF_STAT:            'git:diffStat',
  GIT_RECENTLY_CHANGED:     'git:recentlyChanged',

  // RIAF agent
  RIAF_START:               'riaf:start',
  RIAF_ABORT:               'riaf:abort',
  RIAF_GET_STATE:           'riaf:getState',
  RIAF_STREAM_CHUNK:        'riaf:streamChunk',      // push event
  RIAF_STATE_CHANGE:        'riaf:stateChange',      // push event

  // Settings
  SETTINGS_GET:             'settings:get',
  SETTINGS_SET:             'settings:set',

  // ISS namespace — reserved, no-ops in Phase 1
  ISS_TRACE_FEATURE:        'iss:traceFeature',
  ISS_IMPACT_ANALYSIS:      'iss:impactAnalysis',
  ISS_FEATURE_STATUS:       'iss:featureStatus',
  ISS_FIND_SIMILAR:         'iss:findSimilar',
  ISS_GEN_CRITERIA:         'iss:genCriteria',
  ISS_SUGGEST_ARCH:         'iss:suggestArch',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
```

### 5.2 `packages/shared/src/db.types.ts`

TypeScript mirrors of every SQLite table row. These are the "wire types" that travel across IPC.

```typescript
// packages/shared/src/db.types.ts

// ── file_metadata ───────────────────────────────────────────────────────────
export type FileMetadataRow = {
  id:           number
  workspaceRoot: string
  filePath:     string          // relative to workspaceRoot
  language:     string | null
  sizeBytes:    number
  lastModified: number          // unix ms
  contentHash:  string          // sha256 hex (first 8KB)
}

// ── code_chunks ──────────────────────────────────────────────────────────────
export type ChunkType = 'function' | 'class' | 'block' | 'file'

export type CodeChunkRow = {
  id:        string            // uuid
  fileId:    number            // FK → file_metadata.id
  filePath:  string            // denormalized for query speed
  chunkText: string
  startLine: number
  endLine:   number
  chunkType: ChunkType
}

// ── symbols ───────────────────────────────────────────────────────────────────
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const'

export type ExtractedSymbol = {
  id:          number
  fileId:      number
  filePath:    string
  name:        string
  kind:        SymbolKind
  startLine:   number
  endLine:     number
  signature:   string
  docstring:   string
  isExported:  boolean
  contentHash: string
}

// ── ucg (Universal Context Graph) ────────────────────────────────────────────
export type UCGFileNode = {
  id:            number
  filePath:      string
  language:      string
  nodeType:      string   // 'entry' | 'service' | 'util' | 'test' | 'config' | ...
  archLayer:     string   // 'presentation' | 'domain' | 'infra' | 'test' | 'build'
  isEntryPoint:  boolean
  importCount:   number
  importedByCount: number
}

export type UCGImportEdge = {
  id:           number
  fromFile:     string
  toModule:     string
  resolvedFile: string | null
  isExternal:   boolean
  edgeType:     string    // 'esm' | 'commonjs' | 'dynamic' | 'type-only'
}

export type UCGGraphMetrics = {
  totalNodes:   number
  totalEdges:   number
  entryCount:   number
  cycleCount:   number
  cycles:       string[][]
  hotFiles:     string[]     // top 10 by importedByCount
  externalDeps: Record<string, number>
  computedAt:   number
}

export type UCGGraphData = {
  nodes:   UCGFileNode[]
  edges:   UCGImportEdge[]
  metrics: UCGGraphMetrics | null
}

// ── workspace_profile ─────────────────────────────────────────────────────────
export type FrameworkEntry = {
  name:       string
  version:    string | null
  confidence: 'high' | 'medium' | 'low'
}

export type CommandEntry = {
  command:    string
  purpose:    'build' | 'test' | 'lint' | 'typecheck' | 'start' | 'format'
  confidence: 'high' | 'medium' | 'low'
  source:     string
}

export type WorkspaceProfile = {
  workspaceRoot:      string
  lastScannedAt:      number
  languageStack:      string[]
  frameworks:         FrameworkEntry[]
  packageManagers:    string[]
  buildCommands:      CommandEntry[]
  testCommands:       CommandEntry[]
  lintCommands:       CommandEntry[]
  fileCount:          number
  totalLoc:           number
  projectPurpose:     string | null
  architectureSummary: string | null
  isStale:            boolean
}

// ── git ───────────────────────────────────────────────────────────────────────
export type GitFileStats = {
  file:        string
  changeCount: number
  lastChanged: string    // ISO date
}

// ── search results ─────────────────────────────────────────────────────────────
export type CodebaseSearchResult = {
  filePath:  string
  startLine: number
  endLine:   number
  snippet:   string
  score:     number
}

// ── ISS stubs (Phase 1: empty; ISS fills them) ────────────────────────────────
export type GraphNodeKind =
  | 'EPIC' | 'FEATURE' | 'USER_STORY' | 'ACCEPTANCE_CRITERION' | 'API_CONTRACT'
  | 'DOMAIN_SERVICE' | 'MODULE' | 'DATA_FLOW' | 'EXTERNAL_DEPENDENCY'
  | 'CLASS' | 'FUNCTION' | 'INTERFACE' | 'TYPE' | 'ENUM'
  | 'TEST_SUITE' | 'TEST_CASE' | 'MIGRATION' | 'CONFIG' | 'DEPLOYMENT_UNIT'

export type SDLCPhase =
  | 'requirements' | 'design' | 'implementation'
  | 'testing' | 'deployment' | 'maintenance'

export type GraphNode = {
  id:            number
  kind:          GraphNodeKind
  label:         string
  description:   string | null
  sdlcPhase:     SDLCPhase | null
  sdlcConfidence: number | null      // 0–1
  sourceType:    'symbol' | 'issue' | 'gherkin' | 'git' | 'llm' | 'manual'
  sourceRef:     string | null
  filePath:      string | null
  startLine:     number | null
  endLine:       number | null
  importanceScore: number            // degree centrality or PageRank
  symbolId:      number | null       // FK → symbols.id
  fileId:        number | null       // FK → file_metadata.id
}

export type GraphEdgeKind =
  | 'IMPLEMENTS' | 'TRACES_TO' | 'SPECIFIES' | 'VALIDATES' | 'SATISFIES'
  | 'CALLS' | 'IMPORTS' | 'INHERITS' | 'IMPLEMENTS_INTERFACE' | 'TESTS'
  | 'MIGRATES' | 'DEPENDS_ON' | 'PRECEDED_BY' | 'EVOLVED_FROM' | 'CO_CHANGES_WITH'

export type GraphEdge = {
  id:         number
  fromNodeId: number
  toNodeId:   number
  kind:       GraphEdgeKind
  weight:     number
  confidence: number
  source:     'static_analysis' | 'git_log' | 'llm' | 'manual'
  metadataJson: string | null
}
```

### 5.3 `packages/shared/src/riaf.types.ts`

```typescript
// packages/shared/src/riaf.types.ts
import type { WorkspaceProfile } from './db.types'

export type RiafConfig = {
  outputFileName: string    // default: `{repoTitle}_context.md`
  maxFiles:       number    // default: 150
  includeTests:   boolean   // default: false
  model:          string    // default: 'claude-sonnet-4-6'
}

export const DEFAULT_RIAF_CONFIG: RiafConfig = {
  outputFileName: 'repo_context.md',
  maxFiles:       150,
  includeTests:   false,
  model:          'claude-sonnet-4-6',
}

// Pre-computed facts injected into the RIAF prompt so the agent skips
// expensive Phase-1 discovery for things the index already knows.
export type RiafIndexSnapshot = {
  languageStack:       string[]
  frameworks:          string[]
  packageManagers:     string[]
  fileCount:           number
  totalLoc:            number
  chunkCount:          number
  symbolCount:         number
  projectPurpose:      string | null
  architectureSummary: string | null
  buildCommands:       string[]
  testCommands:        string[]
  hotFiles:            string[]     // top 10 by import fan-in
  cycleCount:          number
  externalDepCount:    number
  gitBranch:           string | null
  recentlyChanged:     string[]     // top 10 recently modified files
  // ISS extension slot (Phase 2 fills this)
  issGraphStats?: {
    featureCount:    number
    tracesCoverage:  number      // % of features with ≥1 IMPLEMENTS edge
    topHubs:         string[]    // top 5 DOMAIN_SERVICE nodes
  }
}

export type RiafRunState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; outputPath: string }
  | { status: 'done';    startedAt: number; outputPath: string; durationMs: number }
  | { status: 'error';   startedAt: number; message: string }

// Progress events pushed during a run
export type RiafStreamChunk = {
  type: 'text' | 'tool_use_start' | 'tool_result' | 'done' | 'error'
  content: string
  toolName?: string
}
```

### 5.4 `packages/shared/src/indexer.types.ts`

```typescript
// packages/shared/src/indexer.types.ts

export type IndexingStage =
  | 'scan'       // file discovery
  | 'chunk'      // code chunking
  | 'symbols'    // symbol extraction
  | 'fts'        // FTS5 indexing
  | 'imports'    // import graph
  | 'graph'      // UCG analysis
  | 'commands'   // command detection
  | 'git'        // git context
  | 'embeddings' // embedding generation (optional)
  | 'profile'    // workspace profile assembly

export type IndexingStatus =
  | { stage: IndexingStage; phase: 'running';  pct: number; detail: string }
  | { stage: 'done';                           totalMs: number }
  | { stage: 'error';                          message: string }

export type IndexerState = {
  isRunning: boolean
  lastStatus: IndexingStatus | null
  lastCompletedAt: number | null
}
```

### 5.5 `packages/shared/src/index.ts`

```typescript
// packages/shared/src/index.ts
export * from './ipc.channels'
export * from './db.types'
export * from './riaf.types'
export * from './indexer.types'
```

---

## 6. Preload Bridge

```typescript
// packages/preload/src/preload.ts
import { contextBridge, ipcRenderer } from 'electron'
import type {
  RiafConfig, RiafRunState, RiafStreamChunk,
  IndexingStatus, WorkspaceProfile,
  UCGGraphData, UCGGraphMetrics,
  CodebaseSearchResult, ExtractedSymbol, GitFileStats
} from '@shared/index'

// ── Event bus ────────────────────────────────────────────────────────────────
//  The renderer calls api.on(channel, handler) to subscribe to push events.
//  Returns an unsubscribe function.
type UnsubFn = () => void

function on(channel: string, handler: (...args: unknown[]) => void): UnsubFn {
  const wrapped = (_: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

// ── API surface exposed to renderer ──────────────────────────────────────────
const api = {
  // --- Workspace ---
  openWorkspace:   (dir?: string) => ipcRenderer.invoke('workspace:open', dir),
  closeWorkspace:  ()             => ipcRenderer.invoke('workspace:close'),
  getProfile:      ()             => ipcRenderer.invoke('workspace:getProfile') as
                                       Promise<WorkspaceProfile | null>,

  // --- Indexer ---
  startIndexer:   ()  => ipcRenderer.invoke('indexer:start'),
  abortIndexer:   ()  => ipcRenderer.invoke('indexer:abort'),
  getIndexerState: () => ipcRenderer.invoke('indexer:getStatus') as
                           Promise<{ isRunning: boolean; lastCompletedAt: number | null }>,

  onIndexerProgress: (h: (s: IndexingStatus) => void): UnsubFn =>
    on('indexer:progress', h as never),
  onIndexerComplete: (h: () => void): UnsubFn =>
    on('indexer:complete', h as never),
  onIndexerError:    (h: (msg: string) => void): UnsubFn =>
    on('indexer:error', h as never),

  // --- Search ---
  searchCodebase: (query: string, max?: number) =>
    ipcRenderer.invoke('search:codebase', { query, max }) as
      Promise<CodebaseSearchResult[]>,
  searchCodebaseHybrid: (query: string, max?: number) =>
    ipcRenderer.invoke('search:codebaseHybrid', { query, max }) as
      Promise<CodebaseSearchResult[]>,
  searchSymbols: (query: string, max?: number) =>
    ipcRenderer.invoke('search:symbols', { query, max }) as
      Promise<ExtractedSymbol[]>,

  // --- UCG ---
  getUCGGraph:      () => ipcRenderer.invoke('ucg:getGraph') as
                            Promise<UCGGraphData | null>,
  getUCGMetrics:    () => ipcRenderer.invoke('ucg:getMetrics') as
                            Promise<UCGGraphMetrics | null>,
  getImportGraph:   (filePath: string, direction: 'imports'|'importedBy'|'both') =>
    ipcRenderer.invoke('ucg:getImportGraph', { filePath, direction }) as
      Promise<{ imports: string[]; importedBy: string[]; externalDeps: string[] }>,

  // --- Git ---
  getGitDiffStat:       () => ipcRenderer.invoke('git:diffStat') as
                                 Promise<string | null>,
  getRecentlyChanged:   (limit?: number) =>
    ipcRenderer.invoke('git:recentlyChanged', limit) as
      Promise<GitFileStats[]>,

  // --- RIAF ---
  startRiaf:    (config?: Partial<RiafConfig>) =>
    ipcRenderer.invoke('riaf:start', config),
  abortRiaf:    () => ipcRenderer.invoke('riaf:abort'),
  getRiafState: () => ipcRenderer.invoke('riaf:getState') as
                        Promise<RiafRunState>,

  onRiafStream:      (h: (chunk: RiafStreamChunk) => void): UnsubFn =>
    on('riaf:streamChunk', h as never),
  onRiafStateChange: (h: (state: RiafRunState) => void): UnsubFn =>
    on('riaf:stateChange', h as never),

  // --- Settings ---
  getSettings: <T>(key: string) =>
    ipcRenderer.invoke('settings:get', key) as Promise<T | undefined>,
  setSettings: <T>(key: string, value: T) =>
    ipcRenderer.invoke('settings:set', { key, value }),

  // --- Dialog ---
  showOpenDialog: (opts: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:showOpen', opts) as
      Promise<Electron.OpenDialogReturnValue>,
}

contextBridge.exposeInMainWorld('electronAPI', api)

// Type export for renderer
export type ElectronAPI = typeof api
```

---

## 7. Database Layer — Complete SQLite Schema

### 7.1 `packages/main/src/db/db.ts` — singleton with WAL mode

```typescript
// packages/main/src/db/db.ts
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { applyMigrations } from './migrations'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized — call initDb(workspaceRoot) first')
  return _db
}

/**
 * Opens (or creates) the per-workspace SQLite database.
 * Location: <workspaceRoot>/.riaf/riaf.db
 * WAL mode + busy_timeout + pragmas for performance.
 */
export function initDb(workspaceRoot: string): Database.Database {
  const riafDir = path.join(workspaceRoot, '.riaf')
  fs.mkdirSync(riafDir, { recursive: true })

  const dbPath = path.join(riafDir, 'riaf.db')
  const db = new Database(dbPath, { verbose: undefined })  // set to console.log for debug

  // Performance pragmas (applied once on open)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')   // safe with WAL
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -32000')    // 32 MB page cache
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456')  // 256 MB memory-mapped I/O

  applyMigrations(db)

  _db = db
  return db
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null }
}
```

### 7.2 `packages/main/src/db/schema.ts` — complete DDL

```typescript
// packages/main/src/db/schema.ts
// All CREATE TABLE / CREATE VIRTUAL TABLE / CREATE INDEX statements.
// Called by migrations.ts on schema version 1.

export const SCHEMA_V1 = `

-- ═══════════════════════════════════════════════════════════════════════
-- CORE: file_metadata
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_root TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  language      TEXT,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  last_modified INTEGER NOT NULL,        -- unix ms
  content_hash  TEXT NOT NULL,           -- sha256 hex of first 8KB
  UNIQUE(workspace_root, file_path)
);
CREATE INDEX IF NOT EXISTS idx_fm_workspace ON file_metadata(workspace_root);
CREATE INDEX IF NOT EXISTS idx_fm_language  ON file_metadata(language);

-- ═══════════════════════════════════════════════════════════════════════
-- CORE: code_chunks (chunked code segments, FTS5 searchable)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS code_chunks (
  id          TEXT PRIMARY KEY,          -- uuid v4
  file_id     INTEGER NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,             -- denormalized
  chunk_text  TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  chunk_type  TEXT NOT NULL CHECK(chunk_type IN ('function','class','block','file'))
);
CREATE INDEX IF NOT EXISTS idx_cc_file_id ON code_chunks(file_id);

-- FTS5 virtual table over chunks
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_text,
  file_path UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  chunk_type UNINDEXED,
  content = code_chunks,
  content_rowid = rowid,
  tokenize = 'unicode61 tokenchars "_-"'
);

-- FTS5 triggers to keep the virtual table in sync
CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON code_chunks BEGIN
  INSERT INTO chunks_fts(rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES (new.rowid, new.chunk_text, new.file_path, new.start_line, new.end_line, new.chunk_type);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON code_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES ('delete', old.rowid, old.chunk_text, old.file_path, old.start_line, old.end_line, old.chunk_type);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON code_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES ('delete', old.rowid, old.chunk_text, old.file_path, old.start_line, old.end_line, old.chunk_type);
  INSERT INTO chunks_fts(rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES (new.rowid, new.chunk_text, new.file_path, new.start_line, new.end_line, new.chunk_type);
END;

-- ═══════════════════════════════════════════════════════════════════════
-- CORE: symbols (extracted functions, classes, interfaces, etc.)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id      INTEGER NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,            -- denormalized
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK(kind IN ('function','class','interface','type','enum','const')),
  start_line   INTEGER NOT NULL,
  end_line     INTEGER NOT NULL,
  signature    TEXT NOT NULL DEFAULT '',
  docstring    TEXT NOT NULL DEFAULT '',
  is_exported  INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sym_file_id  ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_sym_name     ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_sym_kind     ON symbols(kind);

-- FTS5 for symbol search
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name, kind UNINDEXED, signature, docstring, file_path UNINDEXED,
  content = symbols,
  content_rowid = rowid,
  tokenize = 'unicode61 tokenchars "_-."'
);
CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, kind, signature, docstring, file_path)
  VALUES (new.rowid, new.name, new.kind, new.signature, new.docstring, new.file_path);
END;
CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, docstring, file_path)
  VALUES ('delete', old.rowid, old.name, old.kind, old.signature, old.docstring, old.file_path);
END;
CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, docstring, file_path)
  VALUES ('delete', old.rowid, old.name, old.kind, old.signature, old.docstring, old.file_path);
  INSERT INTO symbols_fts(rowid, name, kind, signature, docstring, file_path)
  VALUES (new.rowid, new.name, new.kind, new.signature, new.docstring, new.file_path);
END;

-- ═══════════════════════════════════════════════════════════════════════
-- UCG: file-level import graph
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ucg_file_nodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL UNIQUE,
  language        TEXT NOT NULL DEFAULT 'unknown',
  node_type       TEXT NOT NULL DEFAULT 'util',      -- entry|service|util|test|config|build
  arch_layer      TEXT NOT NULL DEFAULT 'domain',    -- presentation|domain|infra|test|build
  is_entry_point  INTEGER NOT NULL DEFAULT 0,
  import_count    INTEGER NOT NULL DEFAULT 0,
  imported_by_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ucg_node_type  ON ucg_file_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_ucg_arch_layer ON ucg_file_nodes(arch_layer);

CREATE TABLE IF NOT EXISTS ucg_import_edges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_file     TEXT NOT NULL,
  to_module     TEXT NOT NULL,
  resolved_file TEXT,           -- null if external/unresolved
  is_external   INTEGER NOT NULL DEFAULT 0,
  edge_type     TEXT NOT NULL DEFAULT 'esm'  -- esm|commonjs|dynamic|type-only
);
CREATE INDEX IF NOT EXISTS idx_ucg_edge_from ON ucg_import_edges(from_file);
CREATE INDEX IF NOT EXISTS idx_ucg_edge_to   ON ucg_import_edges(resolved_file);

CREATE TABLE IF NOT EXISTS ucg_graph_metrics (
  id            INTEGER PRIMARY KEY CHECK(id = 1),  -- singleton
  total_nodes   INTEGER NOT NULL DEFAULT 0,
  total_edges   INTEGER NOT NULL DEFAULT 0,
  entry_count   INTEGER NOT NULL DEFAULT 0,
  cycle_count   INTEGER NOT NULL DEFAULT 0,
  cycles_json   TEXT NOT NULL DEFAULT '[]',          -- JSON string[][]
  hot_files_json TEXT NOT NULL DEFAULT '[]',         -- JSON string[]
  external_deps_json TEXT NOT NULL DEFAULT '{}',     -- JSON {pkg: count}
  computed_at   INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════
-- WORKSPACE PROFILE
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspace_profiles (
  id                   INTEGER PRIMARY KEY CHECK(id = 1),  -- singleton
  workspace_root       TEXT NOT NULL,
  last_scanned_at      INTEGER NOT NULL,
  language_stack_json  TEXT NOT NULL DEFAULT '[]',
  frameworks_json      TEXT NOT NULL DEFAULT '[]',
  package_managers_json TEXT NOT NULL DEFAULT '[]',
  build_commands_json  TEXT NOT NULL DEFAULT '[]',
  test_commands_json   TEXT NOT NULL DEFAULT '[]',
  lint_commands_json   TEXT NOT NULL DEFAULT '[]',
  file_count           INTEGER NOT NULL DEFAULT 0,
  total_loc            INTEGER NOT NULL DEFAULT 0,
  project_purpose      TEXT,
  architecture_summary TEXT
);

-- ═══════════════════════════════════════════════════════════════════════
-- GIT: recently changed files (hot files from git log)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS git_file_stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path    TEXT NOT NULL UNIQUE,
  change_count INTEGER NOT NULL DEFAULT 0,
  last_changed TEXT NOT NULL   -- ISO date string
);
CREATE INDEX IF NOT EXISTS idx_git_change_count ON git_file_stats(change_count DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- EMBEDDINGS: per-chunk float32 vectors stored as BLOBs
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id     TEXT PRIMARY KEY REFERENCES code_chunks(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  embedding    BLOB NOT NULL,    -- little-endian float32 array
  created_at   INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════
-- ISS GRAPH TABLES (Phase 1: schema only, no population)
-- These tables are created here so ISS Phase 2 can INSERT without DDL changes.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS graph_nodes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,
  sdlc_phase       TEXT,
  sdlc_confidence  REAL,
  source_type      TEXT NOT NULL DEFAULT 'manual',
  source_ref       TEXT,
  file_path        TEXT,
  start_line       INTEGER,
  end_line         INTEGER,
  importance_score REAL NOT NULL DEFAULT 0.0,
  embedding_vec    BLOB,         -- float32, same encoding as chunk_embeddings
  symbol_id        INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  file_id          INTEGER REFERENCES file_metadata(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_gn_kind       ON graph_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_gn_sdlc_phase ON graph_nodes(sdlc_phase);
CREATE INDEX IF NOT EXISTS idx_gn_file_path  ON graph_nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_gn_importance ON graph_nodes(importance_score DESC);

CREATE TABLE IF NOT EXISTS graph_edges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  weight       REAL NOT NULL DEFAULT 1.0,
  confidence   REAL NOT NULL DEFAULT 1.0,
  source       TEXT NOT NULL DEFAULT 'static_analysis',
  metadata_json TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ge_from  ON graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_to    ON graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_kind  ON graph_edges(kind);

CREATE TABLE IF NOT EXISTS feature_traces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  code_node_id    INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  trace_type      TEXT NOT NULL,  -- 'direct'|'inferred'|'git_mined'|'test_derived'
  confidence      REAL NOT NULL DEFAULT 1.0,
  path_json       TEXT,           -- JSON array of intermediate node IDs
  UNIQUE(feature_node_id, code_node_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- SCHEMA VERSION (used by migrations.ts)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);
`
```

### 7.3 `packages/main/src/db/migrations.ts`

```typescript
// packages/main/src/db/migrations.ts
import type Database from 'better-sqlite3'
import { SCHEMA_V1 } from './schema'

interface Migration {
  version: number
  up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      // Execute the full v1 schema as one block
      db.exec(SCHEMA_V1)
    },
  },
  // Future migrations are append-only:
  // { version: 2, up: (db) => db.exec(`ALTER TABLE ... ADD COLUMN ...`) },
]

export function applyMigrations(db: Database.Database): void {
  // Ensure schema_version exists (before anything)
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`)
  db.exec(`INSERT OR IGNORE INTO schema_version(version) VALUES (0)`)

  const { version: current } = db
    .prepare<[], { version: number }>('SELECT version FROM schema_version')
    .get()!

  const pending = MIGRATIONS.filter(m => m.version > current)

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version)
    }
  })

  if (pending.length > 0) {
    runAll()
  }
}
```

---

## 8. Indexing Pipeline — All 12 Subsystems

### 8.0 `packages/main/src/indexer/indexingPipeline.ts` — Orchestrator

```typescript
// packages/main/src/indexer/indexingPipeline.ts
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { IndexingStatus } from '@shared/index'
import { IPC } from '@shared/index'
import { WorkspaceScanner }     from './workspaceScanner'
import { CodeChunker }          from './codeChunker'
import { SymbolExtractor }      from './symbolExtractor'
import { ImportExtractor }      from './importExtractor'
import { NodeClassifier }       from './nodeClassifier'
import { GraphAnalyzer }        from './graphAnalyzer'
import { CommandDetector }      from './commandDetector'
import { GitIndexer }           from './gitIndexer'
import { EmbeddingService }     from './embeddingService'
import { WorkspaceProfileBuilder } from './profileBuilder'

export class IndexingPipeline {
  private abortController: AbortController | null = null
  private isRunning = false

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRoot: string,
    private readonly win: BrowserWindow,
  ) {}

  get running() { return this.isRunning }

  abort() {
    this.abortController?.abort()
  }

  async run(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const push = (status: IndexingStatus) => {
      this.win.webContents.send(IPC.INDEXER_PROGRESS, status)
    }

    try {
      // ── Stage 1: Workspace scan ──────────────────────────────────────────
      push({ stage: 'scan', phase: 'running', pct: 0, detail: 'Discovering files…' })
      const scanner = new WorkspaceScanner(this.workspaceRoot, this.db)
      const scannedFiles = await scanner.scan(signal)
      push({ stage: 'scan', phase: 'running', pct: 100, detail: `${scannedFiles.length} files found` })

      if (signal.aborted) return

      // ── Stage 2: Chunking ────────────────────────────────────────────────
      push({ stage: 'chunk', phase: 'running', pct: 0, detail: 'Chunking source files…' })
      const chunker = new CodeChunker(this.db)
      await chunker.chunkAll(scannedFiles, signal, (pct, detail) =>
        push({ stage: 'chunk', phase: 'running', pct, detail }))

      if (signal.aborted) return

      // ── Stage 3: Symbol extraction ───────────────────────────────────────
      push({ stage: 'symbols', phase: 'running', pct: 0, detail: 'Extracting symbols…' })
      const extractor = new SymbolExtractor(this.db)
      await extractor.extractAll(scannedFiles, signal, (pct, detail) =>
        push({ stage: 'symbols', phase: 'running', pct, detail }))

      if (signal.aborted) return

      // ── Stage 4: Import graph ────────────────────────────────────────────
      push({ stage: 'imports', phase: 'running', pct: 0, detail: 'Building import graph…' })
      const importEx = new ImportExtractor(this.db, this.workspaceRoot)
      await importEx.extractAll(scannedFiles, signal, (pct) =>
        push({ stage: 'imports', phase: 'running', pct, detail: 'Processing imports…' }))

      if (signal.aborted) return

      // ── Stage 5: Node classification ─────────────────────────────────────
      push({ stage: 'graph', phase: 'running', pct: 10, detail: 'Classifying nodes…' })
      const classifier = new NodeClassifier(this.db, this.workspaceRoot)
      classifier.classifyAll()

      // ── Stage 6: UCG analysis (Tarjan, metrics) ──────────────────────────
      push({ stage: 'graph', phase: 'running', pct: 50, detail: 'Analyzing graph structure…' })
      const analyzer = new GraphAnalyzer(this.db)
      analyzer.analyze()
      push({ stage: 'graph', phase: 'running', pct: 100, detail: 'UCG complete' })

      if (signal.aborted) return

      // ── Stage 7: Command detection ────────────────────────────────────────
      push({ stage: 'commands', phase: 'running', pct: 0, detail: 'Detecting build commands…' })
      const cmdDet = new CommandDetector(this.workspaceRoot)
      const commands = await cmdDet.detect()
      push({ stage: 'commands', phase: 'running', pct: 100, detail: `${commands.length} commands found` })

      if (signal.aborted) return

      // ── Stage 8: Git context ─────────────────────────────────────────────
      push({ stage: 'git', phase: 'running', pct: 0, detail: 'Mining git history…' })
      const gitIdx = new GitIndexer(this.db, this.workspaceRoot)
      await gitIdx.index()
      push({ stage: 'git', phase: 'running', pct: 100, detail: 'Git context ready' })

      if (signal.aborted) return

      // ── Stage 9: Embeddings (optional / best-effort) ─────────────────────
      push({ stage: 'embeddings', phase: 'running', pct: 0, detail: 'Generating embeddings…' })
      const embedSvc = EmbeddingService.getInstance()
      const embeddingCount = await embedSvc.indexWorkspace(this.db, signal,
        (pct) => push({ stage: 'embeddings', phase: 'running', pct,
                        detail: `${pct}% embedded` }))
      push({ stage: 'embeddings', phase: 'running', pct: 100,
             detail: embeddingCount === 0 ? 'Skipped (endpoint unavailable)' :
                     `${embeddingCount} chunks embedded` })

      // ── Stage 10: Profile assembly ────────────────────────────────────────
      push({ stage: 'profile', phase: 'running', pct: 0, detail: 'Building workspace profile…' })
      const builder = new WorkspaceProfileBuilder(this.db, this.workspaceRoot)
      builder.buildAndSave(scannedFiles, commands)
      push({ stage: 'profile', phase: 'running', pct: 100, detail: 'Profile saved' })

      this.win.webContents.send(IPC.INDEXER_COMPLETE)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.win.webContents.send(IPC.INDEXER_ERROR, msg)
    } finally {
      this.isRunning = false
      this.abortController = null
    }
  }
}
```

### 8.1 `workspaceScanner.ts` — File Discovery

```typescript
// packages/main/src/indexer/workspaceScanner.ts
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import fg from 'fast-glob'
import ignore from 'ignore'

// All extensions that are indexed
const INDEXABLE_EXTENSIONS = new Set([
  '.ts','.tsx','.js','.jsx','.mjs','.cjs',
  '.py','.java','.go','.rs','.cpp','.c','.h','.hpp',
  '.cs','.swift','.kt','.rb','.php','.scala',
  '.json','.yaml','.yml','.toml','.xml',
  '.md','.sql','.sh','.bash','.zsh','.fish',
  '.css','.scss','.less','.html','.vue','.svelte',
  'Dockerfile','.dockerfile','.env.example','.env.sample',
])

// Directories always excluded from indexing
const ALWAYS_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.riaf/**',   // our own output
  '**/__pycache__/**',
  '**/*.pyc',
  '**/target/**',  // Rust/Java build output
  '**/.gradle/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/*.map',
]

const LANGUAGE_MAP: Record<string, string> = {
  '.ts':'typescript', '.tsx':'typescript', '.js':'javascript', '.jsx':'javascript',
  '.mjs':'javascript', '.cjs':'javascript', '.py':'python', '.java':'java',
  '.go':'go', '.rs':'rust', '.cpp':'cpp', '.c':'c', '.h':'c', '.hpp':'cpp',
  '.cs':'csharp', '.swift':'swift', '.kt':'kotlin', '.rb':'ruby', '.php':'php',
  '.scala':'scala', '.md':'markdown', '.sql':'sql', '.sh':'shell',
  '.bash':'shell', '.zsh':'shell', '.json':'json', '.yaml':'yaml', '.yml':'yaml',
  '.toml':'toml', '.xml':'xml', '.css':'css', '.scss':'scss', '.html':'html',
  '.vue':'vue', '.svelte':'svelte',
}

export type ScannedFile = {
  absolutePath: string
  relativePath: string
  language: string
  sizeBytes: number
  lastModified: number
  contentHash: string
}

export class WorkspaceScanner {
  constructor(
    private readonly root: string,
    private readonly db: Database.Database,
  ) {}

  async scan(signal: AbortSignal): Promise<ScannedFile[]> {
    // Load .gitignore patterns
    const ig = ignore()
    const gitignorePath = path.join(this.root, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      ig.add(fs.readFileSync(gitignorePath, 'utf8'))
    }

    // Discover all files with fast-glob
    const allPaths = await fg('**/*', {
      cwd: this.root,
      dot: true,
      ignore: ALWAYS_IGNORE,
      absolute: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    })

    if (signal.aborted) return []

    // Filter: gitignore + extension whitelist
    const filtered = allPaths.filter(rel => {
      if (ig.ignores(rel)) return false
      const ext = path.extname(rel).toLowerCase() || path.basename(rel)
      return INDEXABLE_EXTENSIONS.has(ext)
    })

    const result: ScannedFile[] = []
    const upsert = this.db.prepare<[string,string,string|null,number,number,string]>(`
      INSERT INTO file_metadata(workspace_root, file_path, language, size_bytes, last_modified, content_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_root, file_path) DO UPDATE SET
        language = excluded.language,
        size_bytes = excluded.size_bytes,
        last_modified = excluded.last_modified,
        content_hash = excluded.content_hash
    `)

    const batch = this.db.transaction((files: ScannedFile[]) => {
      for (const f of files) {
        upsert.run(this.root, f.relativePath, f.language, f.sizeBytes,
                   f.lastModified, f.contentHash)
      }
    })

    const batchSize = 200
    let pending: ScannedFile[] = []

    for (const rel of filtered) {
      if (signal.aborted) break
      const abs = path.join(this.root, rel)
      try {
        const stat = fs.statSync(abs)
        const ext = path.extname(rel).toLowerCase()
        const language = LANGUAGE_MAP[ext] ?? 'unknown'
        const head = fs.readFileSync(abs).subarray(0, 8192)
        const contentHash = crypto.createHash('sha256').update(head).digest('hex')

        const sf: ScannedFile = {
          absolutePath: abs,
          relativePath: rel,
          language,
          sizeBytes: stat.size,
          lastModified: stat.mtimeMs,
          contentHash,
        }
        pending.push(sf)
        result.push(sf)

        if (pending.length >= batchSize) {
          batch(pending)
          pending = []
        }
      } catch { /* skip unreadable files */ }
    }

    if (pending.length > 0) batch(pending)
    return result
  }
}
```

### 8.2 `codeChunker.ts` — Regex-Based Code Chunking

```typescript
// packages/main/src/indexer/codeChunker.ts
// Strategy: split files at semantic boundaries (function/class/block declarations).
// Fallback: sliding window of CHUNK_MAX_LINES lines with CHUNK_OVERLAP_LINES overlap.
import fs from 'node:fs'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { ScannedFile } from './workspaceScanner'
import type { ChunkType } from '@shared/index'

const CHUNK_MAX_LINES   = 80
const CHUNK_OVERLAP     = 10
const CHUNK_MIN_LINES   = 4
const MAX_FILE_BYTES    = 1_000_000   // skip files > 1MB

type BoundaryPattern = { regex: RegExp; type: ChunkType }

const PATTERNS: Record<string, BoundaryPattern[]> = {
  typescript: [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+\w/m, type: 'function' },
    { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+\w/m, type: 'class' },
    { regex: /^(?:export\s+)?interface\s+\w/m,              type: 'class' },
    { regex: /^(?:export\s+)?type\s+\w+\s*=/m,             type: 'block' },
    { regex: /^(?:export\s+)?const\s+\w+\s*=/m,            type: 'block' },
    { regex: /^\s+(?:async\s+)?(?:public|private|protected|static).*\(/, type: 'function' },
  ],
  javascript: [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+\w/m, type: 'function' },
    { regex: /^(?:export\s+)?class\s+\w/m,                 type: 'class' },
    { regex: /^(?:export\s+)?const\s+\w+\s*=/m,            type: 'block' },
    { regex: /^module\.exports\s*=/m,                       type: 'block' },
  ],
  python: [
    { regex: /^def\s+\w/m,   type: 'function' },
    { regex: /^class\s+\w/m, type: 'class' },
    { regex: /^async\s+def\s+\w/m, type: 'function' },
  ],
  java: [
    { regex: /^\s*(?:public|private|protected|static)\s+\S+\s+\w+\s*\(/m, type: 'function' },
    { regex: /^\s*(?:public|private|protected|abstract)?\s*class\s+\w/m, type: 'class' },
    { regex: /^\s*interface\s+\w/m, type: 'class' },
  ],
  go: [
    { regex: /^func\s+\w/m,        type: 'function' },
    { regex: /^func\s+\(\w/m,      type: 'function' },   // method
    { regex: /^type\s+\w+\s+struct/m, type: 'class' },
    { regex: /^type\s+\w+\s+interface/m, type: 'class' },
  ],
  rust: [
    { regex: /^(?:pub\s+)?fn\s+\w/m,     type: 'function' },
    { regex: /^(?:pub\s+)?struct\s+\w/m, type: 'class' },
    { regex: /^(?:pub\s+)?impl\s+\w/m,   type: 'class' },
    { regex: /^(?:pub\s+)?trait\s+\w/m,  type: 'class' },
  ],
}

export class CodeChunker {
  private readonly insertChunk: Database.Statement

  constructor(private readonly db: Database.Database) {
    // Clear old chunks for a file before re-inserting
    this.insertChunk = this.db.prepare<[string,number,string,string,number,number,string]>(`
      INSERT OR REPLACE INTO code_chunks(id, file_id, file_path, chunk_text, start_line, end_line, chunk_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
  }

  async chunkAll(
    files: ScannedFile[],
    signal: AbortSignal,
    progress: (pct: number, detail: string) => void,
  ): Promise<void> {
    const total = files.length
    const getFileId = this.db.prepare<[string,string], { id: number }>(
      'SELECT id FROM file_metadata WHERE workspace_root = ? AND file_path = ?'
    )
    const deleteOld = this.db.prepare<[number]>(
      'DELETE FROM code_chunks WHERE file_id = ?'
    )

    const batchInsert = this.db.transaction((rows: Parameters<typeof this.insertChunk['run']>[]) => {
      for (const r of rows) this.insertChunk.run(...r as Parameters<typeof this.insertChunk['run']>)
    })

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) return
      const f = files[i]!
      if (f.sizeBytes > MAX_FILE_BYTES) continue

      const row = getFileId.get(/* workspaceRoot */ this.db.pragma('database_list')[0]?.name ?? '', f.relativePath)
      if (!row) continue

      const content = fs.readFileSync(f.absolutePath, 'utf8')
      const chunks = this.chunkFile(content, f.relativePath, f.language)

      deleteOld.run(row.id)
      const insertRows = chunks.map(c => [
        randomUUID(), row.id, f.relativePath,
        c.text, c.startLine, c.endLine, c.type
      ] as Parameters<typeof this.insertChunk['run']>)

      batchInsert(insertRows)
      progress(Math.round((i / total) * 100), `${i + 1}/${total}: ${f.relativePath}`)
    }
  }

  private chunkFile(
    content: string,
    filePath: string,
    language: string,
  ): { text: string; startLine: number; endLine: number; type: ChunkType }[] {
    const lines = content.split('\n')
    if (lines.length === 0) return []

    const patterns = PATTERNS[language] ?? []
    if (patterns.length === 0) {
      // Sliding window fallback for unsupported languages
      return this.slidingWindowChunks(lines, 'block')
    }

    // Find boundary lines
    const boundaries: { line: number; type: ChunkType }[] = [{ line: 0, type: 'file' }]
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? ''
      for (const p of patterns) {
        if (p.regex.test(lineText)) {
          boundaries.push({ line: i, type: p.type })
          break
        }
      }
    }
    boundaries.push({ line: lines.length, type: 'file' })  // sentinel

    const result: ReturnType<typeof this.chunkFile> = []

    for (let b = 0; b < boundaries.length - 1; b++) {
      const start = boundaries[b]!.line
      const end   = boundaries[b + 1]!.line
      const type  = boundaries[b]!.type

      const segmentLines = lines.slice(start, end)
      if (segmentLines.length < CHUNK_MIN_LINES) continue

      // If segment is short enough, emit as-is
      if (segmentLines.length <= CHUNK_MAX_LINES) {
        result.push({
          text: segmentLines.join('\n'),
          startLine: start + 1,
          endLine: end,
          type,
        })
      } else {
        // Segment too long: sub-divide with sliding window
        const subChunks = this.slidingWindowChunks(segmentLines, type)
        for (const sc of subChunks) {
          result.push({
            ...sc,
            startLine: sc.startLine + start,
            endLine: sc.endLine + start,
          })
        }
      }
    }

    // Ensure full-file chunk always exists
    if (lines.length <= CHUNK_MAX_LINES) {
      result.push({ text: content, startLine: 1, endLine: lines.length, type: 'file' })
    }

    return result
  }

  private slidingWindowChunks(
    lines: string[],
    type: ChunkType,
  ): { text: string; startLine: number; endLine: number; type: ChunkType }[] {
    const result = []
    const step = CHUNK_MAX_LINES - CHUNK_OVERLAP
    for (let i = 0; i < lines.length; i += step) {
      const slice = lines.slice(i, i + CHUNK_MAX_LINES)
      if (slice.length < CHUNK_MIN_LINES) break
      result.push({ text: slice.join('\n'), startLine: i + 1, endLine: i + slice.length, type })
    }
    return result
  }
}
```

### 8.3 `symbolExtractor.ts` — Symbol Mining

```typescript
// packages/main/src/indexer/symbolExtractor.ts
import fs from 'node:fs'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ScannedFile } from './workspaceScanner'
import type { SymbolKind } from '@shared/index'

type SymbolPattern = {
  kind: SymbolKind
  regex: RegExp
  nameGroup: number          // capture group index for the name
  signatureGroup?: number    // capture group for signature (optional)
}

const SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  typescript: [
    { kind: 'function',
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*(\([^)]*\)(?:\s*:\s*\S+)?)/gm,
      nameGroup: 1, signatureGroup: 3 },
    { kind: 'class',
      regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'interface',
      regex: /^(?:export\s+)?interface\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'type',
      regex: /^(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=/gm,
      nameGroup: 1 },
    { kind: 'enum',
      regex: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'const',
      regex: /^export\s+const\s+(\w+)\s*(?::\s*\S+)?\s*=/gm,
      nameGroup: 1 },
  ],
  javascript: [
    { kind: 'function',
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/gm,
      nameGroup: 1, signatureGroup: 2 },
    { kind: 'class',
      regex: /^(?:export\s+)?class\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'const',
      regex: /^(?:export\s+)?const\s+(\w+)\s*=/gm,
      nameGroup: 1 },
  ],
  python: [
    { kind: 'function',
      regex: /^(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))/gm,
      nameGroup: 1, signatureGroup: 2 },
    { kind: 'class',
      regex: /^class\s+(\w+)/gm,
      nameGroup: 1 },
  ],
  java: [
    { kind: 'class',
      regex: /^\s*(?:public|private|protected)?\s*(?:abstract\s+)?class\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'interface',
      regex: /^\s*(?:public\s+)?interface\s+(\w+)/gm,
      nameGroup: 1 },
    { kind: 'function',
      regex: /^\s*(?:public|private|protected|static)\s+\S+\s+(\w+)\s*\(/gm,
      nameGroup: 1 },
  ],
  go: [
    { kind: 'function',
      regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/gm,
      nameGroup: 1 },
    { kind: 'type',
      regex: /^type\s+(\w+)\s+struct/gm,
      nameGroup: 1 },
    { kind: 'interface',
      regex: /^type\s+(\w+)\s+interface/gm,
      nameGroup: 1 },
  ],
}

export class SymbolExtractor {
  private readonly upsert: Database.Statement
  private readonly deleteForFile: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.upsert = db.prepare(`
      INSERT INTO symbols(file_id, file_path, name, kind, start_line, end_line,
                          signature, docstring, is_exported, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.deleteForFile = db.prepare('DELETE FROM symbols WHERE file_id = ?')
  }

  async extractAll(
    files: ScannedFile[],
    signal: AbortSignal,
    progress: (pct: number, detail: string) => void,
  ): Promise<void> {
    const getFileId = this.db.prepare<[string], { id: number }>(
      'SELECT id FROM file_metadata WHERE file_path = ?'
    )

    const batchOp = this.db.transaction((fileId: number, filePath: string, content: string, lang: string) => {
      this.deleteForFile.run(fileId)
      const syms = this.extractFromContent(content, filePath, lang)
      for (const s of syms) {
        const hash = crypto.createHash('sha256').update(s.signature + s.name).digest('hex')
        this.upsert.run(fileId, filePath, s.name, s.kind, s.startLine, s.endLine,
                        s.signature, s.docstring, s.isExported ? 1 : 0, hash)
      }
    })

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) return
      const f = files[i]!
      const patterns = SYMBOL_PATTERNS[f.language]
      if (!patterns) continue

      const row = getFileId.get(f.relativePath)
      if (!row) continue

      const content = fs.readFileSync(f.absolutePath, 'utf8')
      batchOp(row.id, f.relativePath, content, f.language)
      progress(Math.round((i / files.length) * 100), f.relativePath)
    }
  }

  private extractFromContent(
    content: string,
    filePath: string,
    language: string,
  ): { name: string; kind: SymbolKind; startLine: number; endLine: number;
       signature: string; docstring: string; isExported: boolean }[] {
    const patterns = SYMBOL_PATTERNS[language] ?? []
    const lines = content.split('\n')
    const result = []

    for (const { kind, regex, nameGroup, signatureGroup } of patterns) {
      regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = regex.exec(content)) !== null) {
        const name = match[nameGroup] ?? ''
        if (!name) continue

        // Compute line number from match offset
        const before = content.slice(0, match.index)
        const startLine = (before.match(/\n/g) ?? []).length + 1
        const endLine   = Math.min(startLine + 30, lines.length)  // estimate; no full AST

        const signature = signatureGroup ? (match[signatureGroup] ?? '') : ''
        const docstring = this.extractDocstring(lines, startLine - 2)
        const isExported = match[0]!.includes('export')

        result.push({ name, kind, startLine, endLine, signature, docstring, isExported })
      }
    }

    return result
  }

  private extractDocstring(lines: string[], lineIndex: number): string {
    if (lineIndex < 0) return ''
    // Walk backwards to find /** ... */ or # ... or // comments
    const commentLines: string[] = []
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 10); i--) {
      const line = (lines[i] ?? '').trim()
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/**') ||
          line.startsWith('#') || line.startsWith('"""') || line === '*/') {
        commentLines.unshift(line.replace(/^(\/\/|\*|#|\/\*\*|\*\/)\s?/, '').trim())
      } else if (commentLines.length > 0) {
        break
      }
    }
    return commentLines.filter(Boolean).join(' ').slice(0, 500)
  }
}
```

### 8.4 `importExtractor.ts` — Universal Import Graph

```typescript
// packages/main/src/indexer/importExtractor.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ScannedFile } from './workspaceScanner'

// Regex patterns per language for import statements
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*import\s+(?:type\s+)?(?:\*\s+as\s+\w+|{[^}]*}|\w+)(?:\s*,\s*{[^}]*})?\s+from\s+['"]([^'"]+)['"]/gm,
    /^\s*(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm,
    /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,   // dynamic
  ],
  javascript: [
    /^\s*import\s+(?:\*\s+as\s+\w+|{[^}]*}|\w+)(?:\s*,\s*{[^}]*})?\s+from\s+['"]([^'"]+)['"]/gm,
    /^\s*(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ],
  python: [
    /^\s*from\s+(\S+)\s+import/gm,
    /^\s*import\s+(\S+)/gm,
  ],
  java: [
    /^\s*import\s+(?:static\s+)?([a-zA-Z][\w.]+);/gm,
  ],
  go: [
    /["']([^"']+)["']/gm,  // simplified; matches inside import blocks
  ],
  rust: [
    /^\s*use\s+([\w:]+)/gm,
  ],
}

const RESOLVER_EXTENSIONS = ['.ts','.tsx','.js','.jsx','.mjs','.cjs',
                              '/index.ts','/index.js','/index.tsx']

export class ImportExtractor {
  private readonly insertEdge: Database.Statement
  private readonly clearForFile: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRoot: string,
  ) {
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO ucg_import_edges
        (from_file, to_module, resolved_file, is_external, edge_type)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.clearForFile = db.prepare(
      'DELETE FROM ucg_import_edges WHERE from_file = ?'
    )
  }

  async extractAll(
    files: ScannedFile[],
    signal: AbortSignal,
    progress: (pct: number) => void,
  ): Promise<void> {
    // Build a quick path-lookup set for resolution
    const knownPaths = new Set(files.map(f => f.relativePath))

    const batch = this.db.transaction((f: ScannedFile, content: string) => {
      this.clearForFile.run(f.relativePath)
      const edges = this.extractEdges(content, f.relativePath, f.language, knownPaths)
      for (const e of edges) {
        this.insertEdge.run(e.fromFile, e.toModule, e.resolvedFile, e.isExternal ? 1 : 0, e.edgeType)
      }
    })

    for (let i = 0; i < files.length; i++) {
      if (signal.aborted) return
      const f = files[i]!
      const patterns = IMPORT_PATTERNS[f.language]
      if (!patterns) continue

      const content = fs.readFileSync(f.absolutePath, 'utf8')
      batch(f, content)
      progress(Math.round((i / files.length) * 100))
    }
  }

  private extractEdges(
    content: string,
    fromFile: string,
    language: string,
    knownPaths: Set<string>,
  ) {
    const patterns = IMPORT_PATTERNS[language] ?? []
    const edges: { fromFile: string; toModule: string; resolvedFile: string | null;
                   isExternal: boolean; edgeType: string }[] = []
    const seen = new Set<string>()

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      const isDynamic = pattern.source.includes('import\\s*\\(')
      const edgeType = isDynamic ? 'dynamic' :
                       pattern.source.includes('require') ? 'commonjs' : 'esm'

      while ((match = pattern.exec(content)) !== null) {
        const mod = match[1]?.trim()
        if (!mod || seen.has(mod)) continue
        seen.add(mod)

        const isExternal = !mod.startsWith('.') && !mod.startsWith('/')
        const resolvedFile = isExternal ? null :
          this.resolveRelative(path.dirname(fromFile), mod, knownPaths)

        edges.push({ fromFile, toModule: mod, resolvedFile, isExternal, edgeType })
      }
    }

    return edges
  }

  private resolveRelative(
    fromDir: string,
    spec: string,
    known: Set<string>,
  ): string | null {
    const base = path.normalize(path.join(fromDir, spec)).replace(/\\/g, '/')
    if (known.has(base)) return base
    for (const ext of RESOLVER_EXTENSIONS) {
      const candidate = base + ext
      if (known.has(candidate)) return candidate
    }
    return null
  }
}
```

### 8.5 `nodeClassifier.ts` — Arch Layer + Node Type

```typescript
// packages/main/src/indexer/nodeClassifier.ts
import path from 'node:path'
import type Database from 'better-sqlite3'

type ArchLayer = 'presentation' | 'domain' | 'infra' | 'test' | 'build' | 'config'
type NodeType  = 'entry' | 'service' | 'repository' | 'util' | 'test' | 'config' | 'build' | 'component' | 'hook'

const ARCH_LAYER_RULES: [RegExp, ArchLayer][] = [
  [/\.(test|spec)\.(ts|js|tsx|jsx)$/i,          'test'],
  [/__tests__|test\//i,                          'test'],
  [/Dockerfile|\.dockerfile|docker-compose/i,    'build'],
  [/webpack|vite|rollup|babel|tsconfig|eslint|\.prettierrc/i, 'config'],
  [/migrations?\/|\.sql$/i,                     'infra'],
  [/\/pages\/|\/views\/|\/screens\/|\/routes\//,'presentation'],
  [/components?\/|widgets?\/|ui\//i,             'presentation'],
  [/hooks?\/|use[A-Z]/,                          'presentation'],
  [/services?\/.*\.(ts|js)/i,                   'domain'],
  [/repositories?\/|repos?\//i,                  'infra'],
  [/utils?\/|helpers?\/|lib\//i,                 'domain'],
  [/\.env|config\//i,                            'config'],
]

const NODE_TYPE_RULES: [RegExp, NodeType][] = [
  [/\.(test|spec)\./i,       'test'],
  [/service\.(ts|js)$/i,     'service'],
  [/repository\.(ts|js)$/i,  'repository'],
  [/controller\.(ts|js)$/i,  'service'],
  [/handler\.(ts|js)$/i,     'service'],
  [/use[A-Z]\w+\.(ts|tsx)$/, 'hook'],
  [/component\.(ts|tsx)$/i,  'component'],
  [/index\.(ts|js|tsx|jsx)$/, 'entry'],
  [/main\.(ts|js)$/,          'entry'],
  [/app\.(ts|js|tsx|jsx)$/i,  'entry'],
  [/Dockerfile|webpack|vite/, 'build'],
  [/config\./i,               'config'],
]

export class NodeClassifier {
  private readonly upsert: Database.Statement
  private readonly allFiles: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRoot: string,
  ) {
    this.upsert = db.prepare(`
      INSERT INTO ucg_file_nodes(file_path, language, node_type, arch_layer, is_entry_point)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        language = excluded.language,
        node_type = excluded.node_type,
        arch_layer = excluded.arch_layer,
        is_entry_point = excluded.is_entry_point
    `)
    this.allFiles = db.prepare('SELECT file_path, language FROM file_metadata')
  }

  classifyAll(): void {
    const files = this.allFiles.all() as { file_path: string; language: string }[]

    const batch = this.db.transaction((rows: { file_path: string; language: string }[]) => {
      for (const f of rows) {
        const rel = f.file_path
        const archLayer = this.detectArchLayer(rel)
        const nodeType  = this.detectNodeType(rel)
        const isEntry   = nodeType === 'entry' ? 1 : 0
        this.upsert.run(rel, f.language, nodeType, archLayer, isEntry)
      }
    })

    batch(files)
  }

  private detectArchLayer(filePath: string): ArchLayer {
    for (const [pattern, layer] of ARCH_LAYER_RULES) {
      if (pattern.test(filePath)) return layer
    }
    return 'domain'
  }

  private detectNodeType(filePath: string): NodeType {
    for (const [pattern, type] of NODE_TYPE_RULES) {
      if (pattern.test(filePath)) return type
    }
    return 'util'
  }
}
```

### 8.6 `graphAnalyzer.ts` — Tarjan SCC + UCG Metrics

```typescript
// packages/main/src/indexer/graphAnalyzer.ts
import type Database from 'better-sqlite3'

export class GraphAnalyzer {
  constructor(private readonly db: Database.Database) {}

  analyze(): void {
    const edges = this.db
      .prepare<[], { from_file: string; resolved_file: string }>(
        'SELECT from_file, resolved_file FROM ucg_import_edges WHERE resolved_file IS NOT NULL'
      )
      .all()

    const nodes = this.db
      .prepare<[], { file_path: string }>('SELECT file_path FROM ucg_file_nodes')
      .all()
      .map(r => r.file_path)

    // Build adjacency list
    const adj = new Map<string, string[]>()
    for (const n of nodes) adj.set(n, [])
    for (const e of edges) {
      adj.get(e.from_file)?.push(e.resolved_file)
    }

    // ── Tarjan's SCC (iterative to avoid stack overflow on large repos) ──
    const cycles = this.tarjanIterative(nodes, adj)

    // ── Fan-in counts ──────────────────────────────────────────────────
    const fanIn = new Map<string, number>()
    for (const n of nodes) fanIn.set(n, 0)
    for (const e of edges) {
      fanIn.set(e.resolved_file, (fanIn.get(e.resolved_file) ?? 0) + 1)
    }

    // Update import_count / imported_by_count on nodes
    const fanOut = new Map<string, number>()
    for (const e of edges) {
      fanOut.set(e.from_file, (fanOut.get(e.from_file) ?? 0) + 1)
    }

    const updateNode = this.db.prepare<[number, number, string]>(
      'UPDATE ucg_file_nodes SET import_count = ?, imported_by_count = ? WHERE file_path = ?'
    )
    const updateBatch = this.db.transaction(() => {
      for (const n of nodes) {
        updateNode.run(fanOut.get(n) ?? 0, fanIn.get(n) ?? 0, n)
      }
    })
    updateBatch()

    // ── Hot files: top 10 by fan-in ────────────────────────────────────
    const hotFiles = [...fanIn.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([f]) => f)

    // ── External deps histogram ────────────────────────────────────────
    const extRows = this.db
      .prepare<[], { to_module: string }>(
        'SELECT to_module FROM ucg_import_edges WHERE is_external = 1'
      )
      .all()
    const externalDeps: Record<string, number> = {}
    for (const r of extRows) {
      // npm package name = first segment of module specifier
      const pkg = r.to_module.startsWith('@') ?
        r.to_module.split('/').slice(0, 2).join('/') :
        r.to_module.split('/')[0]!
      externalDeps[pkg] = (externalDeps[pkg] ?? 0) + 1
    }

    // ── Entry points ────────────────────────────────────────────────────
    const entryCount = nodes.filter(n => (fanIn.get(n) ?? 0) === 0 &&
                                         (fanOut.get(n) ?? 0) > 0).length

    // ── Persist metrics ─────────────────────────────────────────────────
    this.db.prepare(`
      INSERT INTO ucg_graph_metrics
        (id, total_nodes, total_edges, entry_count, cycle_count,
         cycles_json, hot_files_json, external_deps_json, computed_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        total_nodes = excluded.total_nodes, total_edges = excluded.total_edges,
        entry_count = excluded.entry_count, cycle_count = excluded.cycle_count,
        cycles_json = excluded.cycles_json, hot_files_json = excluded.hot_files_json,
        external_deps_json = excluded.external_deps_json, computed_at = excluded.computed_at
    `).run(
      nodes.length, edges.length, entryCount, cycles.length,
      JSON.stringify(cycles), JSON.stringify(hotFiles),
      JSON.stringify(externalDeps), Date.now()
    )
  }

  /**
   * Iterative Tarjan SCC — avoids call-stack overflow on large repos.
   * Returns only SCCs of size ≥ 2 (actual cycles).
   */
  private tarjanIterative(nodes: string[], adj: Map<string, string[]>): string[][] {
    const index   = new Map<string, number>()
    const lowlink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const SCCs: string[][] = []
    let counter = 0

    // Iterative DFS using explicit stack frames
    for (const root of nodes) {
      if (index.has(root)) continue

      // Frame: [node, iteratorIndex, children]
      const callStack: [string, number, string[]][] = [[root, 0, adj.get(root) ?? []]]
      index.set(root, counter)
      lowlink.set(root, counter)
      counter++
      stack.push(root)
      onStack.add(root)

      while (callStack.length > 0) {
        const frame = callStack[callStack.length - 1]!
        const [v, childIdx, children] = frame

        if (childIdx < children.length) {
          frame[1]++   // advance iterator
          const w = children[childIdx]!
          if (!index.has(w)) {
            const wChildren = adj.get(w) ?? []
            index.set(w, counter)
            lowlink.set(w, counter)
            counter++
            stack.push(w)
            onStack.add(w)
            callStack.push([w, 0, wChildren])
          } else if (onStack.has(w)) {
            lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!))
          }
        } else {
          callStack.pop()
          if (callStack.length > 0) {
            const parent = callStack[callStack.length - 1]![0]
            lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(v)!))
          }
          if (lowlink.get(v) === index.get(v)) {
            const scc: string[] = []
            let w: string
            do {
              w = stack.pop()!
              onStack.delete(w)
              scc.push(w)
            } while (w !== v)
            if (scc.length > 1) SCCs.push(scc)
          }
        }
      }
    }

    return SCCs
  }
}
```

### 8.7 `commandDetector.ts` — Build/Test/Lint Command Detection

```typescript
// packages/main/src/indexer/commandDetector.ts
import fs from 'node:fs'
import path from 'node:path'
import type { CommandEntry } from '@shared/index'

export class CommandDetector {
  constructor(private readonly root: string) {}

  async detect(): Promise<CommandEntry[]> {
    const commands: CommandEntry[] = []

    // ── package.json scripts ──────────────────────────────────────────────
    const pkgPath = path.join(this.root, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          scripts?: Record<string, string>
        }
        for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
          const purpose = this.classifyScript(name, cmd)
          if (purpose) {
            commands.push({ command: `npm run ${name}`, purpose, confidence: 'high', source: 'package.json' })
          }
        }
      } catch { /* invalid JSON */ }
    }

    // ── Makefile targets ──────────────────────────────────────────────────
    const makePath = path.join(this.root, 'Makefile')
    if (fs.existsSync(makePath)) {
      const content = fs.readFileSync(makePath, 'utf8')
      const targets = content.match(/^([a-zA-Z_-]+):/gm) ?? []
      for (const t of targets.map(s => s.slice(0, -1))) {
        const purpose = this.classifyScript(t, '')
        if (purpose) {
          commands.push({ command: `make ${t}`, purpose, confidence: 'medium', source: 'Makefile' })
        }
      }
    }

    // ── Cargo.toml (Rust) ─────────────────────────────────────────────────
    if (fs.existsSync(path.join(this.root, 'Cargo.toml'))) {
      commands.push(
        { command: 'cargo build', purpose: 'build', confidence: 'high', source: 'Cargo.toml' },
        { command: 'cargo test',  purpose: 'test',  confidence: 'high', source: 'Cargo.toml' },
        { command: 'cargo clippy',purpose: 'lint',  confidence: 'high', source: 'Cargo.toml' },
      )
    }

    // ── pom.xml (Maven) ───────────────────────────────────────────────────
    if (fs.existsSync(path.join(this.root, 'pom.xml'))) {
      commands.push(
        { command: 'mvn package', purpose: 'build', confidence: 'high', source: 'pom.xml' },
        { command: 'mvn test',    purpose: 'test',  confidence: 'high', source: 'pom.xml' },
      )
    }

    // ── go.mod ────────────────────────────────────────────────────────────
    if (fs.existsSync(path.join(this.root, 'go.mod'))) {
      commands.push(
        { command: 'go build ./...', purpose: 'build', confidence: 'high', source: 'go.mod' },
        { command: 'go test ./...',  purpose: 'test',  confidence: 'high', source: 'go.mod' },
        { command: 'golangci-lint run', purpose: 'lint', confidence: 'medium', source: 'go.mod' },
      )
    }

    return commands
  }

  private classifyScript(name: string, cmd: string): CommandEntry['purpose'] | null {
    const n = name.toLowerCase(), c = cmd.toLowerCase()
    if (/\btest\b|jest|mocha|pytest|vitest|cypress/.test(n) ||
        /\btest\b|jest|mocha|pytest/.test(c)) return 'test'
    if (/\bbuild\b|compile|bundle/.test(n)) return 'build'
    if (/\blint\b|eslint|pylint|rubocop/.test(n)) return 'lint'
    if (/typecheck|tsc/.test(n) || /tsc --noEmit/.test(c)) return 'typecheck'
    if (/\bstart\b|serve|dev/.test(n)) return 'start'
    if (/format|prettier|black/.test(n)) return 'format'
    return null
  }
}
```

### 8.8 `gitIndexer.ts` — Git Context

```typescript
// packages/main/src/indexer/gitIndexer.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type Database from 'better-sqlite3'

const exec = promisify(execFile)

async function git(args: string[], cwd: string, timeoutMs = 15_000): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: timeoutMs })
    return stdout.trim()
  } catch { return '' }
}

export class GitIndexer {
  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {}

  async index(): Promise<void> {
    const [branch, diffStat, recentlyChanged] = await Promise.all([
      this.getBranch(),
      this.getDiffStat(),
      this.getRecentlyChanged(100),
    ])

    // Persist git_file_stats
    const upsert = this.db.prepare(`
      INSERT INTO git_file_stats(file_path, change_count, last_changed)
      VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        change_count = excluded.change_count,
        last_changed = excluded.last_changed
    `)

    const batch = this.db.transaction((rows: typeof recentlyChanged) => {
      for (const r of rows) {
        upsert.run(r.file, r.changeCount, r.lastChanged)
      }
    })

    batch(recentlyChanged)

    // Store branch + diffStat in workspace_profiles if it exists
    // (profile builder reads from git_file_stats directly)
  }

  async getBranch(): Promise<string> {
    return git(['branch', '--show-current'], this.root)
  }

  async getDiffStat(): Promise<string | null> {
    const out = await git(['diff', 'HEAD', '--stat'], this.root)
    if (!out) return null
    const lines = out.split('\n')
    return lines.length > 20 ?
      lines.slice(0, 20).join('\n') + `\n… (${lines.length - 20} more)` :
      out
  }

  async getRecentlyChanged(limit = 100): Promise<{ file: string; changeCount: number; lastChanged: string }[]> {
    // git log: get file names + dates for last N commits
    const raw = await git([
      'log', '--pretty=format:%ad', '--date=short',
      '--name-only', '--no-merges', `-${limit}`
    ], this.root, 30_000)

    if (!raw) return []

    const fileStats = new Map<string, { count: number; lastDate: string }>()
    let currentDate = ''

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        currentDate = trimmed
      } else if (currentDate) {
        const existing = fileStats.get(trimmed)
        if (existing) {
          existing.count++
          if (trimmed > existing.lastDate) existing.lastDate = currentDate
        } else {
          fileStats.set(trimmed, { count: 1, lastDate: currentDate })
        }
      }
    }

    return [...fileStats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([file, { count, lastDate }]) => ({
        file,
        changeCount: count,
        lastChanged: lastDate,
      }))
  }
}
```

### 8.9 `embeddingService.ts` — LLM Embeddings with Graceful Fallback

```typescript
// packages/main/src/indexer/embeddingService.ts
import type Database from 'better-sqlite3'

const EMBEDDING_BATCH = 20
const EMBEDDING_MODEL  = 'text-embedding-3-small'   // OpenAI-compatible; falls back gracefully

export class EmbeddingService {
  private static instance: EmbeddingService | null = null
  private baseUrl: string
  private apiKey: string
  private available: boolean | null = null  // null = not tested yet

  private constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      // Settings defaults — overridden by settingsStore at runtime
      EmbeddingService.instance = new EmbeddingService(
        'https://api.openai.com', ''
      )
    }
    return EmbeddingService.instance
  }

  static configure(baseUrl: string, apiKey: string) {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService(baseUrl, apiKey)
    } else {
      EmbeddingService.instance.baseUrl = baseUrl
      EmbeddingService.instance.apiKey  = apiKey
      EmbeddingService.instance.available = null  // re-test
    }
  }

  /** Index all chunks that don't yet have an embedding. Returns count embedded. */
  async indexWorkspace(
    db: Database.Database,
    signal: AbortSignal,
    progress: (pct: number) => void,
  ): Promise<number> {
    if (!(await this.checkAvailable())) return 0

    const pending = db
      .prepare<[], { id: string; chunk_text: string }>(
        `SELECT c.id, c.chunk_text FROM code_chunks c
         LEFT JOIN chunk_embeddings ce ON ce.chunk_id = c.id
         WHERE ce.chunk_id IS NULL
         LIMIT 5000`
      )
      .all()

    if (pending.length === 0 || signal.aborted) return 0

    const insert = db.prepare<[string, string, Buffer, number]>(`
      INSERT OR REPLACE INTO chunk_embeddings(chunk_id, model, embedding, created_at)
      VALUES (?, ?, ?, ?)
    `)
    const batchInsert = db.transaction((rows: [string, Buffer][]) => {
      for (const [id, vec] of rows) {
        insert.run(id, EMBEDDING_MODEL, vec, Date.now())
      }
    })

    let done = 0
    for (let i = 0; i < pending.length; i += EMBEDDING_BATCH) {
      if (signal.aborted) break
      const batch = pending.slice(i, i + EMBEDDING_BATCH)
      const texts = batch.map(r => r.chunk_text.slice(0, 2000))  // truncate

      const vecs = await this.embedTexts(texts)
      if (!vecs) { this.available = false; break }

      const rows = batch.map((r, j) => [r.id, this.serialize(vecs[j]!)] as [string, Buffer])
      batchInsert(rows)

      done += batch.length
      progress(Math.round((done / pending.length) * 100))
    }

    return done
  }

  /** Hybrid search: BM25 score (from SQLite) + cosine similarity of query embedding */
  async hybridSearch(
    db: Database.Database,
    query: string,
    maxResults = 10,
  ): Promise<{ filePath: string; startLine: number; endLine: number; snippet: string; score: number }[]> {
    // Always run BM25 first (works without embeddings)
    const bm25 = db.prepare<[string, number], {
      file_path: string; start_line: number; end_line: number;
      chunk_text: string; bm25_score: number
    }>(`
      SELECT c.file_path, c.start_line, c.end_line, c.chunk_text,
             bm25(chunks_fts) AS bm25_score
      FROM chunks_fts
      JOIN code_chunks c ON c.rowid = chunks_fts.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `).all(this.sanitizeFts(query), maxResults * 2)

    if (!this.available) {
      return bm25.slice(0, maxResults).map(r => ({
        filePath: r.file_path, startLine: r.start_line,
        endLine: r.end_line, snippet: r.chunk_text.slice(0, 300),
        score: -r.bm25_score,   // bm25 returns negative; negate for ranking
      }))
    }

    // Embed the query and rerank
    const qVecs = await this.embedTexts([query])
    if (!qVecs) return bm25.slice(0, maxResults).map(r => ({
      filePath: r.file_path, startLine: r.start_line,
      endLine: r.end_line, snippet: r.chunk_text.slice(0, 300),
      score: -r.bm25_score,
    }))

    const qVec = qVecs[0]!

    // Fetch stored embeddings for BM25 candidates
    const ids = bm25.map(r => `'${r.file_path}:${r.start_line}'`)
    const reranked = bm25.map(r => {
      const embRow = db
        .prepare<[string, number], { embedding: Buffer | null }>(
          `SELECT ce.embedding FROM chunk_embeddings ce
           JOIN code_chunks c ON c.id = ce.chunk_id
           WHERE c.file_path = ? AND c.start_line = ? LIMIT 1`
        )
        .get(r.file_path, r.start_line)

      const cosine = embRow?.embedding ?
        this.cosine(qVec, this.deserialize(embRow.embedding)) : 0

      // Hybrid score: 60% cosine + 40% BM25 (normalized)
      const bm25Norm = Math.max(0, 1 + r.bm25_score / 10)
      const score = 0.6 * cosine + 0.4 * bm25Norm

      return {
        filePath: r.file_path, startLine: r.start_line,
        endLine: r.end_line, snippet: r.chunk_text.slice(0, 300), score
      }
    })

    return reranked.sort((a, b) => b.score - a.score).slice(0, maxResults)
  }

  private async checkAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available
    if (!this.apiKey) { this.available = false; return false }
    try {
      const r = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: ['ping'] }),
        signal: AbortSignal.timeout(5000),
      })
      this.available = r.ok
    } catch { this.available = false }
    return this.available
  }

  private async embedTexts(texts: string[]): Promise<number[][] | null> {
    if (!this.apiKey) return null
    try {
      const r = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!r.ok) return null
      const json = await r.json() as { data: { embedding: number[] }[] }
      return json.data.map(d => d.embedding)
    } catch { return null }
  }

  serialize(vec: number[]): Buffer {
    const buf = Buffer.allocUnsafe(vec.length * 4)
    for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i]!, i * 4)
    return buf
  }

  deserialize(buf: Buffer): number[] {
    const vec = new Array<number>(buf.length / 4)
    for (let i = 0; i < vec.length; i++) vec[i] = buf.readFloatLE(i * 4)
    return vec
  }

  cosine(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    return denom === 0 ? 0 : dot / denom
  }

  private sanitizeFts(q: string): string {
    // Escape FTS5 special chars
    return q.replace(/['"*()]/g, ' ').trim() + '*'
  }
}
```

### 8.10 `fileWatcher.ts` — Incremental Re-index

```typescript
// packages/main/src/indexer/fileWatcher.ts
import path from 'node:path'
import chokidar, { FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { WorkspaceScanner } from './workspaceScanner'
import { CodeChunker } from './codeChunker'
import { SymbolExtractor } from './symbolExtractor'
import { ImportExtractor } from './importExtractor'

const DEBOUNCE_MS = 1_500   // batch rapid saves (e.g., IDE auto-save on format)

export class FileWatcher {
  private watcher: FSWatcher | null = null
  private pendingPaths = new Set<string>()
  private debounceTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
    private readonly win: BrowserWindow,
  ) {}

  start(): void {
    if (this.watcher) return

    this.watcher = chokidar.watch(this.root, {
      ignored: [
        /[/\\]node_modules[/\\]/,
        /[/\\]\.git[/\\]/,
        /[/\\]\.riaf[/\\]/,
        /[/\\]dist[/\\]/,
        /[/\\]out[/\\]/,
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      usePolling: process.platform === 'win32',  // NTFS reliability
    })

    const schedule = (filePath: string) => {
      this.pendingPaths.add(filePath)
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => this.flushPending(), DEBOUNCE_MS)
    }

    this.watcher
      .on('add',    filePath => schedule(filePath))
      .on('change', filePath => schedule(filePath))
      .on('unlink', filePath => this.removeFile(filePath))
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }

  private async flushPending(): Promise<void> {
    const paths = [...this.pendingPaths]
    this.pendingPaths.clear()

    const dummy: AbortSignal = { aborted: false } as AbortSignal
    const scanner  = new WorkspaceScanner(this.root, this.db)
    const chunker  = new CodeChunker(this.db)
    const extractor = new SymbolExtractor(this.db)
    const importer  = new ImportExtractor(this.db, this.root)

    // Re-scan only the changed files
    // (Scanner's upsert handles new/modified; deletion is handled by removeFile)
    const scanned = await scanner.scan(dummy)
    const changed = scanned.filter(f => paths.includes(path.join(this.root, f.relativePath)))

    if (changed.length === 0) return

    await chunker.chunkAll(changed, dummy, () => {})
    await extractor.extractAll(changed, dummy, () => {})
    await importer.extractAll(changed, dummy, () => {})

    // Notify renderer that index was updated
    this.win.webContents.send('indexer:incrementalUpdate',
      changed.map(f => f.relativePath))
  }

  private removeFile(absolutePath: string): void {
    const relative = path.relative(this.root, absolutePath).replace(/\\/g, '/')
    const fileRow = this.db
      .prepare<[string], { id: number }>(
        'SELECT id FROM file_metadata WHERE file_path = ?'
      )
      .get(relative)

    if (fileRow) {
      // Cascade deletes chunks, symbols, ucg nodes via FK
      this.db.prepare('DELETE FROM file_metadata WHERE id = ?').run(fileRow.id)
      this.db.prepare('DELETE FROM ucg_file_nodes WHERE file_path = ?').run(relative)
      this.db.prepare('DELETE FROM ucg_import_edges WHERE from_file = ?').run(relative)
    }
  }
}
```

---

## 9. Workspace Profile Builder

```typescript
// packages/main/src/indexer/profileBuilder.ts
import type Database from 'better-sqlite3'
import type { WorkspaceProfile, CommandEntry, FrameworkEntry } from '@shared/index'
import type { ScannedFile } from './workspaceScanner'

// Common framework detection: package.json / config files
const FRAMEWORK_SIGNALS: { name: string; signals: (string | RegExp)[] }[] = [
  { name: 'React',       signals: ['react', 'react-dom'] },
  { name: 'Next.js',     signals: ['next', /next\.config\./] },
  { name: 'Vue',         signals: ['vue', '@vue/core'] },
  { name: 'Angular',     signals: ['@angular/core'] },
  { name: 'Svelte',      signals: ['svelte'] },
  { name: 'Express',     signals: ['express'] },
  { name: 'Fastify',     signals: ['fastify'] },
  { name: 'NestJS',      signals: ['@nestjs/core'] },
  { name: 'Spring Boot', signals: [/spring-boot/] },
  { name: 'Django',      signals: [/django/i] },
  { name: 'FastAPI',     signals: [/fastapi/i] },
  { name: 'Gin',         signals: [/github\.com\/gin-gonic/] },
  { name: 'Electron',    signals: ['electron'] },
]

export class WorkspaceProfileBuilder {
  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRoot: string,
  ) {}

  buildAndSave(files: ScannedFile[], commands: CommandEntry[]): WorkspaceProfile {
    // Language stack from file_metadata
    const langRows = this.db
      .prepare<[], { language: string; cnt: number }>(
        'SELECT language, COUNT(*) as cnt FROM file_metadata WHERE language != "unknown" GROUP BY language ORDER BY cnt DESC'
      )
      .all()
    const languageStack = langRows.slice(0, 8).map(r => r.language)

    // LoC count
    const totalLoc = files.reduce((sum, f) => {
      // Rough estimate: sizeBytes / 40 (avg line length)
      return sum + Math.round(f.sizeBytes / 40)
    }, 0)

    // Framework detection from package.json deps
    const frameworks = this.detectFrameworks()

    // Package managers
    const packageManagers = this.detectPackageManagers()

    // Hot files as architectureSummary hint
    const metricsRow = this.db
      .prepare<[], { hot_files_json: string; cycle_count: number; total_nodes: number }>
        ('SELECT hot_files_json, cycle_count, total_nodes FROM ucg_graph_metrics WHERE id = 1')
      .get()

    const hotFiles: string[] = metricsRow ? JSON.parse(metricsRow.hot_files_json) : []

    const architectureSummary = hotFiles.length > 0 ?
      `Top entry points by fan-in: ${hotFiles.slice(0, 5).join(', ')}. ` +
      `${metricsRow?.cycle_count ?? 0} import cycles detected.` : null

    const profile: WorkspaceProfile = {
      workspaceRoot:       this.workspaceRoot,
      lastScannedAt:       Date.now(),
      languageStack,
      frameworks,
      packageManagers,
      buildCommands:       commands.filter(c => c.purpose === 'build'),
      testCommands:        commands.filter(c => c.purpose === 'test'),
      lintCommands:        commands.filter(c => c.purpose === 'lint'),
      fileCount:           files.length,
      totalLoc,
      projectPurpose:      null,   // filled by RIAF agent
      architectureSummary,
      isStale:             false,
    }

    // Persist
    this.db.prepare(`
      INSERT INTO workspace_profiles(
        id, workspace_root, last_scanned_at, language_stack_json,
        frameworks_json, package_managers_json, build_commands_json,
        test_commands_json, lint_commands_json, file_count, total_loc,
        project_purpose, architecture_summary
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_root = excluded.workspace_root,
        last_scanned_at = excluded.last_scanned_at,
        language_stack_json = excluded.language_stack_json,
        frameworks_json = excluded.frameworks_json,
        package_managers_json = excluded.package_managers_json,
        build_commands_json = excluded.build_commands_json,
        test_commands_json = excluded.test_commands_json,
        lint_commands_json = excluded.lint_commands_json,
        file_count = excluded.file_count,
        total_loc = excluded.total_loc,
        architecture_summary = excluded.architecture_summary
    `).run(
      this.workspaceRoot,
      Date.now(),
      JSON.stringify(languageStack),
      JSON.stringify(frameworks),
      JSON.stringify(packageManagers),
      JSON.stringify(profile.buildCommands),
      JSON.stringify(profile.testCommands),
      JSON.stringify(profile.lintCommands),
      files.length,
      totalLoc,
      null,
      architectureSummary,
    )

    return profile
  }

  private detectFrameworks(): FrameworkEntry[] {
    const pkgPath = require('node:path').join(this.workspaceRoot, 'package.json')
    if (!require('node:fs').existsSync(pkgPath)) return []

    try {
      const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
      const result: FrameworkEntry[] = []

      for (const { name, signals } of FRAMEWORK_SIGNALS) {
        for (const signal of signals) {
          const matched = typeof signal === 'string' ?
            signal in allDeps :
            Object.keys(allDeps).some(d => signal.test(d))
          if (matched) {
            const version = typeof signal === 'string' ? (allDeps[signal] ?? null) : null
            result.push({ name, version, confidence: 'high' })
            break
          }
        }
      }
      return result
    } catch { return [] }
  }

  private detectPackageManagers(): string[] {
    const fs = require('node:fs')
    const path = require('node:path')
    const managers: string[] = []
    if (fs.existsSync(path.join(this.workspaceRoot, 'pnpm-lock.yaml')))   managers.push('pnpm')
    if (fs.existsSync(path.join(this.workspaceRoot, 'yarn.lock')))         managers.push('yarn')
    if (fs.existsSync(path.join(this.workspaceRoot, 'package-lock.json'))) managers.push('npm')
    if (fs.existsSync(path.join(this.workspaceRoot, 'bun.lockb')))         managers.push('bun')
    if (fs.existsSync(path.join(this.workspaceRoot, 'Cargo.lock')))        managers.push('cargo')
    if (fs.existsSync(path.join(this.workspaceRoot, 'go.sum')))            managers.push('go mod')
    return managers
  }
}
```

---

*Part 1 ends here. Part 2 covers: LLM Provider Layer, RIAF Agent, IPC Handler Registration, React UI, Settings, Cross-Platform Packaging, and the ISS extensibility contract.*
