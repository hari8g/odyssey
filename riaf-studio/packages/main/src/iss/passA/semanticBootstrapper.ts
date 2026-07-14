// packages/main/src/iss/passA/semanticBootstrapper.ts
import type Database from 'better-sqlite3'

function isTestPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  const p = filePath.replace(/\\/g, '/').toLowerCase()
  return (
    p.includes('/__tests__/') ||
    p.includes('/__mocks__/') ||
    p.includes('/test/') ||
    p.includes('/tests/') ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(p)
  )
}

export class SemanticBootstrapper {
  private readonly insert: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly _root: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, file_path, importance_score, created_at)
      VALUES (?, ?, ?, 'static_analysis', ?, 0.0, unixepoch() * 1000)
    `)
  }

  bootstrap(): { services: number; modules: number; extDeps: number } {
    let services = 0
    let modules = 0
    let extDeps = 0

    const serviceRows = this.db
      .prepare<[], { gn_id: number; name: string; file_path: string }>(
        `
      SELECT gn.id as gn_id, gn.label as name, gn.file_path
      FROM graph_nodes gn
      WHERE gn.kind = 'CLASS' AND (
        gn.label LIKE '%Service' OR gn.label LIKE '%Repository' OR
        gn.label LIKE '%Controller' OR gn.label LIKE '%Handler' OR
        gn.label LIKE '%Manager' OR gn.label LIKE '%Provider' OR
        gn.label LIKE '%Gateway' OR gn.label LIKE '%Client' OR
        gn.label LIKE '%Adapter'
      )
    `,
      )
      .all()
      .filter((r) => !isTestPath(r.file_path))

    const getDs = this.db.prepare<[string, string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'DOMAIN_SERVICE' AND label = ? AND file_path = ?`,
    )

    const batchServices = this.db.transaction(() => {
      for (const r of serviceRows) {
        if (!getDs.get(r.name, r.file_path)) {
          this.insert.run('DOMAIN_SERVICE', r.name, `Domain service: ${r.name}`, r.file_path)
          services++
        }
      }
    })
    batchServices()

    const dirRows = this.db
      .prepare<[], { dir: string }>(
        `
      SELECT DISTINCT
        CASE WHEN instr(file_path, '/') > 0
             THEN substr(file_path, 1, instr(file_path,'/')-1)
             ELSE file_path END as dir
      FROM file_metadata
      WHERE dir NOT IN ('node_modules','.git','dist','out','build','.riaf')
    `,
      )
      .all()

    const getModule = this.db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'MODULE' AND label = ?`,
    )
    const batchModules = this.db.transaction(() => {
      for (const { dir } of dirRows) {
        if (!dir || dir.startsWith('.')) continue
        if (!getModule.get(dir)) {
          this.insert.run('MODULE', dir, `Directory module: ${dir}/`, dir + '/')
          modules++
        }
      }
    })
    batchModules()

    const extRows = this.db
      .prepare<[], { to_module: string }>(
        'SELECT DISTINCT to_module FROM ucg_import_edges WHERE is_external = 1',
      )
      .all()

    const getExt = this.db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'EXTERNAL_DEPENDENCY' AND label = ?`,
    )
    const batchExt = this.db.transaction(() => {
      for (const { to_module } of extRows) {
        const pkg = to_module.startsWith('@')
          ? to_module.split('/').slice(0, 2).join('/')
          : to_module.split('/')[0]!
        if (!getExt.get(pkg)) {
          this.insert.run('EXTERNAL_DEPENDENCY', pkg, `External package: ${pkg}`, null)
          extDeps++
        }
      }
    })
    batchExt()

    return { services, modules, extDeps }
  }
}
