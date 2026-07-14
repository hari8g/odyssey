// packages/main/src/iss/passA/interfaceLinker.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const CLASS_RE =
  /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s<>]+))?/gm

export class InterfaceLinker {
  private readonly edge: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 0.95, 'static_analysis', unixepoch() * 1000)
    `)
  }

  link(): number {
    let count = 0
    const nameMap = new Map<string, number>()
    for (const n of this.db
      .prepare<[], { id: number; label: string }>(
        `SELECT id, label FROM graph_nodes WHERE kind IN ('CLASS','INTERFACE')`,
      )
      .all()) {
      nameMap.set(n.label, n.id)
    }

    const tsFiles = this.db
      .prepare<[], { file_path: string }>(
        `SELECT file_path FROM file_metadata WHERE language IN ('typescript','javascript')`,
      )
      .all()

    const pending: { from: number; to: number; kind: string }[] = []

    for (const tf of tsFiles) {
      const abs = path.join(this.root, tf.file_path)
      if (!fs.existsSync(abs)) continue
      const content = fs.readFileSync(abs, 'utf8')
      CLASS_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CLASS_RE.exec(content)) !== null) {
        const fromId = m[1] ? nameMap.get(m[1]) : undefined
        if (!fromId) continue
        if (m[2]) {
          const toId = nameMap.get(m[2])
          if (toId) pending.push({ from: fromId, to: toId, kind: 'INHERITS' })
        }
        if (m[3]) {
          for (const iface of m[3].split(',').map((s) => s.replace(/<.*>/, '').trim())) {
            const toId = nameMap.get(iface)
            if (toId) pending.push({ from: fromId, to: toId, kind: 'IMPLEMENTS_INTERFACE' })
          }
        }
      }
    }

    const batch = this.db.transaction(() => {
      for (const r of pending) {
        this.edge.run(r.from, r.to, r.kind)
        count++
      }
    })
    batch()
    return count
  }
}
