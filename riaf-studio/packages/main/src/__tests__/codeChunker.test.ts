import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeTestDb, seedFile } from './helpers'
import { CodeChunker } from '../indexer/codeChunker'
import type { ScannedFile } from '../indexer/workspaceScanner'
import type Database from 'better-sqlite3'

describe('CodeChunker', () => {
  let db: Database.Database
  let tmpDir: string

  beforeEach(() => {
    db = makeTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riaf-chunk-'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('chunks a TypeScript file at function boundaries', () => {
    const rel = 'src/math.ts'
    const abs = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const content = [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export function sub(a: number, b: number): number {',
      '  return a - b',
      '}',
      '',
      'export class Calc {',
      '  mul(a: number, b: number) { return a * b }',
      '}',
    ].join('\n')
    fs.writeFileSync(abs, content)

    seedFile(db, rel)
    const file: ScannedFile = {
      absolutePath: abs,
      relativePath: rel,
      language: 'typescript',
      sizeBytes: content.length,
      lastModified: Date.now(),
      contentHash: 'x',
    }

    new CodeChunker(db, tmpDir).chunkAll([file])

    const chunks = db
      .prepare('SELECT chunk_type, start_line, end_line FROM code_chunks ORDER BY start_line')
      .all() as { chunk_type: string; start_line: number; end_line: number }[]

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.some((c) => c.chunk_type === 'function' || c.chunk_type === 'class')).toBe(true)
  })
})
