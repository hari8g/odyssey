// packages/main/src/iss/issIpcHandlers.ts
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import {
  IPC,
  type FeatureCreateInput,
  type FeatureUpdateInput,
  type FeatureSummary,
  type ImportFormat,
  type ISSPassProgress,
  type SDLCMode,
} from '@shared/index'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { PassAOrchestrator } from './passA/passAOrchestrator'
import { PassBOrchestrator } from './passB/passBOrchestrator'
import { PassCOrchestrator } from './passC/passCOrchestrator'
import { ManualFeatureIngester } from './passC/manualFeatureIngester'
import { FeatureImportParser } from './passC/featureImportParser'
import { CodeStructureExtractor } from './passC/codeStructureExtractor'
import { EmbeddingAligner } from './passC/embeddingAligner'
import { FeatureTracesMaterializer } from './featureTracesMaterializer'
import { SDLCClassifier } from './sdlcClassifier'
import { PageRankEngine } from './pageRank'
import { SDLCRouter } from './sdlcRouter'
import { executeISSTool, registerISSToolPlugins } from './issTools'
import { checkCoChangeWarning } from './issOrchestrator'
import { registerAepIpcHandlers } from '../aep/aepIpcHandlers'

type WorkspaceAccessors = {
  getDb: () => Database.Database | null
  getRoot: () => string | null
  getWin: () => BrowserWindow | null
  getProvider: () => ILLMProvider
}

let sdlcRouter: SDLCRouter | null = null
let realignTimer: ReturnType<typeof setTimeout> | undefined
let handlersRegistered = false

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

function getRouter(db: Database.Database): SDLCRouter {
  if (!sdlcRouter) sdlcRouter = new SDLCRouter(db)
  return sdlcRouter
}

function pushProgress(win: BrowserWindow, p: ISSPassProgress): void {
  win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
}

function scheduleRealignment(
  db: Database.Database,
  root: string,
  win: BrowserWindow,
  getProvider: () => ILLMProvider,
): void {
  clearTimeout(realignTimer)
  realignTimer = setTimeout(async () => {
    try {
      const passC = new PassCOrchestrator(db, root, win, getProvider)
      await passC.runAlignment()
    } catch (err) {
      win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'C4',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, 2_000)
}

function computeCompletionPct(db: Database.Database, featureId: number): number {
  const summary = db
    .prepare<[number], { completion_pct: number }>(
      'SELECT completion_pct FROM sdlc_phase_summary WHERE feature_node_id = ?',
    )
    .get(featureId)
  if (summary) return summary.completion_pct

  const phases = db
    .prepare<[number], { sdlc_phase: string | null }>(
      `SELECT DISTINCT cn.sdlc_phase
       FROM graph_edges ge
       JOIN graph_nodes cn ON cn.id = ge.to_node_id
       WHERE ge.from_node_id = ? AND ge.kind = 'IMPLEMENTS' AND cn.sdlc_phase IS NOT NULL`,
    )
    .all(featureId)

  const set = new Set(phases.map((p) => p.sdlc_phase).filter(Boolean))
  const expected = ['requirements', 'design', 'implementation', 'testing', 'deployment']
  const hit = expected.filter((p) => set.has(p)).length
  if (hit === 0 && set.size === 0) {
    const implCount =
      db
        .prepare<[number], { n: number }>(
          `SELECT COUNT(*) as n FROM graph_edges WHERE from_node_id = ? AND kind = 'IMPLEMENTS'`,
        )
        .get(featureId)?.n ?? 0
    return implCount > 0 ? 40 : 0
  }
  return Math.round((hit / expected.length) * 1000) / 10
}

function getFeatures(db: Database.Database): FeatureSummary[] {
  const rows = db
    .prepare<
      [],
      {
        id: number
        label: string
        description: string | null
        source_type: string
        sdlc_phase: string | null
        completion_pct: number | null
        alignment_source: string | null
      }
    >(
      `SELECT
         gn.id, gn.label, gn.description, gn.source_type, gn.sdlc_phase,
         sps.completion_pct,
         (SELECT ge.source FROM graph_edges ge
          WHERE ge.from_node_id = gn.id AND ge.kind = 'IMPLEMENTS'
          ORDER BY ge.confidence DESC LIMIT 1) as alignment_source
       FROM graph_nodes gn
       LEFT JOIN sdlc_phase_summary sps ON sps.feature_node_id = gn.id
       WHERE gn.kind IN ('FEATURE','EPIC','USER_STORY')
       ORDER BY gn.label`,
    )
    .all()

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    sourceType: r.source_type,
    sdlcPhase: (r.sdlc_phase as FeatureSummary['sdlcPhase']) ?? null,
    completionPct: r.completion_pct ?? computeCompletionPct(db, r.id),
    alignmentSource: r.alignment_source,
  }))
}

