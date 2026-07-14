# odyssey

## 1. What This Repository Does

RIAF Studio is a cross-platform Electron desktop application that opens a local code repository, runs a multi-stage indexing pipeline, and provides deep structural intelligence about the codebase. It targets software developers and architects who need instant, ranked search across a repo (FTS5 full-text + optional embedding-based hybrid retrieval), a visual Universal Context Graph (UCG) showing file-level import relationships with cycle detection and hot-file ranking, and an LLM agent that autonomously investigates the indexed data and writes a structured 12-section `*_context.md` repository-context document. The application supports Anthropic Claude, OpenAI, Ollama, LM Studio, and any OpenAI-compatible endpoint as LLM backends. A future ISS (Intent-Semantic-Structure) Graph layer is designed in from day one via stub tables and plugin hooks, with zero schema-breaking changes required to activate it.

---

## 2. Architecture Overview

RIAF Studio follows the **standard three-process Electron architecture** with a strict layered monorepo:

```
┌─────────────────────────────────────────────────────────┐
│  MAIN PROCESS  (packages/main)  — Node.js               │
│  • Workspace lifecycle (openWorkspace / teardown)        │
│  • IndexingPipeline (10 sequential stages)               │
│  • FileWatcher (chokidar, incremental re-index)          │
│  • RiafController (LLM agent loop, tool execution)       │
│  • SQLite DB (better-sqlite3, .riaf/riaf.db)             │
│  • SettingsStore (electron-store JSON)                   │
│  • IPC handlers (ipcMain.handle for all channels)        │
└──────────────────┬──────────────────────────────────────┘
                   │  ipcMain.handle (invoke) / webContents.send (push)
┌──────────────────┴──────────────────────────────────────┐
│  PRELOAD  (packages/preload)                             │
│  • contextBridge → window.electronAPI                    │
│  • Typed, no business logic; pure IPC routing            │
└──────────────────┬──────────────────────────────────────┘
                   │  window.electronAPI.*
┌──────────────────┴──────────────────────────────────────┐
│  RENDERER  (packages/renderer)  — React 18 + Tailwind   │
│  • 7 panels: Workspace, Indexing, UCG, Search,           │
│    Symbols, RIAF, Settings                               │
│  • Zustand stores: workspace / indexing / riaf           │
└─────────────────────────────────────────────────────────┘

packages/shared  — IPC channel constants + shared TypeScript types
                   (consumed by all three processes)
```

The architecture is **event-driven at the process boundary** (IPC push events for progress and streaming) and **synchronous/transactional within the main process** (better-sqlite3 synchronous API, SQLite transactions for batch writes). There are **zero import cycles** across the 81 indexed files.

---

## 3. File Responsibility Map

### Monorepo root (`riaf-studio/`)

| Path | Responsibility |
|---|---|
| `package.json` | Root scripts: `dev`, `build`, `test`, `package`, `make`; pins Node 20–22, pnpm 9 |
| `electron.vite.config.ts` | Three-entrypoint Vite build (main/preload/renderer); path aliases `@shared`, `@/` |
| `vitest.config.ts` | Test runner config; targets `packages/main/src/**/*.test.ts`; node environment |
| `forge.config.ts` | Electron Forge packaging; DMG (macOS), Squirrel (Windows), ZIP makers |
| `pnpm-workspace.yaml` | Declares `packages/*` as workspace members |

### `packages/shared/src/`

| File | Responsibility |
|---|---|
| `ipc.channels.ts` | Single source of truth for all IPC channel name strings (`IPC` const + `IpcChannel` type) |
| `db.types.ts` | Shared row types: `FileMetadataRow`, `CodeChunkRow`, `ExtractedSymbol`, `UCGFileNode`, etc. |
| `riaf.types.ts` | `RiafConfig`, `RiafRunState`, `RiafStreamChunk`, `RiafIndexSnapshot` |
| `indexer.types.ts` | `IndexingStage`, `IndexingStatus`, `WorkspaceProfile`, `CommandEntry` |
| `iss.types.ts` | ISS Graph stub types (`GraphNode`, `GraphEdge`, `FeatureTrace`) |
| `index.ts` | Re-exports all shared types |

