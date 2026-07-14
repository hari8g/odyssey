import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeTestDb, seedFile } from './helpers'
import { ImportExtractor } from '../indexer/importExtractor'
import type { ScannedFile } from '../indexer/workspaceScanner'
import type Database from 'better-sqlite3'

describe('ImportExtractor', () => {
  let db: Database.Database
  let tmpDir: string

  beforeEach(() => {
    db = makeTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riaf-imp-'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('extracts ESM and relative imports', () => {
    const files = [
      { rel: 'src/a.ts', body: `import { b } from './b'\nimport fs from 'fs'\n` },
      { rel: 'src/b.ts', body: `export const b = 1\n` },
    ]

    const scanned: ScannedFile[] = files.map((f) => {
      const abs = path.join(tmpDir, f.rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, f.body)
      seedFile(db, f.rel)
      return {
        absolutePath: abs,
        relativePath: f.rel,
        language: 'typescript',
        sizeBytes: f.body.length,
        lastModified: Date.now(),
        contentHash: 'x',
      }
    })

    new ImportExtractor(db, tmpDir).extractAll(scanned)

    const edges = db
      .prepare('SELECT from_file, to_module, resolved_file, is_external FROM ucg_import_edges')
      .all() as {
      from_file: string
      to_module: string
      resolved_file: string | null
      is_external: number
    }[]

    expect(edges.some((e) => e.to_module === './b' && e.is_external === 0)).toBe(true)
    expect(edges.some((e) => e.to_module === 'fs' && e.is_external === 1)).toBe(true)
  })
})
