// packages/main/src/domain/passD/regulationIndexer.ts
import type Database from 'better-sqlite3'
import type { RegulationDef } from '@shared/index'
import { upsertNode, insertEdge } from '../graphWrite'

/**
 * Index REGULATION nodes and apply GOVERNED_BY edges to matching graph nodes
 * based on file path patterns in applies_to.
 */
export function indexRegulations(db: Database.Database, regulations: RegulationDef[]): void {
  if (regulations.length === 0) return

  const tx = db.transaction(() => {
    for (const reg of regulations) {
      const regId = upsertNode(
        db,
        'REGULATION',
        reg.name,
        reg.body,
        reg.id,
        { sourceType: 'manual', importanceScore: 0.8 },
      )

      if (!reg.applies_to || reg.applies_to.length === 0) continue

      // Load file-backed nodes once per regulation
      const fileNodes = db
        .prepare<[], { id: number; file_path: string; label: string }>(
          'SELECT id, file_path, label FROM graph_nodes WHERE file_path IS NOT NULL',
        )
        .all()

      for (const pattern of reg.applies_to) {
        const matched = fileNodes.filter((n) => matchesGlob(n.file_path, pattern))
        for (const node of matched) {
          insertEdge(db, node.id, regId, 'GOVERNED_BY', 0.9)
        }
      }
    }
  })

  tx()
}

function matchesGlob(filePath: string, pattern: string): boolean {
  if (!pattern.includes('*')) return filePath.includes(pattern)

  const parts = pattern.split('*')
  if (parts.length === 2) {
    const [prefix, suffix] = parts as [string, string]
    return filePath.startsWith(prefix) && filePath.endsWith(suffix)
  }
  return parts.filter(Boolean).every((p) => filePath.includes(p))
}
