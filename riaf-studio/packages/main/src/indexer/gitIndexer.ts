import Database from 'better-sqlite3'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitFileStats } from '@shared/index'

const execFile = promisify(execFileCb)

// Max stdout buffer for git log (20 MB should be more than enough)
const MAX_BUFFER = 20 * 1024 * 1024

// ---------------------------------------------------------------------------
// GitIndexer
// ---------------------------------------------------------------------------

export class GitIndexer {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  /**
   * Parse the full git log and persist per-file change counts to
   * the git_file_stats table via upsert.
   */
  async index(): Promise<void> {
    let log: string
    try {
      log = await this.runGitLog()
    } catch {
      // Not a git repo or git not available — skip silently
      return
    }

    const stats = parseFileStats(log)
    this.persistStats(stats)
  }

  /** Return the current branch name, or 'unknown' if unavailable. */
  async getBranch(): Promise<string> {
    try {
      const { stdout } = await execFile(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: this.workspaceRoot },
      )
      return stdout.trim() || 'unknown'
    } catch {
      return 'unknown'
    }
  }

  /**
   * Return a human-readable diff stat comparing the working tree to HEAD.
   * Falls back to an empty string if git is unavailable or no changes.
   */
  async getDiffStat(): Promise<string> {
    try {
      const { stdout } = await execFile(
        'git',
        ['diff', '--stat', 'HEAD'],
        { cwd: this.workspaceRoot },
      )
      return stdout.trim()
    } catch {
      return ''
    }
  }

  /**
   * Return the `limit` most recently changed files (by change frequency)
   * from the persisted git_file_stats table.
   */
  async getRecentlyChanged(limit = 20): Promise<GitFileStats[]> {
    type Row = { file_path: string; change_count: number; last_changed: string }
    return this.db
      .prepare<[number], Row>(
        'SELECT file_path, change_count, last_changed FROM git_file_stats ORDER BY change_count DESC LIMIT ?',
      )
      .all(limit)
      .map((row) => ({
        file: row.file_path,
        changeCount: row.change_count,
        lastChanged: row.last_changed,
      }))
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async runGitLog(): Promise<string> {
    // Using a sentinel prefix so we can reliably distinguish date lines
    // from file path lines when parsing.
    const { stdout } = await execFile(
      'git',
      ['log', '--pretty=format:DATE:%ad', '--date=short', '--name-only'],
      { cwd: this.workspaceRoot, maxBuffer: MAX_BUFFER },
    )
    return stdout
  }

  private persistStats(
    stats: Map<string, { changeCount: number; lastChanged: string }>,
  ): void {
    if (stats.size === 0) return

    const upsert = this.db.prepare(`
      INSERT INTO git_file_stats (file_path, change_count, last_changed)
      VALUES (?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        change_count = excluded.change_count,
        last_changed = excluded.last_changed
    `)

    const batch = this.db.transaction(() => {
      for (const [filePath, { changeCount, lastChanged }] of stats) {
        upsert.run(filePath, changeCount, lastChanged)
      }
    })

    batch()
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the output of:
 *   git log --pretty=format:DATE:%ad --date=short --name-only
 *
 * Format is a series of blocks like:
 *   DATE:2024-01-15
 *   <blank>
 *   path/to/file.ts
 *   another/file.ts
 *   DATE:2024-01-14
 *   ...
 *
 * Accumulates change_count per file (total commits touching the file)
 * and records the most-recent (first-seen) date as last_changed.
 */
function parseFileStats(
  log: string,
): Map<string, { changeCount: number; lastChanged: string }> {
  const stats = new Map<string, { changeCount: number; lastChanged: string }>()
  let currentDate = ''

  for (const rawLine of log.split('\n')) {
    const line = rawLine.trimEnd()

    if (line.startsWith('DATE:')) {
      currentDate = line.slice(5).trim()
      continue
    }

    const trimmed = line.trim()
    if (!trimmed || !currentDate) continue

    // Skip binary/deleted indicators (e.g. lines like "=> new/path")
    if (trimmed.startsWith('=>') || trimmed.includes('{')) continue

    const existing = stats.get(trimmed)
    if (existing) {
      existing.changeCount++
      // git log is newest-first, so first-seen date is already the most recent
    } else {
      stats.set(trimmed, { changeCount: 1, lastChanged: currentDate })
    }
  }

  return stats
}
