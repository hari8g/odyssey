// packages/main/src/ipcHandlers.ts
import { ipcMain, dialog, shell } from 'electron'
import { IPC, DEFAULT_RIAF_CONFIG } from '@shared/index'
import type {
  WorkspaceProfile,
  GitFileStats,
  UCGGraphData,
  UCGGraphMetrics,
  UCGFileNode,
  UCGImportEdge,
  CodebaseSearchResult,
  ExtractedSymbol,
  RiafConfig,
  IndexerState,
} from '@shared/index'
import { getDb, closeDb } from './db/db'
import type { AppSettings } from './settingsStore'
import { getSetting, setSetting, clearRecentWorkspaces, removeRecentWorkspace } from './settingsStore'
import { EmbeddingService } from './indexer/embeddingService'
import {
  getOpenWorkspaceRoot,
  getOpenDb,
  getPipeline,
  getWatcher,
  getRiafController,
  openWorkspace,
  startWatcher,
} from './index'

// ─── DB row types ─────────────────────────────────────────────────────────────

type ProfileRow = {
  workspace_root: string
  last_scanned_at: number
  language_stack_json: string
  frameworks_json: string
  package_managers_json: string
  build_commands_json: string
  test_commands_json: string
  lint_commands_json: string
  file_count: number
  total_loc: number
  project_purpose: string | null
  architecture_summary: string | null
}

type UCGNodeRow = {
  id: number
  file_path: string
  language: string
  node_type: string
  arch_layer: string
  is_entry_point: number
  import_count: number
  imported_by_count: number
}

type UCGEdgeRow = {
  id: number
  from_file: string
  to_module: string
  resolved_file: string | null
  is_external: number
  edge_type: string
}

type UCGMetricsRow = {
  total_nodes: number
  total_edges: number
  entry_count: number
  cycle_count: number
  cycles_json: string
  hot_files_json: string
  external_deps_json: string
  computed_at: number
}

type GitStatsRow = {
  file_path: string
  change_count: number
  last_changed: string
}

type ChunkFtsRow = {
  file_path: string
  start_line: number
  end_line: number
  chunk_text: string
  rank: number
}

