// packages/main/src/domain/passD/contextIndexer.ts
import type Database from 'better-sqlite3'
import type { BoundedContextDef } from '@shared/index'
import { upsertNode, insertEdge } from '../graphWrite'

/**
 * Index BOUNDED_CONTEXT nodes and link matching file_metadata entries via
 * BELONGS_TO_CONTEXT edges.  Returns a map of context name → node id so
 * subsequent indexers can reference contexts without re-querying.
 */
export function indexContexts(
  db: Database.Database,
  contexts: BoundedContextDef[],
): Map<string, number> {
  const contextMap = new Map<string, number>()
  if (contexts.length === 0) return contextMap

  // Load all known file paths once — only needed if any context declares filePaths
  const hasFilePaths = contexts.some((c) => c.filePaths && c.filePaths.length > 0)
  const allFiles: { id: number; file_path: string }[] = hasFilePaths
    ? db
        .prepare<[], { id: number; file_path: string }>(
          'SELECT id, file_path FROM file_metadata',
        )
        .all()
    : []

  const tx = db.transaction(() => {
    for (const ctx of contexts) {
      const nodeId = upsertNode(db, 'BOUNDED_CONTEXT', ctx.name, ctx.description, null, {
        sourceType: 'manual',
        importanceScore: 0.7,
      })
      contextMap.set(ctx.name, nodeId)

      if (!ctx.filePaths || ctx.filePaths.length === 0) continue

      for (const pattern of ctx.filePaths) {
        const matching = allFiles.filter((f) => matchesGlob(f.file_path, pattern))
        for (const file of matching) {
          // Find a graph node whose file_path matches, then link it to context
          const fileNode = db
            .prepare<[string], { id: number }>(
              'SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1',
            )
            .get(file.file_path)
          if (fileNode) {
            insertEdge(db, fileNode.id, nodeId, 'BELONGS_TO_CONTEXT', 0.9)
          }
        }
      }
    }
  })

  tx()
  return contextMap
}

/** Minimal glob matching that supports single * wildcard segments. */
function matchesGlob(filePath: string, pattern: string): boolean {
  if (!pattern.includes('*')) return filePath.includes(pattern)

  const parts = pattern.split('*')
  if (parts.length === 2) {
    const [prefix, suffix] = parts as [string, string]
    return filePath.startsWith(prefix) && filePath.endsWith(suffix)
  }
  // Multi-wildcard: every non-empty part must appear (in order is not guaranteed
  // but sufficient for directory-prefix patterns like src/payments/*)
  return parts.filter(Boolean).every((p) => filePath.includes(p))
}