### `packages/main/src/`

| File/Dir | Responsibility |
|---|---|
| `index.ts` | Electron app entry; creates `BrowserWindow`, calls `registerIpcHandlers()`, manages module-level workspace state singletons |
| `ipcHandlers.ts` | Registers all `ipcMain.handle` handlers for every IPC channel; maps DB rows to typed responses |
| `workspaceSession.ts` | Monotonic session counter (`bumpWorkspaceSession`) to detect stale async callbacks |
| `settingsStore.ts` | `electron-store` singleton; typed `AppSettings`; `getSetting`/`setSetting`/`addRecentWorkspace` |
| `db/db.ts` | Opens/closes the per-workspace `better-sqlite3` DB at `.riaf/riaf.db`; `initDb`, `closeDb`, `initMemoryDb` |
| `db/schema.ts` | Full SQLite schema V1: 12 tables including FTS5 virtual tables, triggers, ISS stub tables |
| `db/migrations.ts` | Version-gated migration runner; handles legacy schema_version table shape |
| `indexer/indexingPipeline.ts` | Orchestrates 10 sequential stages; `AbortController` cancellation; progress broadcast; post-index hooks |
| `indexer/workspaceScanner.ts` | `fast-glob` + `ignore` file discovery; upserts `file_metadata`; language detection; content hashing |
| `indexer/codeChunker.ts` | Splits files into `function`/`class`/`block`/`file` chunks (≤80 lines); writes `code_chunks` |
| `indexer/symbolExtractor.ts` | Regex-based symbol extraction for TS/JS/Python/Java/Go/Rust; writes `symbols` |
| `indexer/importExtractor.ts` | Regex-based import edge extraction for 6 languages; resolves relative paths; writes `ucg_import_edges` |
| `indexer/nodeClassifier.ts` | Classifies UCG nodes by arch layer and node type via path-pattern rules; writes `ucg_file_nodes` |
| `indexer/graphAnalyzer.ts` | Tarjan SCC cycle detection; fan-in/fan-out counts; hot files; external dep aggregation; writes `ucg_graph_metrics` |
| `indexer/commandDetector.ts` | Heuristic detection of build/test/lint commands from `package.json`, `Makefile`, etc. |
| `indexer/gitIndexer.ts` | Runs `git log` to populate `git_file_stats` (change counts per file); branch detection |
| `indexer/embeddingService.ts` | Singleton; batches code chunks to OpenAI-compat `/v1/embeddings`; stores BLOB vectors; RRF hybrid search |
| `indexer/profileBuilder.ts` | Detects frameworks, package managers, LOC; writes `workspace_profiles` singleton row |
| `indexer/fileWatcher.ts` | `chokidar` watcher with 1500 ms debounce; incremental re-chunk/re-symbol/re-import on file change |
| `llm/llmProvider.interface.ts` | `ILLMProvider` interface: `complete()` + `stream()` async generator |
| `llm/anthropicProvider.ts` | Anthropic SDK implementation of `ILLMProvider` |
| `llm/openAICompatProvider.ts` | OpenAI-compatible REST implementation (covers OpenAI, Ollama, LM Studio, custom) |
| `llm/contextAssembler.ts` | Builds `RiafIndexSnapshot` from DB; constructs RIAF system prompt |
| `llm/toolRunner.ts` | Agent loop (max 40 iterations); streams tool calls; calls `executeTool`; requests final synthesis |
| `riaf/riafController.ts` | Manages RIAF run state machine; selects provider; wires snapshot → prompt → agent loop → file write |
| `riaf/riafTools.ts` | Defines 9 RIAF tools (`read_file`, `search_codebase`, `search_symbols`, `get_file_outline`, `get_import_graph`, `get_tests_for_file`, `get_ucg_metrics`, `ls_dir`, `get_recently_changed`); plugin registry |
| `riaf/riafPrompts.ts` | Builds the 12-section user message template injected into the LLM |

