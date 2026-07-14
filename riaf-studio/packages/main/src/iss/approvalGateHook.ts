// packages/main/src/iss/approvalGateHook.ts
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { IPC } from '@shared/index'

/**
 * Co-change approval gate. Exposes a registerable check that a file watcher
 * (or IPC layer) can call when a file is edited; emits ISS_COCHANGE_WARNING
 * when strong co-change partners exist.
 */
export class ApprovalGateHook {
  constructor(
    private readonly getDb: () => Database.Database | null,
    private readonly getWin: () => BrowserWindow | null,
  ) {}

  /**
   * Register a callable check for later wiring from the file watcher / IPC.
   * Returns the bound checker so callers can invoke it without holding `this`.
   */
  register(): (filePath: string) => {
    hasWarning: boolean
    partners: { filePath: string; weight: number }[]
  } {
    return (filePath: string) => this.getWarning(filePath)
  }

  getWarning(filePath: string): {
    hasWarning: boolean
    partners: { filePath: string; weight: number }[]
  } {
    const db = this.getDb()
    if (!db) return { hasWarning: false, partners: [] }

    const node = db
      .prepare<[string], { id: number }>('SELECT id FROM graph_nodes WHERE file_path=? LIMIT 1')
      .get(filePath)
    if (!node) return { hasWarning: false, partners: [] }

    const rows = db
      .prepare<[number], { metadata_json: string | null; weight: number }>(
        `SELECT metadata_json, weight FROM graph_edges
       WHERE kind='CO_CHANGES_WITH' AND from_node_id=? AND weight>=0.5 ORDER BY weight DESC LIMIT 5`,
      )
      .all(node.id)

    const partners = rows
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
          return { filePath: partner, weight: r.weight }
        } catch {
          return null
        }
      })
      .filter((p): p is { filePath: string; weight: number } => p !== null)

    const result = { hasWarning: partners.length > 0, partners }
    if (result.hasWarning) {
      const win = this.getWin()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.ISS_COCHANGE_WARNING, {
          editedFile: filePath,
          partners,
        })
      }
    }
    return result
  }
}