type SymbolRow = {
  id: number
  file_id: number
  file_path: string
  name: string
  kind: string
  start_line: number
  end_line: number
  signature: string
  docstring: string
  is_exported: number
  content_hash: string
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapUCGNode(r: UCGNodeRow): UCGFileNode {
  return {
    id: r.id,
    filePath: r.file_path,
    language: r.language,
    nodeType: r.node_type,
    archLayer: r.arch_layer,
    isEntryPoint: r.is_entry_point === 1,
    importCount: r.import_count,
    importedByCount: r.imported_by_count,
  }
}

function mapUCGEdge(r: UCGEdgeRow): UCGImportEdge {
  return {
    id: r.id,
    fromFile: r.from_file,
    toModule: r.to_module,
    resolvedFile: r.resolved_file,
    isExternal: r.is_external === 1,
    edgeType: r.edge_type,
  }
}

function mapMetrics(r: UCGMetricsRow): UCGGraphMetrics {
  return {
    totalNodes: r.total_nodes,
    totalEdges: r.total_edges,
    entryCount: r.entry_count,
    cycleCount: r.cycle_count,
    cycles: JSON.parse(r.cycles_json) as string[][],
    hotFiles: JSON.parse(r.hot_files_json) as string[],
    externalDeps: JSON.parse(r.external_deps_json) as Record<string, number>,
    computedAt: r.computed_at,
  }
}

function mapGitStats(r: GitStatsRow): GitFileStats {
  return {
    file: r.file_path,
    changeCount: r.change_count,
    lastChanged: r.last_changed,
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {

  // ── Workspace ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.WORKSPACE_OPEN, async (_e, dir?: string) => {
    let targetDir = dir
    if (!targetDir) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Workspace',
        buttonLabel: 'Open',
        defaultPath: getOpenWorkspaceRoot() ?? undefined,
      })
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      targetDir = result.filePaths[0]!
    }
    try {
      await openWorkspace(targetDir)
      return { root: targetDir }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.WORKSPACE_REOPEN,
    async (_e, options?: { dir?: string; replaceIndex?: boolean }) => {
      const current = getOpenWorkspaceRoot()
      let targetDir = options?.dir
      if (!targetDir) {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Re-open Repository',
          message:
            'Select the repository folder. The existing index (.riaf) will be deleted and rebuilt.',
          defaultPath: current ?? undefined,
          buttonLabel: 'Re-open',
        })
        if (result.canceled || result.filePaths.length === 0) return { canceled: true }
        targetDir = result.filePaths[0]!
      }
      const replaceIndex = options?.replaceIndex ?? true
      try {
        await openWorkspace(targetDir, { replaceIndex })
        return { root: targetDir }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.WORKSPACE_CLEAR_RECENT, async () => {
    clearRecentWorkspaces()
    return { recentWorkspaces: [] as string[] }
  })

  ipcMain.handle(IPC.WORKSPACE_REMOVE_RECENT, async (_e, dir: string) => {
    const recentWorkspaces = removeRecentWorkspace(dir)
    return { recentWorkspaces }
  })

  ipcMain.handle(IPC.WORKSPACE_CLOSE, async () => {
    await getWatcher()?.stop()
    getPipeline()?.abort()
    try { closeDb() } catch { /* already closed */ }
    return { ok: true }
  })

  ipcMain.handle(IPC.WORKSPACE_GET_ROOT, async () => {
    return getOpenWorkspaceRoot()
  })

  ipcMain.handle(IPC.WORKSPACE_GET_PROFILE, async () => {
    try {
      const db = getDb()
      const row = db.prepare<[], ProfileRow>('SELECT * FROM workspace_profiles WHERE id = 1').get()
      if (!row) return null
      const profile: WorkspaceProfile = {
        workspaceRoot: row.workspace_root,
        lastScannedAt: row.last_scanned_at,
        languageStack: JSON.parse(row.language_stack_json) as string[],
        frameworks: JSON.parse(row.frameworks_json) as WorkspaceProfile['frameworks'],
        packageManagers: JSON.parse(row.package_managers_json) as string[],
        buildCommands: JSON.parse(row.build_commands_json) as WorkspaceProfile['buildCommands'],
        testCommands: JSON.parse(row.test_commands_json) as WorkspaceProfile['testCommands'],
        lintCommands: JSON.parse(row.lint_commands_json) as WorkspaceProfile['lintCommands'],
        fileCount: row.file_count,
        totalLoc: row.total_loc,
        projectPurpose: row.project_purpose,
        architectureSummary: row.architecture_summary,
        isStale: false,
      }
      return profile
    } catch {
      return null
    }
  })

  // ── Indexer ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.INDEXER_START, async (_e, dir?: string) => {
    const root = dir ?? getOpenWorkspaceRoot()
    if (!root) return { error: 'No workspace open' }
    const p = getPipeline()
    if (!p) return { error: 'Pipeline not initialised — open a workspace first' }
    p.run().catch(console.error)
    return { ok: true }
  })

  ipcMain.handle(IPC.INDEXER_ABORT, async () => {
    getPipeline()?.abort()
    return { ok: true }
  })

  ipcMain.handle(IPC.INDEXER_GET_STATUS, async (): Promise<IndexerState> => {
    const p = getPipeline()
    return { isRunning: p?.running ?? false, lastStatus: null, lastCompletedAt: null }
  })

  /** Renderer calls this after initial indexing to enable live incremental updates. */
  ipcMain.handle('indexer:startWatcher', async () => {
    startWatcher()
    return { ok: true }
  })

  // ── Search ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SEARCH_CODEBASE, async (_e, query: string, limit = 20) => {
    try {
      const db = getDb()
      const sanitized = EmbeddingService.sanitizeFts(query)
      if (!sanitized) return []
      const rows = db
        .prepare<[string, number], ChunkFtsRow>(
          `SELECT c.file_path, c.start_line, c.end_line, c.chunk_text,
                  bm25(chunks_fts) AS rank
           FROM   chunks_fts
           JOIN   code_chunks c ON c.rowid = chunks_fts.rowid
           WHERE  chunks_fts MATCH ?
           ORDER  BY rank
           LIMIT  ?`,
        )
        .all(sanitized, limit)

      const results: CodebaseSearchResult[] = rows.map((r) => ({
        filePath: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        snippet: r.chunk_text.slice(0, 300),
        score: Math.abs(r.rank),
      }))
      return results
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.SEARCH_CODEBASE_HYBRID, async (_e, query: string, limit = 20) => {
    try {
      const db = getDb()
      return await EmbeddingService.instance.hybridSearch(db, query, limit)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.SEARCH_SYMBOLS, async (_e, query: string, limit = 20) => {
    try {
      const db = getDb()
      const sanitized = EmbeddingService.sanitizeFts(query)
      if (!sanitized) return []
      const rows = db
        .prepare<[string, number], SymbolRow>(
          `SELECT s.id, s.file_id, s.file_path, s.name, s.kind,
                  s.start_line, s.end_line, s.signature, s.docstring,
                  s.is_exported, s.content_hash
           FROM   symbols_fts
           JOIN   symbols s ON s.rowid = symbols_fts.rowid
           WHERE  symbols_fts MATCH ?
           ORDER  BY rank
           LIMIT  ?`,
        )
        .all(sanitized, limit)

      const results: ExtractedSymbol[] = rows.map((r) => ({
        id: r.id,
        fileId: r.file_id,
        filePath: r.file_path,
        name: r.name,
        kind: r.kind as ExtractedSymbol['kind'],
        startLine: r.start_line,
        endLine: r.end_line,
        signature: r.signature,
        docstring: r.docstring,
        isExported: r.is_exported === 1,
        contentHash: r.content_hash,
      }))
      return results
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── UCG ─────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.UCG_GET_GRAPH, async () => {
    try {
      const db = getDb()
      const nodeRows = db.prepare<[], UCGNodeRow>('SELECT * FROM ucg_file_nodes').all()
      const edgeRows = db.prepare<[], UCGEdgeRow>('SELECT * FROM ucg_import_edges').all()
      const metricsRow = db
        .prepare<[], UCGMetricsRow>('SELECT * FROM ucg_graph_metrics WHERE id = 1')
        .get()

      const data: UCGGraphData = {
        nodes: nodeRows.map(mapUCGNode),
        edges: edgeRows.map(mapUCGEdge),
        metrics: metricsRow ? mapMetrics(metricsRow) : null,
      }
      return data
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.UCG_GET_METRICS, async () => {
    try {
      const db = getDb()
      const row = db
        .prepare<[], UCGMetricsRow>('SELECT * FROM ucg_graph_metrics WHERE id = 1')
        .get()
      return row ? mapMetrics(row) : null
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.UCG_GET_IMPORT_GRAPH,
    async (
      _e,
      filePath: string,
      direction: 'in' | 'out' | 'both' | 'imports' | 'importedBy' = 'both',
    ) => {
      try {
        const db = getDb()
        const dir = direction === 'imports' ? 'out' : direction === 'importedBy' ? 'in' : direction
        const imports =
          dir === 'in'
            ? []
            : db
                .prepare<[string], UCGEdgeRow>(
                  'SELECT * FROM ucg_import_edges WHERE from_file = ?',
                )
                .all(filePath)
                .map(mapUCGEdge)
        const importedBy =
          dir === 'out'
            ? []
            : db
                .prepare<[string], UCGEdgeRow>(
                  'SELECT * FROM ucg_import_edges WHERE resolved_file = ?',
                )
                .all(filePath)
                .map(mapUCGEdge)
        return {
          imports: imports.map((e) => e.resolvedFile ?? e.toModule),
          importedBy: importedBy.map((e) => e.fromFile),
          externalDeps: imports.filter((e) => e.isExternal).map((e) => e.toModule),
          edges: [...imports, ...importedBy],
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── Git ─────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GIT_DIFF_STAT, async (_e, limit = 50) => {
    try {
      const db = getDb()
      const rows = db
        .prepare<[number], GitStatsRow>(
          `SELECT file_path, change_count, last_changed
           FROM   git_file_stats
           ORDER  BY change_count DESC
           LIMIT  ?`,
        )
        .all(limit)
      return rows.map(mapGitStats)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.GIT_RECENTLY_CHANGED, async (_e, days = 7, limit = 50) => {
    try {
      const db = getDb()
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      const rows = db
        .prepare<[string, number], GitStatsRow>(
          `SELECT file_path, change_count, last_changed
           FROM   git_file_stats
           WHERE  last_changed >= ?
           ORDER  BY last_changed DESC
           LIMIT  ?`,
        )
        .all(since, limit)
      return rows.map(mapGitStats)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── RIAF ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.RIAF_START, async (_e, config?: Partial<RiafConfig>) => {
    const rc = getRiafController()
    if (!rc) return { error: 'No workspace open' }
    // Merge caller overrides with stored defaults so RiafController always
    // receives a complete RiafConfig (its start() signature is not partial).
    const fullConfig: RiafConfig = {
      ...DEFAULT_RIAF_CONFIG,
      maxFiles: getSetting('riafMaxFiles'),
      includeTests: getSetting('riafIncludeTests'),
      model: getSetting('defaultModel') || DEFAULT_RIAF_CONFIG.model,
      ...config,
    }
    rc.start(fullConfig).catch(console.error)
    return { ok: true }
  })

  ipcMain.handle(IPC.RIAF_ABORT, async () => {
    getRiafController()?.abort()
    return { ok: true }
  })

  ipcMain.handle(IPC.RIAF_GET_STATE, async () => {
    return getRiafController()?.getState() ?? { status: 'idle' }
  })

  // ── Settings ─────────────────────────────────────────────────────────────────

  const ALL_SETTING_KEYS: ReadonlyArray<keyof AppSettings> = [
    'llmProvider',
    'anthropicApiKey',
    'openaiApiKey',
    'ollamaBaseUrl',
    'lmstudioBaseUrl',
    'openaiCompatBaseUrl',
    'openaiCompatApiKey',
    'defaultModel',
    'embeddingBaseUrl',
    'embeddingApiKey',
    'embeddingModel',
    'embeddingsEnabled',
    'riafMaxFiles',
    'riafIncludeTests',
    'issEnabled',
    'issPassBEnabled',
    'githubToken',
    'githubRepoOwner',
    'githubRepoName',
    'defaultSdlcMode',
    'recentWorkspaces',
    'theme',
    'backgroundTheme',
  ]

  const EMBEDDING_KEYS: ReadonlyArray<keyof AppSettings> = [
    'embeddingBaseUrl',
    'embeddingApiKey',
    'embeddingModel',
    'embeddingsEnabled',
  ]

  ipcMain.handle(IPC.SETTINGS_GET, async (_e, key?: string) => {
    if (key) return getSetting(key as keyof AppSettings)
    return Object.fromEntries(ALL_SETTING_KEYS.map((k) => [k, getSetting(k)]))
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_e, key: string, value: unknown) => {
    setSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings])

    // Re-configure EmbeddingService whenever an embedding setting changes.
    // Configure whenever a key is present so Pass C alignment can use embeddings
    // even if the user just pasted credentials (toggle still gates hybrid search indexing).
    if (EMBEDDING_KEYS.includes(key as keyof AppSettings)) {
      const apiKey = getSetting('embeddingApiKey')
      if (apiKey) {
        EmbeddingService.instance.configure({
          apiKey,
          baseUrl: getSetting('embeddingBaseUrl'),
          model: getSetting('embeddingModel'),
        })
      }
    }
    return { ok: true }
  })

  // ── Dialog / Shell ───────────────────────────────────────────────────────────

  ipcMain.handle('dialog:showOpen', async (_e, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options)
  })

  ipcMain.handle('shell:openPath', async (_e, filePath: string) => {
    return shell.openPath(filePath)
  })

  // ISS handlers are registered once via wireISS() in index.ts
}

// Export getters for convenience (re-exported so renderer-facing types can import
// from a single location without touching ./index directly).
export { getOpenWorkspaceRoot, getOpenDb, getPipeline, getWatcher, getRiafController }