### `packages/preload/src/`

| File | Responsibility |
|---|---|
| `preload.ts` | `contextBridge.exposeInMainWorld('electronAPI', api)` — typed surface for all IPC invoke + event subscriptions |

### `packages/renderer/src/`

| Path | Responsibility |
|---|---|
| `main.tsx` | React root mount |
| `App.tsx` | Top-level layout; wires all IPC event listeners to Zustand stores; keyboard shortcuts |
| `components/Sidebar.tsx` | Icon navigation bar; 7 panel buttons; disables non-workspace panels when no repo open |
| `store/workspace.store.ts` | Zustand: `root`, `profile`, `recentWorkspaces` |
| `store/indexing.store.ts` | Zustand + Immer: per-stage status, progress %, error |
| `store/riaf.store.ts` | Zustand + Immer: `runState`, `streamBuffer` |
| `panels/WorkspacePanel/` | Open/recent workspace UI |
| `panels/IndexingPanel/` | Stage progress display; re-index trigger |
| `panels/UCGGraphPanel/` | ReactFlow import graph visualization |
| `panels/SearchPanel/` | FTS + hybrid search UI |
| `panels/SymbolBrowserPanel/` | Symbol search and browse |
| `panels/RiafPanel/` | RIAF config, run trigger, streaming output display |
| `panels/SettingsPanel/` | LLM provider/key/model + embedding config |

---

## 4. Module Wiring

### Main process dependency chain

```
index.ts
  ├── db/db.ts  ──→  db/migrations.ts  ──→  db/schema.ts
  ├── settingsStore.ts  (electron-store)
  ├── indexer/indexingPipeline.ts
  │     ├── workspaceScanner → codeChunker → symbolExtractor
  │     ├── importExtractor → nodeClassifier → graphAnalyzer
  │     ├── commandDetector → gitIndexer → embeddingService
  │     └── profileBuilder
  ├── indexer/fileWatcher.ts  (chokidar; reuses chunker/symbol/import)
  ├── riaf/riafController.ts
  │     ├── settingsStore  (provider selection)
  │     ├── llm/anthropicProvider  |  llm/openAICompatProvider
  │     ├── llm/contextAssembler  (DB → RiafIndexSnapshot)
  │     ├── riaf/riafPrompts  (user message template)
  │     └── llm/toolRunner  ──→  riaf/riafTools  (9 tools + plugin registry)
  └── ipcHandlers.ts
        ├── db/db.ts  (getDb)
        ├── settingsStore.ts
        └── indexer/embeddingService.ts  (hybrid search)
```

### IPC event flow (push, main → renderer)

| Event | Trigger | Renderer handler |
|---|---|---|
| `workspace:changed` | `openWorkspace()` | `App.tsx` → resets stores, navigates to Indexing panel |
| `indexer:progress` | Each pipeline stage | `useIndexingStore.applyProgress()` |
| `indexer:complete` | Pipeline done | `useIndexingStore`, then `getProfile()` fetch |
| `riaf:streamChunk` | LLM token delta | `useRiafStore.appendChunk()` |
| `riaf:stateChange` | State machine transition | `useRiafStore.setRunState()` |

### No dependency injection framework is used. Modules are wired by direct ESM imports. The `EmbeddingService` uses a singleton pattern (`EmbeddingService.instance`). The `SettingsStore` uses a lazy-initialized singleton (`getStore()`). There are **0 import cycles**.

---

## 5. External Dependencies

