import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTestDb } from './helpers'
import { GraphAnalyzer } from '../indexer/graphAnalyzer'
import type Database from 'better-sqlite3'

describe('GraphAnalyzer', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('detects a 3-node import cycle and computes hot files', () => {
    const nodes = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    const upsert = db.prepare(
      `INSERT INTO ucg_file_nodes(file_path, language, node_type, arch_layer)
       VALUES (?, 'typescript', 'util', 'domain')`,
    )
    for (const n of nodes) upsert.run(n)

    const edge = db.prepare(
      `INSERT INTO ucg_import_edges(from_file, to_module, resolved_file, is_external, edge_type)
       VALUES (?, ?, ?, 0, 'esm')`,
    )
    // cycle a → b → c → a
    edge.run('a.ts', './b', 'b.ts')
    edge.run('b.ts', './c', 'c.ts')
    edge.run('c.ts', './a', 'a.ts')
    // d imports a (fan-in on a)
    edge.run('d.ts', './a', 'a.ts')

    new GraphAnalyzer(db).analyze()

    const metrics = db
      .prepare('SELECT cycle_count, hot_files_json, total_nodes, total_edges FROM ucg_graph_metrics WHERE id = 1')
      .get() as {
      cycle_count: number
      hot_files_json: string
      total_nodes: number
      total_edges: number
    }

    expect(metrics.total_nodes).toBe(4)
    expect(metrics.total_edges).toBe(4)
    expect(metrics.cycle_count).toBeGreaterThanOrEqual(1)
    const hot = JSON.parse(metrics.hot_files_json) as string[]
    expect(hot[0]).toBe('a.ts')
  })
})
