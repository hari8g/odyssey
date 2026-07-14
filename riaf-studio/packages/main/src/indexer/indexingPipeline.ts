import Database from 'better-sqlite3'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/index'
import type { IndexingStage, IndexingStatus } from '@shared/index'
import { WorkspaceScanner } from './workspaceScanner'
import type { ScannedFile } from './workspaceScanner'
import { CodeChunker } from './codeChunker'
import { SymbolExtractor } from './symbolExtractor'
import { ImportExtractor } from './importExtractor'
import { NodeClassifier } from './nodeClassifier'
import { GraphAnalyzer } from './graphAnalyzer'
import { detectCommands } from './commandDetector'
import { GitIndexer } from './gitIndexer'
import { EmbeddingService } from './embeddingService'
import { WorkspaceProfileBuilder } from './profileBuilder'
import type { CommandEntry } from '@shared/index'

// ---------------------------------------------------------------------------
// Post-index hooks (ISS extension point)
// ---------------------------------------------------------------------------

export type PostIndexHook = (db: Database.Database, root: string) => Promise<void>

const postIndexHooks: PostIndexHook[] = []

export function registerPostIndexHook(hook: PostIndexHook): void {
  postIndexHooks.push(hook)
}

// ---------------------------------------------------------------------------
// Stage progress ranges [startPct, endPct]
// ---------------------------------------------------------------------------

const STAGE_RANGES: Record<IndexingStage, [number, number]> = {
  scan: [0, 10],
  chunk: [10, 25],
  symbols: [25, 40],
  fts: [40, 45],
  imports: [45, 55],
  graph: [55, 65],
  commands: [65, 70],
  git: [70, 80],
  embeddings: [80, 95],
  profile: [95, 100],
}

// ---------------------------------------------------------------------------
// IndexingPipeline
// ---------------------------------------------------------------------------

export class IndexingPipeline {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  private _running = false
  private abortController: AbortController | null = null
  private startedAt = 0

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  get running(): boolean {
    return this._running
  }

  abort(): void {
    this.abortController?.abort()
  }

