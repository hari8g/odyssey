// packages/main/src/domain/graphWrite.ts
import type Database from 'better-sqlite3'

/**
 * Returns the id of an existing graph_node matching (kind, label), or null.
 * graph_nodes has NO unique constraint on (kind, label), so we always SELECT first.
 */
export function getNodeId(
  db: Database.Database,
  kind: string,
  label: string,
): number | null {
  const row = db
    .prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1',
    )
    .get(kind, label)
  return row?.id ?? null
}

/**
 * Insert a graph_node only if one with the same (kind, label) does not yet exist.
 * Returns the existing or newly created id.
 */
export function upsertNode(
  db: Database.Database,
  kind: string,
  label: string,
  description: string | null,
  sourceRef: string | null,
  opts?: {
    filePath?: string
    importanceScore?: number
    sourceType?: string
  },
): number {
  const existing = getNodeId(db, kind, label)
  if (existing !== null) return existing

  const {
    filePath = null,
    importanceScore = 0.5,
    sourceType = 'manual',
  } = opts ?? {}

  const result = db
    .prepare(
      `INSERT INTO graph_nodes
         (kind, label, description, source_type, source_ref, file_path, importance_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)`,
    )
    .run(kind, label, description, sourceType, sourceRef, filePath, importanceScore)

  return result.lastInsertRowid as number
}

/**
 * Insert a graph_edge from → to with a given kind, skipping duplicates.
 */
export function insertEdge(
  db: Database.Database,
  fromId: number,
  toId: number,
  kind: string,
  confidence = 1.0,
): void {
  const exists = db
    .prepare<[number, number, string], { id: number }>(
      'SELECT id FROM graph_edges WHERE from_node_id = ? AND to_node_id = ? AND kind = ? LIMIT 1',
    )
    .get(fromId, toId, kind)
  if (exists) return

  db.prepare(
    `INSERT INTO graph_edges
       (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
     VALUES (?, ?, ?, 1.0, ?, 'manual', unixepoch() * 1000)`,
  ).run(fromId, toId, kind, confidence)
}
