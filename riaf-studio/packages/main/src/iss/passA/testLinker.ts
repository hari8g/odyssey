// packages/main/src/iss/passA/testLinker.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const DESCRIBE_RE = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g
const IT_RE = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g

export class TestLinker {
  private readonly insert: Database.Statement
  private readonly edge: Database.Statement
  private readonly getNode: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, file_path, start_line, importance_score, created_at)
      VALUES (?, ?, ?, 'static_analysis', ?, ?, 0.0, unixepoch() * 1000)
    `)
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, ?, 'static_analysis', unixepoch() * 1000)
    `)
    this.getNode = db.prepare(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1',
    )
  }

  link(): { testNodes: number; testEdges: number } {
    let testNodes = 0
    let testEdges = 0
    const testFiles = this.db
      .prepare(`SELECT file_path FROM file_metadata
       WHERE file_path LIKE '%.spec.%' OR file_path LIKE '%.test.%'
          OR file_path LIKE '%__tests__%'`)
      .all() as { file_path: string }[]

    const batch = this.db.transaction(() => {
      for (const tf of testFiles) {
        this.insert.run(
          'TEST_SUITE',
          tf.file_path,
          `Test suite: ${path.basename(tf.file_path)}`,
          tf.file_path,
          1,
        )
        testNodes++
        const suite = this.getNode.get('TEST_SUITE', tf.file_path) as { id: number } | undefined
        if (!suite) continue

        const srcBase = tf.file_path
          .replace(/\.spec\.(ts|js|tsx|jsx)$/, '.$1')
          .replace(/\.test\.(ts|js|tsx|jsx)$/, '.$1')
        const srcNode = this.db
          .prepare(
            'SELECT id FROM graph_nodes WHERE file_path = ? AND kind IN ("CLASS","DOMAIN_SERVICE") LIMIT 1',
          )
          .get(srcBase) as { id: number } | undefined
        if (srcNode) {
          this.edge.run(suite.id, srcNode.id, 'TESTS', 0.85)
          testEdges++
        }

        const abs = path.join(this.root, tf.file_path)
        if (!fs.existsSync(abs)) continue
        const content = fs.readFileSync(abs, 'utf8')

        for (const re of [DESCRIBE_RE, IT_RE]) {
          re.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = re.exec(content)) !== null) {
            const label = m[1]!
            const line = content.slice(0, m.index).split('\n').length
            this.insert.run('TEST_CASE', label, `Test case: ${label}`, tf.file_path, line)
            testNodes++
            const tc = this.getNode.get('TEST_CASE', label) as { id: number } | undefined
            if (tc) {
              this.edge.run(suite.id, tc.id, 'TESTS', 1.0)
              testEdges++
            }
          }
        }
      }
    })
    batch()
    return { testNodes, testEdges }
  }
}
