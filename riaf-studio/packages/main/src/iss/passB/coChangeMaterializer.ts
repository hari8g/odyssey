// packages/main/src/iss/passB/coChangeMaterializer.ts
import type Database from 'better-sqlite3'

export class CoChangeMaterializer {
  constructor(private readonly db: Database.Database) {}

  materialize(): number {
    let written = 0
    this.db.exec(`DELETE FROM graph_edges WHERE kind = 'CO_CHANGES_WITH'`)

    const pairs = this.db
      .prepare<[], { file_a: string; file_b: string; co_count: number }>(
        'SELECT file_a, file_b, co_count FROM co_change_pairs WHERE co_count >= 300',
      )
      .all()

    const getNode = this.db.prepare<[string], { id: number }>(`
      SELECT id FROM graph_nodes
      WHERE file_path = ? AND kind IN ('DOMAIN_SERVICE','CLASS','MODULE','FUNCTION')
      ORDER BY CASE kind
        WHEN 'DOMAIN_SERVICE' THEN 1 WHEN 'CLASS' THEN 2
        WHEN 'MODULE' THEN 3 WHEN 'FUNCTION' THEN 4 END
      LIMIT 1
    `)
    const insertEdge = this.db.prepare(`
      INSERT INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'CO_CHANGES_WITH', ?, ?, 'git_log', ?, unixepoch() * 1000)
    `)

    const batch = this.db.transaction(() => {
      for (const p of pairs) {
        const a = getNode.get(p.file_a)
        const b = getNode.get(p.file_b)
        if (!a || !b) continue
        const j = p.co_count / 1000
        const meta = JSON.stringify({ file_a: p.file_a, file_b: p.file_b })
        insertEdge.run(a.id, b.id, j, j, meta)
        insertEdge.run(b.id, a.id, j, j, meta)
        written += 2
      }
    })
    batch()
    return written
  }
}