| Library | Version | Purpose | Consumed by |
|---|---|---|---|
| `better-sqlite3` | (devDep, rebuilt) | Synchronous SQLite driver | `db/db.ts`, all indexer classes, `ipcHandlers.ts` |
| `electron` | ^31.0.0 | Desktop app shell | `index.ts`, `ipcHandlers.ts`, `fileWatcher.ts`, `toolRunner.ts` |
| `electron-store` | — | Typed JSON settings persistence in userData | `settingsStore.ts` |
| `@anthropic-ai/sdk` | — | Anthropic Claude API client | `llm/anthropicProvider.ts` |
| `chokidar` | — | Cross-platform file watching | `indexer/fileWatcher.ts` |
| `fast-glob` | — | High-performance file discovery | `indexer/workspaceScanner.ts` |
| `ignore` | — | `.gitignore` rule parsing | `workspaceScanner.ts`, `fileWatcher.ts` |
| `react` | 18 | UI framework | All renderer files |
| `zustand` | — | Renderer state management | `store/*.store.ts` |
| `zustand/middleware/immer` | — | Immer-backed Zustand mutations | `indexing.store.ts`, `riaf.store.ts` |
| `reactflow` | — | UCG graph visualization | `panels/UCGGraphPanel/` |
| `lucide-react` | — | Icon set | `components/Sidebar.tsx` |
| `clsx` | — | Conditional className utility | `components/Sidebar.tsx` |
| `tailwindcss` | — | Utility CSS | Renderer styles |
| `electron-vite` | ^2.3.0 | Three-entrypoint Vite build with HMR | Build tooling |
| `@electron-forge/*` | ^7.4.0 | Packaging and installer creation | `forge.config.ts` |
| `@electron/rebuild` | ^3.6.0 | Rebuilds native modules for Electron ABI | `scripts/setup-native-modules.cjs` |
| `vitest` | ^2.0.0 | Unit test runner | `packages/main/src/__tests__/` |
| `typescript` | ^5.5.0 | Type checking and compilation | All packages |
| `@vitejs/plugin-react` | ^4.3.0 | React fast-refresh in renderer | `electron.vite.config.ts` |

---

## 6. Entry Points

### Application entry points

| Entry | File | Description |
|---|---|---|
| Electron main | `packages/main/src/index.ts` | `app.whenReady()` → `createWindow()` + `registerIpcHandlers()` |
| Preload bridge | `packages/preload/src/preload.ts` | `contextBridge.exposeInMainWorld('electronAPI', api)` |
| Renderer root | `packages/renderer/src/main.tsx` | React `createRoot` mount |

### IPC invoke handlers (user-triggered)

| Channel | Handler in `ipcHandlers.ts` | Action |
|---|---|---|
| `workspace:open` | `registerIpcHandlers` | Opens folder dialog or uses provided path; calls `openWorkspace()` |
| `workspace:reopen` | — | Re-opens with optional `replaceIndex` flag |
| `workspace:close` | — | Calls `teardownWorkspace()` |
| `indexer:start` | — | Calls `pipeline.run()` |
| `indexer:abort` | — | Calls `pipeline.abort()` |
| `search:codebase` | — | FTS5 query on `chunks_fts` |
| `search:codebaseHybrid` | — | RRF fusion of FTS + vector search |
| `search:symbols` | — | FTS5 query on `symbols_fts` |
| `ucg:getGraph` | — | Returns all nodes + edges from `ucg_file_nodes` / `ucg_import_edges` |
| `ucg:getMetrics` | — | Returns singleton `ucg_graph_metrics` row |
| `riaf:start` | — | Calls `riafController.start(config)` |
| `riaf:abort` | — | Calls `riafController.abort()` |
| `settings:get` / `settings:set` | — | Read/write `electron-store` |
| `iss:*` (6 channels) | — | Stub: returns `{ error: 'ISS Graph not yet implemented' }` |

