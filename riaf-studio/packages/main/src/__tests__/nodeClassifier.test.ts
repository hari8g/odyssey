import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTestDb, seedFile } from './helpers'
import { NodeClassifier } from '../indexer/nodeClassifier'
import type { ScannedFile } from '../indexer/workspaceScanner'
import type Database from 'better-sqlite3'

describe('NodeClassifier', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('classifies test, service, and component paths', () => {
    const paths = [
      'src/services/auth.service.ts',
      'src/components/Button.tsx',
      'src/utils/math.ts',
      'src/foo.spec.ts',
      'src/index.ts',
    ]
    for (const p of paths) seedFile(db, p)

    const files: ScannedFile[] = paths.map((p) => ({
      absolutePath: `/tmp/${p}`,
      relativePath: p,
      language: 'typescript',
      sizeBytes: 10,
      lastModified: Date.now(),
      contentHash: 'x',
    }))

    new NodeClassifier(db).classifyAll(files)

    const nodes = db
      .prepare('SELECT file_path, node_type, arch_layer FROM ucg_file_nodes')
      .all() as { file_path: string; node_type: string; arch_layer: string }[]

    const byPath = Object.fromEntries(nodes.map((n) => [n.file_path, n]))
    expect(nodes).toHaveLength(5)
    expect(byPath['src/foo.spec.ts']?.node_type).toMatch(/test/i)
    expect(byPath['src/services/auth.service.ts']?.node_type).toMatch(/service/i)
    expect(byPath['src/index.ts']).toBeDefined()
  })
})
