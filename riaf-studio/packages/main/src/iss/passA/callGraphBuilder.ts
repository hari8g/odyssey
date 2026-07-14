// packages/main/src/iss/passA/callGraphBuilder.ts
import type Database from 'better-sqlite3'

export class CallGraphBuilder {
  private readonly insertEdge: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'CALLS', 1.0, 0.70, 'static_analysis', ?, unixepoch() * 1000)
    `)
  }

  build(progress: (pct: number, detail: string) => void): number {
    let edgeCount = 0

    const nameIdx = new Map<string, number[]>()
    const allNodes = this.db
      .prepare<[], { id: number; label: string }>(
        `SELECT id, label FROM graph_nodes WHERE kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE')`,
      )
      .all()
    for (const n of allNodes) {
      const arr = nameIdx.get(n.label) ?? []
      arr.push(n.id)
      nameIdx.set(n.label, arr)
    }

    const importMap = new Map<string, Set<string>>()
    for (const e of this.db
      .prepare<[], { from_file: string; resolved_file: string }>(
        'SELECT from_file, resolved_file FROM ucg_import_edges WHERE resolved_file IS NOT NULL',
      )
      .all()) {
      const s = importMap.get(e.from_file) ?? new Set()
      s.add(e.resolved_file)
      importMap.set(e.from_file, s)
    }

    const functions = this.db
      .prepare<[], { node_id: number; label: string; file_path: string; start_line: number }>(
        `SELECT gn.id as node_id, gn.label, gn.file_path, gn.start_line
        FROM graph_nodes gn WHERE gn.kind = 'FUNCTION' AND gn.file_path IS NOT NULL`,
      )
      .all()

    const getChunk = this.db.prepare<[string, number], { chunk_text: string }>(
      `SELECT chunk_text FROM code_chunks WHERE file_path = ? AND start_line <= ? ORDER BY start_line DESC LIMIT 1`,
    )
    const getFileSymbols = this.db.prepare<[string], { id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE file_path = ? AND kind IN ('FUNCTION','CLASS','DOMAIN_SERVICE')`,
    )

    const total = functions.length
    const pendingEdges: { from: number; to: number; meta: string }[] = []

    const flush = this.db.transaction((rows: typeof pendingEdges) => {
      for (const r of rows) {
        this.insertEdge.run(r.from, r.to, r.meta)
        edgeCount++
      }
    })

    for (let i = 0; i < functions.length; i++) {
      if (i % 200 === 0) {
        progress(Math.round((i / Math.max(total, 1)) * 100), `${i}/${total} functions analyzed`)
      }
      const fn = functions[i]!
      const chunk = getChunk.get(fn.file_path!, fn.start_line)
      if (!chunk) continue
      const text = chunk.chunk_text

      for (const target of getFileSymbols.all(fn.file_path!)) {
        if (target.id === fn.node_id) continue
        try {
          if (new RegExp(`\\b${escapeRegExp(target.label)}\\s*\\(`).test(text)) {
            pendingEdges.push({
              from: fn.node_id,
              to: target.id,
              meta: JSON.stringify({ type: 'intra_file' }),
            })
          }
        } catch {
          /* invalid regex from label */
        }
      }

      for (const importedFile of importMap.get(fn.file_path!) ?? new Set()) {
        for (const target of getFileSymbols.all(importedFile)) {
          const label = escapeRegExp(target.label)
          try {
            if (
              [
                new RegExp(`\\.${label}\\s*\\(`),
                new RegExp(`\\bnew\\s+${label}\\s*\\(`),
                new RegExp(`\\b${label}\\s*\\.`),
              ].some((p) => p.test(text))
            ) {
              pendingEdges.push({
                from: fn.node_id,
                to: target.id,
                meta: JSON.stringify({ type: 'cross_file', via: importedFile }),
              })
            }
          } catch {
            /* skip */
          }
        }
      }

      if (pendingEdges.length >= 500) {
        flush(pendingEdges.splice(0))
      }
    }
    if (pendingEdges.length > 0) flush(pendingEdges)
    return edgeCount
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