export function registerIssIpcHandlers(accessors: WorkspaceAccessors): void {
  if (handlersRegistered) return
  handlersRegistered = true

  const getProvider = accessors.getProvider

  // ── Pass triggers ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_RUN_PASS_A, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const push = (p: ISSPassProgress) => pushProgress(win, p)
      await new PassAOrchestrator(db, root).run(push)
      await new SDLCClassifier(db, root, getProvider()).classifyAll(push)
      new PageRankEngine(db).compute()
      new FeatureTracesMaterializer(db).materialize()
      win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'A' })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      accessors.getWin()?.webContents.send(IPC.ISS_PASS_ERROR, { pass: 'A', message })
      return { error: message }
    }
  })

  ipcMain.handle(IPC.ISS_RUN_PASS_B, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const push = (p: ISSPassProgress) => pushProgress(win, p)
      await new PassBOrchestrator(db, root).run(push)
      win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'B' })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      accessors.getWin()?.webContents.send(IPC.ISS_PASS_ERROR, { pass: 'B', message })
      return { error: message }
    }
  })

  ipcMain.handle(IPC.ISS_RUN_PASS_C, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      await new PassCOrchestrator(db, root, win, getProvider).runAll()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      accessors.getWin()?.webContents.send(IPC.ISS_PASS_ERROR, { pass: 'C', message })
      return { error: message }
    }
  })

  // ── Graph queries ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_GET_FEATURES, () => {
    const db = accessors.getDb()
    if (!db) return []
    return getFeatures(db)
  })

  ipcMain.handle(IPC.ISS_GET_FEATURE_DETAIL, (_e, { id }: { id: number }) => {
    const db = accessors.getDb()
    if (!db) return { error: 'No workspace open' }
    const node = db
      .prepare<[number], Record<string, unknown>>('SELECT * FROM graph_nodes WHERE id = ?')
      .get(id)
    if (!node) return { error: `Feature ${id} not found` }

    const traces = db
      .prepare<[number], Record<string, unknown>>(
        `SELECT ft.*, cn.label as code_label, cn.kind as code_kind, cn.file_path, cn.sdlc_phase
         FROM feature_traces ft
         JOIN graph_nodes cn ON cn.id = ft.code_node_id
         WHERE ft.feature_node_id = ?
         ORDER BY ft.confidence DESC`,
      )
      .all(id)

    const edges = db
      .prepare<[number, number], Record<string, unknown>>(
        `SELECT * FROM graph_edges WHERE from_node_id = ? OR to_node_id = ?`,
      )
      .all(id, id)

    const summary = db
      .prepare<[number], Record<string, unknown>>(
        'SELECT * FROM sdlc_phase_summary WHERE feature_node_id = ?',
      )
      .get(id)

    return {
      node,
      traces,
      edges,
      summary: summary ?? null,
      completionPct: computeCompletionPct(db, id),
    }
  })

  ipcMain.handle(IPC.ISS_GET_GRAPH_NODES, (_e, opts?: { kind?: string }) => {
    const db = accessors.getDb()
    if (!db) return []
    if (opts?.kind) {
      return db
        .prepare<[string], Record<string, unknown>>(
          'SELECT * FROM graph_nodes WHERE kind = ? ORDER BY importance_score DESC, label',
        )
        .all(opts.kind)
    }
    return db
      .prepare<[], Record<string, unknown>>(
        'SELECT * FROM graph_nodes ORDER BY kind, importance_score DESC LIMIT 5000',
      )
      .all()
  })

  ipcMain.handle(IPC.ISS_GET_GRAPH_EDGES, (_e, opts?: { kind?: string }) => {
    const db = accessors.getDb()
    if (!db) return []
    if (opts?.kind) {
      return db
        .prepare<[string], Record<string, unknown>>(
          'SELECT * FROM graph_edges WHERE kind = ? ORDER BY weight DESC LIMIT 10000',
        )
        .all(opts.kind)
    }
    return db
      .prepare<[], Record<string, unknown>>(
        'SELECT * FROM graph_edges ORDER BY id DESC LIMIT 10000',
      )
      .all()
  })

  ipcMain.handle(IPC.ISS_GET_COCHANGE, (_e, { filePath }: { filePath: string }) => {
    const db = accessors.getDb()
    if (!db) return []
    const node = db
      .prepare<[string], { id: number }>('SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1')
      .get(filePath)
    if (!node) return []

    const rows = db
      .prepare<[number], { metadata_json: string | null; weight: number; confidence: number }>(
        `SELECT metadata_json, weight, confidence FROM graph_edges
         WHERE kind = 'CO_CHANGES_WITH' AND from_node_id = ?
         ORDER BY weight DESC LIMIT 30`,
      )
      .all(node.id)

    return rows
      .map((r) => {
        try {
          const meta = JSON.parse(r.metadata_json ?? '{}') as {
            file_a?: string
            file_b?: string
          }
          const partner =
            meta.file_a === filePath
              ? meta.file_b
              : meta.file_b === filePath
                ? meta.file_a
                : meta.file_b
          if (!partner) return null
          return { filePath: partner, weight: r.weight, confidence: r.confidence }
        } catch {
          return null
        }
      })
      .filter((p): p is { filePath: string; weight: number; confidence: number } => p !== null)
  })

  ipcMain.handle(IPC.ISS_GET_FEATURE_COUNT, () => {
    const db = accessors.getDb()
    if (!db) return { count: 0 }
    return {
      count:
        db
          .prepare<[], { n: number }>(
            `SELECT COUNT(*) as n FROM graph_nodes WHERE kind IN ('FEATURE','EPIC','USER_STORY')`,
          )
          .get()?.n ?? 0,
    }
  })

  // ── Manual feature CRUD ────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_FEATURE_CREATE, (_e, input: FeatureCreateInput) => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const result = new ManualFeatureIngester(db).create(input)
      scheduleRealignment(db, root, win, getProvider)
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_FEATURE_UPDATE, (_e, input: FeatureUpdateInput) => {
    try {
      const { db } = requireCtx(accessors)
      return { ok: new ManualFeatureIngester(db).update(input) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_FEATURE_DELETE, (_e, { id }: { id: number }) => {
    try {
      const { db } = requireCtx(accessors)
      new ManualFeatureIngester(db).delete(id)
      new FeatureTracesMaterializer(db).materialize()
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.ISS_FEATURE_IMPORT_PREVIEW,
    (_e, { content, format }: { content: string; format?: ImportFormat }) => {
      const db = accessors.getDb()
      const parser = new FeatureImportParser()
      const existingLabels = new Set(
        db
          ? (
              db
                .prepare<[], { label: string }>(
                  `SELECT label FROM graph_nodes WHERE kind IN ('FEATURE','EPIC','USER_STORY')`,
                )
                .all() as { label: string }[]
            ).map((r) => r.label.toLowerCase())
          : [],
      )
      return parser.preview(content, format, existingLabels)
    },
  )

  ipcMain.handle(
    IPC.ISS_FEATURE_IMPORT,
    (
      _e,
      {
        content,
        format,
        sourceName,
      }: { content: string; format?: ImportFormat; sourceName?: string },
    ) => {
      try {
        const { db, root, win } = requireCtx(accessors)
        const parser = new FeatureImportParser()
        const items = parser.parse(content, format)
        const result = new ManualFeatureIngester(db).bulkCreate(items, sourceName ?? 'import')
        if (result.created > 0) scheduleRealignment(db, root, win, getProvider)
        return result
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.ISS_FEATURE_GET_AUDIT, (_e, opts?: { nodeId?: number }) => {
    const db = accessors.getDb()
    if (!db) return []
    if (opts?.nodeId != null) {
      return db
        .prepare<[number], Record<string, unknown>>(
          `SELECT * FROM manual_feature_audit WHERE node_id = ? ORDER BY created_at DESC LIMIT 100`,
        )
        .all(opts.nodeId)
    }
    return db
      .prepare<[], Record<string, unknown>>(
        `SELECT * FROM manual_feature_audit ORDER BY created_at DESC LIMIT 100`,
      )
      .all()
  })

  // ── C3.5 suggestions ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_DISCOVER_FEATURES, async () => {
    try {
      const { db, win } = requireCtx(accessors)
      const extractor = new CodeStructureExtractor(db, getProvider())
      const push = (pct: number, detail: string) =>
        pushProgress(win, { pass: 'C3.5', stage: 'auto_discovery', pct, detail })
      const count = await extractor.extract(push)
      return { suggestions: count }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_GET_SUGGESTIONS, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare<[], Record<string, unknown>>(
        `SELECT * FROM feature_suggestions ORDER BY confidence DESC, created_at DESC`,
      )
      .all()
  })

  ipcMain.handle(IPC.ISS_APPROVE_SUGGESTION, (_e, { id }: { id: number }) => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const result = new CodeStructureExtractor(db, getProvider()).approveSuggestion(id)
      scheduleRealignment(db, root, win, getProvider)
      return result
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_REJECT_SUGGESTION, (_e, { id }: { id: number }) => {
    try {
      const { db } = requireCtx(accessors)
      new CodeStructureExtractor(db, getProvider()).rejectSuggestion(id)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_APPROVE_ALL_SUGGESTIONS, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      const approved = new CodeStructureExtractor(db, getProvider()).approveAll()
      if (approved > 0) scheduleRealignment(db, root, win, getProvider)
      return { approved }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Alignment ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_RUN_ALIGNMENT, async () => {
    try {
      const { db, root, win } = requireCtx(accessors)
      await new PassCOrchestrator(db, root, win, getProvider).runAlignment()
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ISS_ALIGNMENT_MODE, async () => {
    const db = accessors.getDb()
    if (!db) return 'unavailable'
    const aligner = new EmbeddingAligner(db)
    const avail = await aligner.checkEmbeddingEndpoint()
    return avail ? 'embedding' : 'bm25_fallback'
  })

  // ── PO tools ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_TRACE_FEATURE, async (_e, { feature }: { feature: string }) => {
    const { db, root } = requireCtx(accessors)
    return executeISSTool(
      { id: '', name: 'trace_feature_to_code', input: { feature } },
      db,
      root,
      getProvider,
    )
  })

  ipcMain.handle(
    IPC.ISS_IMPACT_ANALYSIS,
    async (_e, { query, mode }: { query: string; mode?: SDLCMode }) => {
      const { db, root } = requireCtx(accessors)
      return executeISSTool(
        { id: '', name: 'impact_analysis', input: { query, mode } },
        db,
        root,
        getProvider,
      )
    },
  )

  ipcMain.handle(IPC.ISS_FEATURE_STATUS, async (_e, opts?: { feature?: string }) => {
    const { db, root } = requireCtx(accessors)
    return executeISSTool(
      { id: '', name: 'feature_status', input: { feature: opts?.feature } },
      db,
      root,
      getProvider,
    )
  })

  ipcMain.handle(IPC.ISS_FIND_SIMILAR, async (_e, { feature }: { feature: string }) => {
    const { db, root } = requireCtx(accessors)
    return executeISSTool(
      { id: '', name: 'find_similar_features', input: { feature } },
      db,
      root,
      getProvider,
    )
  })

  ipcMain.handle(IPC.ISS_GEN_CRITERIA, async (_e, { feature }: { feature: string }) => {
    const { db, root } = requireCtx(accessors)
    return executeISSTool(
      { id: '', name: 'generate_acceptance_criteria', input: { feature } },
      db,
      root,
      getProvider,
    )
  })

  ipcMain.handle(IPC.ISS_SUGGEST_ARCH, async (_e, { feature }: { feature: string }) => {
    const { db, root } = requireCtx(accessors)
    return executeISSTool(
      { id: '', name: 'suggest_architecture', input: { feature } },
      db,
      root,
      getProvider,
    )
  })

  // ── SDLC Router ────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.ISS_GET_SDLC_MODE, () => {
    const db = accessors.getDb()
    if (!db) return 'auto'
    return getRouter(db).getMode()
  })

  ipcMain.handle(IPC.ISS_SET_SDLC_MODE, (_e, { mode }: { mode: SDLCMode }) => {
    const db = accessors.getDb()
    if (!db) return 'auto'
    getRouter(db).setMode(mode)
    return getRouter(db).getMode()
  })

  // Co-change check (for UI / future watcher wiring)
  ipcMain.handle('iss:checkCoChange', (_e, { filePath }: { filePath: string }) =>
    checkCoChangeWarning(filePath),
  )

  // ── Register PO tools as RIAF agent plugins ────────────────────────────────

  registerISSToolPlugins(getProvider)

  // ── AEP handlers (registered once alongside ISS) ───────────────────────────
  registerAepIpcHandlers(accessors)
}

/** Reset module-level router (e.g. when workspace closes). */
export function resetIssIpcState(): void {
  sdlcRouter = null
  clearTimeout(realignTimer)
  realignTimer = undefined
}