  async run(): Promise<void> {
    if (this._running) return

    this._running = true
    this.startedAt = Date.now()
    this.abortController = new AbortController()
    const { signal } = this.abortController

    try {
      await this.execute(signal)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      this.sendError(message)
    } finally {
      this._running = false
      this.abortController = null
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline execution
  // ---------------------------------------------------------------------------

  private async execute(signal: AbortSignal): Promise<void> {
    // ── Stage: scan ──────────────────────────────────────────────────────────
    this.sendProgress('scan', 0, 'Scanning workspace files…')
    const scanner = new WorkspaceScanner(this.db, this.workspaceRoot)
    const files: ScannedFile[] = await scanner.scan(signal)
    if (signal.aborted) return
    this.sendProgress('scan', 100, `Found ${files.length} files`)

    // ── Stage: chunk ─────────────────────────────────────────────────────────
    this.sendProgress('chunk', 0, 'Chunking source files…')
    const chunker = new CodeChunker(this.db, this.workspaceRoot)
    chunker.chunkAll(files, signal, (done, total) => {
      if (!signal.aborted) {
        this.sendProgressRaw('chunk', done / total, `${done}/${total} files chunked`)
      }
    })
    if (signal.aborted) return

    // ── Stage: symbols ───────────────────────────────────────────────────────
    this.sendProgress('symbols', 0, 'Extracting symbols…')
    const symbolExtractor = new SymbolExtractor(this.db, this.workspaceRoot)
    symbolExtractor.extractAll(files, signal)
    if (signal.aborted) return
    this.sendProgress('symbols', 100, 'Symbols extracted')

    // ── Stage: fts ───────────────────────────────────────────────────────────
    this.sendProgress('fts', 0, 'Optimising full-text index…')
    try {
      this.db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')")
      this.db.exec("INSERT INTO symbols_fts(symbols_fts) VALUES('optimize')")
    } catch { /* Non-fatal — FTS triggers keep the index consistent */ }
    this.sendProgress('fts', 100, 'FTS optimised')

    // ── Stage: imports ───────────────────────────────────────────────────────
    this.sendProgress('imports', 0, 'Extracting import edges…')
    const importExtractor = new ImportExtractor(this.db, this.workspaceRoot)
    importExtractor.extractAll(files, signal)
    if (signal.aborted) return
    this.sendProgress('imports', 100, 'Import edges extracted')

    // ── Stage: graph ─────────────────────────────────────────────────────────
    this.sendProgress('graph', 0, 'Classifying nodes…')
    const classifier = new NodeClassifier(this.db)
    classifier.classifyAll(files, signal)
    if (signal.aborted) return
    this.sendProgress('graph', 50, 'Analysing dependency graph…')
    const analyzer = new GraphAnalyzer(this.db)
    analyzer.analyze()
    this.sendProgress('graph', 100, 'Graph analysis complete')

    // ── Stage: commands ──────────────────────────────────────────────────────
    this.sendProgress('commands', 0, 'Detecting project commands…')
    const commands: CommandEntry[] = detectCommands(this.workspaceRoot)
    this.sendProgress('commands', 100, `Detected ${commands.length} commands`)

    // ── Stage: git ───────────────────────────────────────────────────────────
    this.sendProgress('git', 0, 'Indexing git history…')
    const gitIndexer = new GitIndexer(this.db, this.workspaceRoot)
    await gitIndexer.index()
    if (signal.aborted) return
    this.sendProgress('git', 100, 'Git history indexed')

    // ── Stage: embeddings ────────────────────────────────────────────────────
    // Non-fatal: timeouts / API errors must not leave indexing stuck forever.
    this.sendProgress('embeddings', 0, 'Generating embeddings…')
    try {
      await EmbeddingService.instance.indexWorkspace(this.db, {
        signal,
        onProgress: (done, total, detail) => {
          if (signal.aborted) return
          if (total <= 0) {
            this.sendProgressRaw('embeddings', 0.5, detail)
            return
          }
          this.sendProgressRaw('embeddings', Math.min(0.99, done / total), detail)
        },
      })
    } catch (err) {
      console.error('[IndexingPipeline] embeddings stage error:', err)
      this.sendProgress(
        'embeddings',
        100,
        `Embeddings skipped — ${err instanceof Error ? err.message : 'error'}`,
      )
    }
    if (signal.aborted) return
    this.sendProgress('embeddings', 100, 'Embeddings complete')

    // ── Stage: profile ───────────────────────────────────────────────────────
    this.sendProgress('profile', 0, 'Building workspace profile…')
    WorkspaceProfileBuilder.buildAndSave(this.db, this.workspaceRoot, files, commands)
    this.sendProgress('profile', 100, 'Profile saved')

    // ── Post-index hooks (ISS) ───────────────────────────────────────────────
    for (const hook of postIndexHooks) {
      try {
        await hook(this.db, this.workspaceRoot)
      } catch (err) {
        console.error('[IndexingPipeline] post-index hook error:', err)
      }
    }

    // ── Done ─────────────────────────────────────────────────────────────────
    const totalMs = Date.now() - this.startedAt
    const doneStatus: IndexingStatus = { stage: 'done', totalMs }
    this.broadcast(IPC.INDEXER_COMPLETE, doneStatus)
  }

  // ---------------------------------------------------------------------------
  // Progress helpers
  // ---------------------------------------------------------------------------

  /**
   * Send progress at a fractional position (0–1) within the stage's
   * assigned percentage range.
   */
  private sendProgressRaw(stage: IndexingStage, fraction: number, detail: string): void {
    const [lo, hi] = STAGE_RANGES[stage]
    const pct = Math.round(lo + fraction * (hi - lo))
    const status: IndexingStatus = { stage, phase: 'running', pct, detail }
    this.broadcast(IPC.INDEXER_PROGRESS, status)
  }

  /** Send progress at start (0) or end (100) of a stage. */
  private sendProgress(stage: IndexingStage, stagePct: 0 | 50 | 100, detail: string): void {
    this.sendProgressRaw(stage, stagePct / 100, detail)
  }

  private sendError(message: string): void {
    const status: IndexingStatus = { stage: 'error', message }
    this.broadcast(IPC.INDEXER_ERROR, status)
    // Also broadcast typed progress so stores that only listen to progress update
    this.broadcast(IPC.INDEXER_PROGRESS, status)
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }
}
