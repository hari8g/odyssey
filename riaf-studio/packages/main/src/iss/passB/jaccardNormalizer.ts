// packages/main/src/iss/passB/jaccardNormalizer.ts
import type Database from 'better-sqlite3'

export class JaccardNormalizer {
  constructor(private readonly db: Database.Database) {}

  normalize(): number {
    const pairs = this.db
      .prepare<
        [],
        {
          file_a: string
          file_b: string
          co_count: number
          count_a: number
          count_b: number
        }
      >(
        `
      SELECT cp.file_a, cp.file_b, cp.co_count,
             COALESCE(fca.change_count, 1) as count_a,
             COALESCE(fcb.change_count, 1) as count_b
      FROM co_change_pairs cp
      LEFT JOIN file_change_counts fca ON fca.file_path = cp.file_a
      LEFT JOIN file_change_counts fcb ON fcb.file_path = cp.file_b
    `,
      )
      .all()

    const upsert = this.db.prepare(`
      INSERT INTO co_change_pairs(file_a, file_b, co_count) VALUES (?, ?, ?)
      ON CONFLICT(file_a, file_b) DO UPDATE SET co_count = excluded.co_count
    `)

    let above = 0
    const batch = this.db.transaction(() => {
      for (const p of pairs) {
        const denom = p.count_a + p.count_b - p.co_count
        if (denom <= 0) continue
        const jaccard = p.co_count / denom
        if (jaccard >= 0.3) {
          upsert.run(p.file_a, p.file_b, Math.round(jaccard * 1000))
          above++
        }
      }
    })
    batch()
    return above
  }
}
