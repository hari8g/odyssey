// packages/main/src/aep/graphWrite.ts
import type Database from 'better-sqlite3'
import type { ValueStreamState } from '@shared/index'

export interface NodeAttrs {
  kind: string
  label: string
  description?: string | null
  source_type?: string
  source_ref?: string | null
}

/** Returns the existing node id for (kind, label) or undefined */
export function getNodeId(
  db: Database.Database,
  kind: string,
  label: string,
): number | undefined {
  const row = db
    .prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1',
    )
    .get(kind, label)
  return row?.id
}

/**
 * Returns existing node id or inserts a new one.
 * No unique constraint on (kind, label), so we query first.
 */
export function upsertNode(db: Database.Database, attrs: NodeAttrs): number {
  const existing = getNodeId(db, attrs.kind, attrs.label)
  if (existing !== undefined) return existing
  const result = db
    .prepare(
      `INSERT INTO graph_nodes (kind, label, description, source_type, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, unixepoch() * 1000)`,
    )
    .run(
      attrs.kind,
      attrs.label,
      attrs.description ?? null,
      attrs.source_type ?? 'aep',
      attrs.source_ref ?? null,
    )
  return result.lastInsertRowid as number
}

/**
 * INSERT OR IGNORE into graph_edges.
 * Unique index on (from_node_id, to_node_id, kind) — so this is idempotent.
 */
export function insertEdge(
  db: Database.Database,
  fromId: number,
  toId: number,
  kind: string,
  weight = 1.0,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO graph_edges
     (from_node_id, to_node_id, kind, weight, source, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'aep', ?, unixepoch() * 1000)`,
  ).run(fromId, toId, kind, weight, metadata ? JSON.stringify(metadata) : null)
}

/**
 * Upsert value_stream_state row for a feature node.
 * Uses INSERT … ON CONFLICT to update state transitions.
 */
export function ensureValueStreamState(
  db: Database.Database,
  featureNodeId: number,
  state: ValueStreamState,
): void {
  db.prepare(
    `INSERT INTO value_stream_state (feature_node_id, stream_state, entered_state_at)
     VALUES (?, ?, unixepoch() * 1000)
     ON CONFLICT(feature_node_id) DO UPDATE SET
       stream_state      = excluded.stream_state,
       entered_state_at  = excluded.entered_state_at,
       blocked_on_json   = NULL`,
  ).run(featureNodeId, state)
}
