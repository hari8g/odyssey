// packages/main/src/iss/pageRank.ts
import type Database from 'better-sqlite3'

const DAMPING = 0.85
const ITERATIONS = 50
const EPSILON = 1e-6

export class PageRankEngine {
  constructor(private readonly db: Database.Database) {}

  compute(): void {
    const nodes = this.db
      .prepare<[], { id: number }>(
        `SELECT DISTINCT id FROM graph_nodes WHERE kind IN
       ('FUNCTION','CLASS','DOMAIN_SERVICE','MODULE','INTERFACE','TYPE','ENUM','EXTERNAL_DEPENDENCY')`,
      )
      .all()
    if (nodes.length === 0) return

    const n = nodes.length
    const ids = nodes.map((r) => r.id)
    const idxMap = new Map(ids.map((id, i) => [id, i]))
    const rank = new Float64Array(n).fill(1.0 / n)
    const next = new Float64Array(n)
    const adj: number[][] = Array.from({ length: n }, () => [])
    const outDeg = new Int32Array(n)

    const idList = ids.join(',')
    for (const e of this.db
      .prepare<[], { from_node_id: number; to_node_id: number }>(
        `SELECT from_node_id, to_node_id FROM graph_edges
       WHERE kind IN ('CALLS','IMPORTS','DEPENDS_ON')
         AND from_node_id IN (${idList})
         AND to_node_id   IN (${idList})`,
      )
      .all()) {
      const f = idxMap.get(e.from_node_id)
      const t = idxMap.get(e.to_node_id)
      if (f === undefined || t === undefined) continue
      adj[t]!.push(f)
      outDeg[f]!++
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      let diff = 0
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (const j of adj[i]!) if (outDeg[j]! > 0) sum += rank[j]! / outDeg[j]!
        next[i] = (1 - DAMPING) / n + DAMPING * sum
        diff += Math.abs(next[i]! - rank[i]!)
      }
      rank.set(next)
      if (diff < EPSILON) break
    }

    const maxRank = Math.max(...rank)
    if (maxRank === 0) return

    const update = this.db.prepare('UPDATE graph_nodes SET importance_score = ? WHERE id = ?')
    const batch = this.db.transaction(() => {
      for (let i = 0; i < n; i++) update.run(rank[i]! / maxRank, ids[i])
    })
    batch()
  }
}