### Keyboard shortcuts (renderer)

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+O` | Navigate to Workspace panel |
| `Cmd/Ctrl+R` | Trigger re-index (if workspace open) |

---

## 7. Key Patterns & Conventions

### Naming conventions
- Classes use `PascalCase` (`IndexingPipeline`, `WorkspaceScanner`, `RiafController`).
- IPC channel strings are namespaced `domain:action` (e.g. `workspace:open`, `riaf:start`) and centralized in `ipc.channels.ts`.
- Zustand stores are named `use<Domain>Store` and live in `renderer/src/store/`.
- Test files are co-located in `__tests__/` and named `<module>.test.ts`.

### Async model
- Main process uses `async/await` throughout. Long-running operations (`IndexingPipeline.run()`, `RiafController.start()`) are wrapped in `AbortController` for cancellation. The `signal.aborted` guard is checked after every async stage boundary.
- `better-sqlite3` is synchronous by design; all DB writes happen on the main thread without callbacks.
- Streaming LLM output uses `AsyncGenerator<StreamEvent>` from `ILLMProvider.stream()`, forwarded token-by-token to the renderer via `webContents.send(IPC.RIAF_STREAM_CHUNK, chunk)`.

### Error handling
- Pipeline errors are caught in `IndexingPipeline.run()` and broadcast as `indexer:error` IPC events; non-fatal stage errors (FTS optimize, post-index hooks) are caught locally and logged.
- `RiafController` catches all errors and transitions state to `{ status: 'error', message }`, broadcasting via `riaf:stateChange`.
- Git operations (`GitIndexer`) silently skip if git is unavailable.
- IPC handlers return `{ error: string }` discriminated union on failure rather than throwing.

### Data validation
- No runtime schema validation (e.g. Zod) is applied to IPC payloads in the current implementation (Zod was listed as a design goal in the implementation plan but is not present in the actual code). TypeScript types provide compile-time safety.

### Singleton pattern
- `EmbeddingService.instance` — lazy static singleton, configured once at app startup from settings.
- `getStore()` — lazy `electron-store` singleton.

### ISS extensibility hooks
- `registerToolPlugin(plugin: ToolPlugin)` — adds LLM tools without modifying core tool list.
- `registerPostIndexHook(hook: PostIndexHook)` — runs after every full index; ISS Phase 1 will register here.

---

## 8. Implementation Cookbook

### Recipe 1: Add a new IPC channel

1. **Add the channel name** to `packages/shared/src/ipc.channels.ts`:
   ```typescript
   MY_NEW_CHANNEL: 'myDomain:myAction',
   ```
2. **Register the handler** in `packages/main/src/ipcHandlers.ts` inside `registerIpcHandlers()`:
   ```typescript
   ipcMain.handle(IPC.MY_NEW_CHANNEL, async (_e, arg: string) => {
     const db = getDb()
     if (!db) return { error: 'No workspace open' }
     // ... query db or call service
     return { result: 'ok' }
   })
   ```
3. **Expose it in the preload** at `packages/preload/src/preload.ts`:
   ```typescript
   myNewAction: (arg: string) =>
     ipcRenderer.invoke('myDomain:myAction', arg) as Promise<{ result: string } | { error: string }>,
   ```
4. **Call it from the renderer** via `window.electronAPI.myNewAction(arg)`.

---

### Recipe 2: Add a new indexing stage

1. **Add the stage name** to `IndexingStage` in `packages/shared/src/indexer.types.ts`.
2. **Add a progress range** in `STAGE_RANGES` in `indexingPipeline.ts`:
   ```typescript
   myStage: [95, 98],
   ```
3. **Implement the stage class** in `packages/main/src/indexer/myStage.ts` following the pattern of existing classes (constructor takes `db` + `workspaceRoot`; synchronous or async method; checks `signal.aborted`).
4. **Wire it** in `IndexingPipeline.execute()`:
   ```typescript
   this.sendProgress('myStage', 0, 'Running my stage…')
   const myStage = new MyStage(this.db, this.workspaceRoot)
   await myStage.run(files, signal)
   if (signal.aborted) return
   this.sendProgress('myStage', 100, 'My stage done')
   ```
5. **Add the stage** to `ALL_STAGES` in `renderer/src/store/indexing.store.ts` so the UI tracks it.

---

### Recipe 3: Add a new LLM provider

1. **Add the provider key** to `AppSettings.llmProvider` union in `settingsStore.ts`.
2. **Create the provider class** in `packages/main/src/llm/myProvider.ts` implementing `ILLMProvider`:
   ```typescript
   export class MyProvider implements ILLMProvider {
     async complete(req: LLMRequest): Promise<LLMMessage> { ... }
     async *stream(req: LLMRequest): AsyncGenerator<StreamEvent> { ... }
   }
   ```
3. **Register it** in the `buildProvider()` switch in `riaf/riafController.ts`:
   ```typescript
   case 'myprovider':
     return new MyProvider(getSetting('myProviderApiKey'))
   ```
4. **Add settings fields** to `AppSettings` and `DEFAULTS` in `settingsStore.ts`, and expose them in `SettingsPanel`.

---

### Recipe 4: Register an ISS tool plugin

1. **Import the registry** in your ISS module:
   ```typescript
   import { registerToolPlugin } from '../riaf/riafTools'
   import { registerPostIndexHook } from '../indexer/indexingPipeline'
   ```
2. **Register the tool** (called once at startup or after indexing):
   ```typescript
   registerToolPlugin({
     tool: {
       name: 'trace_feature_to_code',
       description: 'Trace a feature label to implementing code nodes',
       input_schema: { type: 'object', properties: { feature: { type: 'string' } }, required: ['feature'] },
     },
     execute: async (input, db, workspaceRoot) => {
       // query graph_nodes / feature_traces tables
       return `Found: ...`
     },
   })
   ```
3. **Register a post-index hook** to populate ISS tables after each full index:
   ```typescript
   registerPostIndexHook(async (db, root) => {
     // populate graph_nodes, graph_edges, feature_traces
   })
   ```

---

## 9. Configuration

### Settings (persisted via `electron-store` in OS `userData`)

All settings are typed in `AppSettings` (`settingsStore.ts`). Defaults are:

| Key | Default | Purpose |
|---|---|---|
| `llmProvider` | `'anthropic'` | Active LLM backend |
| `anthropicApiKey` | `''` | Anthropic API key |
| `openaiApiKey` | `''` | OpenAI API key |
| `ollamaBaseUrl` | `'http://localhost:11434'` | Ollama base URL |
| `lmstudioBaseUrl` | `'http://localhost:1234'` | LM Studio base URL |
| `openaiCompatBaseUrl` | `''` | Custom OpenAI-compat base URL |
| `openaiCompatApiKey` | `''` | Custom OpenAI-compat API key |
| `defaultModel` | `'claude-sonnet-4-6'` | Model name forwarded to provider |
| `embeddingBaseUrl` | `'https://api.openai.com'` | Embedding endpoint |
| `embeddingApiKey` | `''` | Embedding API key |
| `embeddingModel` | `'text-embedding-3-small'` | Embedding model |
| `embeddingsEnabled` | `false` | Enable vector indexing + hybrid search |
| `riafMaxFiles` | `150` | Max files the RIAF agent may deep-read |
| `riafIncludeTests` | `false` | Include test files in RIAF analysis |
| `recentWorkspaces` | `[]` | MRU list (capped at 10) |
| `theme` | `'dark'` | UI theme |

### Build-time environment variables

| Variable | Used in | Purpose |
|---|---|---|
| `ELECTRON_RENDERER_URL` | `index.ts:144` | Dev mode: load renderer from Vite dev server URL |
| `process.platform` | `index.ts:127` | macOS `hiddenInset` title bar style |

### Per-workspace database

The SQLite database is stored at `<workspaceRoot>/.riaf/riaf.db`. The `.riaf/` directory is created automatically on first open. Passing `replaceIndex: true` to `workspace:reopen` wipes the entire `.riaf/` directory before re-indexing.

### No `.env` file or secrets management beyond `electron-store` is used. API keys are stored in plain JSON in the OS user data directory.

---

## 10. Testing

**Framework:** Vitest 2 (`vitest.config.ts`), node environment, globals enabled.

**Test location:** `packages/main/src/__tests__/` — 8 test files covering main-process indexer modules only. No renderer tests exist.

**Test helpers:** `helpers.ts` provides `makeTestDb()` (in-memory SQLite with migrations applied) and `seedFile()` for inserting `file_metadata` rows, used by all test files.

**Coverage:**

| Test file | Module under test |
|---|---|
| `codeChunker.test.ts` | `CodeChunker` — boundary detection, overlap, max-line splitting |
| `symbolExtractor.test.ts` | `SymbolExtractor` — TS/JS/Python symbol regex patterns |
| `importExtractor.test.ts` | `ImportExtractor` — ESM/CJS/dynamic import parsing, path resolution |
| `graphAnalyzer.test.ts` | `GraphAnalyzer` — fan-in/fan-out counts, Tarjan SCC cycle detection |
| `nodeClassifier.test.ts` | `NodeClassifier` — arch layer and node type classification rules |
| `commandDetector.test.ts` | `commandDetector` — package.json script heuristics |
| `embeddingService.test.ts` | `EmbeddingService` — RRF fusion, batch logic (mocked HTTP) |
| `issHooks.test.ts` | `registerToolPlugin` / `registerPostIndexHook` extension points |

**Run tests:** `pnpm test` (auto-rebuilds `better-sqlite3` for Node ABI first).

**Gaps:** No tests for `IndexingPipeline` orchestration, `RiafController`, `FileWatcher`, `GitIndexer`, `ProfileBuilder`, or any renderer component.

---

## 11. Known Issues & Technical Debt

### ISS Graph is a stub
Six IPC channels (`iss:*`) return `{ error: 'ISS Graph not yet implemented' }`. The `graph_nodes`, `graph_edges`, and `feature_traces` tables exist in the schema but are never populated in Phase 1 (`ipcHandlers.ts:567–570`).

### No IPC payload validation at runtime
The implementation plan specified Zod validation at the preload boundary, but no Zod dependency is present in any `package.json`. IPC arguments are cast with TypeScript `as` assertions, which provides no runtime safety.

### `services/` and `db/queries/` directories are empty
`packages/main/src/services/` and `packages/main/src/db/queries/` exist as empty directories — scaffolded for future use but currently unused.

### `renderer/src/api/` is empty
The `packages/renderer/src/api/` directory is empty; all renderer-to-main communication goes directly through `window.electronAPI` in component/store code rather than through an abstraction layer.

### API keys stored in plaintext
`electron-store` persists all API keys as plain JSON in the OS user data directory. No encryption or OS keychain integration is implemented.

### Regex-based symbol/import extraction
`SymbolExtractor` and `ImportExtractor` use hand-written regex patterns rather than a proper AST parser (e.g. tree-sitter). This means multi-line constructs, template literals containing import-like strings, and edge cases in non-TypeScript languages may produce false positives or missed extractions.

### Node.js version constraint
The app requires Node 20 LTS specifically. Node 24 lacks prebuilt `better-sqlite3` binaries and will fail. This is documented but is a fragile constraint.

### No renderer tests
Zero test coverage for React components, Zustand stores, or the preload bridge.

### `sandbox: false` in BrowserWindow
`webPreferences.sandbox` is set to `false` (`index.ts:131`), which reduces Chromium sandbox security. This is required for the preload script but is a known Electron security trade-off.

---

## 12. Quick Reference

### Common commands (run from `riaf-studio/`)

| Command | Action |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | Rebuild native modules + start Electron with Vite HMR |
| `pnpm build` | Production build → `out/` |
| `pnpm test` | Rebuild `better-sqlite3` for Node + run Vitest |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm rebuild:node` | Rebuild `better-sqlite3` for Node ABI (needed before Vitest) |
| `pnpm rebuild:electron` | Rebuild `better-sqlite3` for Electron ABI (needed before `pnpm dev`) |
| `pnpm package` | Build + package (no installer) |
| `pnpm make` | Build + create DMG/Squirrel/ZIP installers |

### Key file locations

| What | Where |
|---|---|
| App entry point | `packages/main/src/index.ts` |
| All IPC channel names | `packages/shared/src/ipc.channels.ts` |
| All IPC handlers | `packages/main/src/ipcHandlers.ts` |
| Preload API surface | `packages/preload/src/preload.ts` |
| Settings type + defaults | `packages/main/src/settingsStore.ts` |
| SQLite schema | `packages/main