// packages/main/src/iss/featureTracesMaterializer.ts
import type Database from 'better-sqlite3'

const MAX_DEPTH = 6

export class FeatureTracesMaterializer {
  constructor(private readonly db: Database.Database) {}

  materialize(): void {
    this.db.exec('DELETE FROM feature_traces')

    const features = this.db
      .prepare<[], { id: number }>(`SELECT id FROM graph_nodes WHERE kind IN ('FEATURE','EPIC')`)
      .all()

    const traverse = this.db.prepare<
      [number, number],
      {
        node_id: number
        depth: number
        edge_kind: string | null
        confidence: number
        path: string
        kind: string
      }
    >(`
      WITH RECURSIVE traversal(node_id, depth, edge_kind, confidence, path, kind) AS (
        SELECT gn.id, 0, NULL, 1.0, CAST(gn.id AS TEXT), gn.kind
        FROM graph_nodes gn WHERE gn.id = ?
        UNION ALL
        SELECT ge.to_node_id, t.depth + 1, ge.kind,
               t.confidence * ge.confidence,
               t.path || ',' || CAST(ge.to_node_id AS TEXT),
               gn.kind
        FROM traversal t
        JOIN graph_edges ge ON ge.from_node_id = t.node_id
        JOIN graph_nodes gn ON gn.id = ge.to_node_id
        WHERE t.depth < ?
          AND ge.kind NOT IN ('CO_CHANGES_WITH','PRECEDED_BY','EVOLVED_FROM')
          AND ',' || t.path || ',' NOT LIKE '%,' || CAST(ge.to_node_id AS TEXT) || ',%'
      )
      SELECT node_id, depth, edge_kind, confidence, path, kind
      FROM traversal WHERE depth > 0
        AND kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE','INTERFACE','TYPE','ENUM',
                     'TEST_SUITE','TEST_CASE','MIGRATION','CONFIG','DEPLOYMENT_UNIT','MODULE')
      ORDER BY depth ASC, confidence DESC
    `)

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO feature_traces
        (feature_node_id, code_node_id, trace_type, confidence, path_json)
      VALUES (?, ?, ?, ?, ?)
    `)

    const batch = this.db.transaction((featureId: number) => {
      for (const r of traverse.all(featureId, MAX_DEPTH)) {
        const traceType =
          r.depth === 1
            ? 'direct'
            : r.edge_kind === 'TRACES_TO'
              ? 'git_mined'
              : r.kind === 'TEST_SUITE' || r.kind === 'TEST_CASE'
                ? 'test_derived'
                : 'inferred'
        insert.run(featureId, r.node_id, traceType, r.confidence, r.path)
      }
    })

    for (const f of features) batch(f.id)
  }
}
