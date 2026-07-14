import Database from 'better-sqlite3'
import ignore from 'ignore'
import { watch, type FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import {
  LANGUAGE_MAP,
  INDEXABLE_EXTENSIONS,
  isIgnoredWorkspacePath,
} from './workspaceScanner'
import type { ScannedFile } from './workspaceScanner'
import { CodeChunker } from './codeChunker'
import { SymbolExtractor } from './symbolExtractor'
import { ImportExtractor } from './importExtractor'
import { checkCoChangeWarning } from '../iss/issOrchestrator'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1500
const IPC_INCREMENTAL_UPDATE = 'indexer:incrementalUpdate'
const HASH_PEEK_BYTES = 8 * 1024

// Only watch indexable source files — not the whole directory tree (avoids EMFILE on macOS).
const WATCH_GLOBS = [`**/*.{${[...INDEXABLE_EXTENSIONS].join(',')}}`]

// ---------------------------------------------------------------------------
// FileWatcher
// ---------------------------------------------------------------------------

export class FileWatcher {
  private readonly db: Database.Database
  private readonly workspaceRoot: string
  private readonly chunker: CodeChunker
  private readonly symbolExtractor: SymbolExtractor
  private readonly importExtractor: ImportExtractor
  private readonly gitignore = ignore()

  private watcher: FSWatcher | null = null
  private readonly pending = new Map<string, NodeJS.Timeout>()

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
    this.chunker = new CodeChunker(db, workspaceRoot)
    this.symbolExtractor = new SymbolExtractor(db, workspaceRoot)
    this.importExtractor = new ImportExtractor(db, workspaceRoot)

    const gitignorePath = path.join(workspaceRoot, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      try {
        this.gitignore.add(fs.readFileSync(gitignorePath, 'utf8'))
      } catch {
        // Non-fatal
      }
    }
  }

  start(): void {
    if (this.watcher) return

    const shouldIgnore = (p: string): boolean =>
      isIgnoredWorkspacePath(this.workspaceRoot, p, this.gitignore)

    // Polling avoids kqueue FD exhaustion on large repos; FSEvents can still fail in Electron.
    const usePolling = process.platform === 'darwin' || process.platform === 'win32'

    this.watcher = watch(WATCH_GLOBS, {
      cwd: this.workspaceRoot,
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      usePolling,
      interval: usePolling ? 1500 : undefined,
      ignored: (p) => shouldIgnore(p),
    })

    this.watcher.on('error', (err) => {
      console.error('[FileWatcher] watcher error:', err)
    })

    this.watcher.on('add', (relPath) => {
      const absPath = path.join(this.workspaceRoot, relPath)
      this.scheduleUpdate(absPath)
    })
    this.watcher.on('change', (relPath) => {
      const absPath = path.join(this.workspaceRoot, relPath)
      this.scheduleUpdate(absPath)
    })
    this.watcher.on('unlink', (relPath) => {
      const absPath = path.join(this.workspaceRoot, relPath)
      this.handleUnlink(absPath)
    })
  }

  async stop(): Promise<void> {
    // Clear any pending debounce timers
    for (const timer of this.pending.values()) clearTimeout(timer)
    this.pending.clear()

    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  // ---------------------------------------------------------------------------
  // Debounced change handler
  // ---------------------------------------------------------------------------

  private scheduleUpdate(absPath: string): void {
    if (isIgnoredWorkspacePath(this.workspaceRoot, absPath, this.gitignore)) return

    const ext = path.extname(absPath).slice(1).toLowerCase()
    if (!INDEXABLE_EXTENSIONS.has(ext)) return

    const existing = this.pending.get(absPath)
    if (existing) clearTimeout(existing)

    this.pending.set(
      absPath,
      setTimeout(() => {
        this.pending.delete(absPath)
        void this.handleChange(absPath)
      }, DEBOUNCE_MS),
    )
  }

  private async handleChange(absPath: string): Promise<void> {
    // Co-change approval gate (ISS) — fire-and-forget warning to renderer
    try {
      const relPath = path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/')
      checkCoChangeWarning(relPath)
    } catch {
      // ISS may not be wired yet
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(absPath)
    } catch {
      return
    }

    const relPath = path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/')
    const ext = path.extname(absPath).slice(1).toLowerCase()
    const language = LANGUAGE_MAP[ext] ?? 'unknown'
    const contentHash = peekHash(absPath)

    // Upsert file_metadata
    this.db
      .prepare(`
        INSERT INTO file_metadata (workspace_root, file_path, language, size_bytes, last_modified, content_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_root, file_path) DO UPDATE SET
          language      = excluded.language,
          size_bytes    = excluded.size_bytes,
          last_modified = excluded.last_modified,
          content_hash  = excluded.content_hash
      `)
      .run(
        this.workspaceRoot,
        relPath,
        language,
        stat.size,
        Math.floor(stat.mtimeMs),
        contentHash,
      )

    const file: ScannedFile = {
      absolutePath: absPath,
      relativePath: relPath,
      language,
      sizeBytes: stat.size,
      lastModified: Math.floor(stat.mtimeMs),
      contentHash,
    }

    // Re-process: chunk → symbols → imports
    this.chunker.chunkAll([file])
    this.symbolExtractor.extractAll([file])
    this.importExtractor.extractAll([file])

    this.broadcast(IPC_INCREMENTAL_UPDATE, { type: 'change', file: relPath })
  }

  private handleUnlink(absPath: string): void {
    const relPath = path.relative(this.workspaceRoot, absPath).replace(/\\/g, '/')

    // Cascade deletes from code_chunks, symbols, ucg_import_edges etc.
    // are handled by FK ON DELETE CASCADE in the schema.
    this.db
      .prepare(
        'DELETE FROM file_metadata WHERE workspace_root = ? AND file_path = ?',
      )
      .run(this.workspaceRoot, relPath)

    // Also clean up ucg_file_nodes (no FK cascade from file_metadata)
    this.db
      .prepare('DELETE FROM ucg_file_nodes WHERE file_path = ?')
      .run(relPath)

    this.db
      .prepare('DELETE FROM ucg_import_edges WHERE from_file = ? OR resolved_file = ?')
      .run(relPath, relPath)

    this.broadcast(IPC_INCREMENTAL_UPDATE, { type: 'unlink', file: relPath })
  }

  // ---------------------------------------------------------------------------
  // IPC broadcast
  // ---------------------------------------------------------------------------

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function peekHash(filePath: string): string {
  const buf = Buffer.alloc(HASH_PEEK_BYTES)
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const bytesRead = fs.readSync(fd, buf, 0, HASH_PEEK_BYTES, 0)
    return crypto
      .createHash('sha256')
      .update(buf.subarray(0, bytesRead))
      .digest('hex')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch { /* ignore */ }
    }
  }
}
