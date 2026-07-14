// packages/main/src/iss/passA/symbolPromoter.ts
import type Database from 'better-sqlite3'

const KIND_MAP: Record<string, string> = {
  function: 'FUNCTION',
  class: 'CLASS',
  interface: 'INTERFACE',
  type: 'TYPE',
  enum: 'ENUM',
  const: 'FUNCTION',
}

export class SymbolPromoter {
  private readonly insert: Database.Statement
  private readonly exists: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         file_path, start_line, end_line, importance_score, symbol_id, file_id, created_at)
      VALUES (?, ?, ?, 'symbol', ?, ?, ?, ?, 0.0, ?, ?, unixepoch() * 1000)
    `)
    this.exists = db.prepare('SELECT id FROM graph_nodes WHERE symbol_id = ?')
  }

  promote(): number {
    const symbols = this.db
      .prepare<
        [],
        {
          id: number
          file_id: number
          file_path: string
          name: string
          kind: string
          start_line: number
          end_line: number
          docstring: string
        }
      >('SELECT id, file_id, file_path, name, kind, start_line, end_line, docstring FROM symbols')
      .all()

    let promoted = 0
    const batch = this.db.transaction((rows: typeof symbols) => {
      for (const s of rows) {
        if (this.exists.get(s.id)) continue
        this.insert.run(
          KIND_MAP[s.kind] ?? 'FUNCTION',
          s.name,
          s.docstring || null,
          String(s.id),
          s.file_path,
          s.start_line,
          s.end_line,
          s.id,
          s.file_id,
        )
        promoted++
      }
    })
    batch(symbols)
    return promoted
  }
}
