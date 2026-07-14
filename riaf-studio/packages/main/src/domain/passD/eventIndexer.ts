// packages/main/src/domain/passD/eventIndexer.ts
import type Database from 'better-sqlite3'
import type { DomainEventDef } from '@shared/index'
import { upsertNode, insertEdge } from '../graphWrite'

/**
 * Index DOMAIN_EVENT nodes.
 * Adds EMITS edges from producer file/label nodes and CONSUMES edges to consumer nodes.
 */
export function indexEvents(db: Database.Database, events: DomainEventDef[]): void {
  if (events.length === 0) return

  const tx = db.transaction(() => {
    for (const event of events) {
      const nodeId = upsertNode(
        db,
        'DOMAIN_EVENT',
        event.name,
        event.description,
        null,
        { sourceType: 'manual', importanceScore: 0.6 },
      )

      if (event.producedBy) {
        for (const ref of event.producedBy) {
          const producerId = resolveRef(db, ref)
          if (producerId !== null) {
            insertEdge(db, producerId, nodeId, 'EMITS', 0.8)
          }
        }
      }

      if (event.consumedBy) {
        for (const ref of event.consumedBy) {
          const consumerId = resolveRef(db, ref)
          if (consumerId !== null) {
            insertEdge(db, nodeId, consumerId, 'CONSUMES', 0.8)
          }
        }
      }
    }
  })

  tx()
}

/**
 * Try to find a graph_node by file_path first, then by label.
 * Allows event producer/consumer references to be either file paths or node labels.
 */
function resolveRef(db: Database.Database, ref: string): number | null {
  const byPath = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1',
    )
    .get(ref)
  if (byPath) return byPath.id

  const byLabel = db
    .prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE label = ? LIMIT 1',
    )
    .get(ref)
  return byLabel?.id ?? null
}
