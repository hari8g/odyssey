import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeTestDb, seedFile } from './helpers'
import { SymbolExtractor } from '../indexer/symbolExtractor'
import type { ScannedFile } from '../indexer/workspaceScanner'
import type Database from 'better-sqlite3'

describe('SymbolExtractor', () => {
  let db: Database.Database
  let tmpDir: string

  beforeEach(() => {
    db = makeTestDb()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'riaf-sym-'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('extracts functions, classes, and interfaces from TypeScript', () => {
    const rel = 'src/auth.ts'
    const abs = path.join(tmpDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const content = `
export interface IAuth { token: string }
export class AuthService {
  validate() {}
}
export function hashPassword(pw: string): string {
  return pw
}
export type AuthConfig = { secret: string }
`.trim()
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

    new SymbolExtractor(db, tmpDir).extractAll([file])

    const symbols = db
      .prepare('SELECT name, kind FROM symbols ORDER BY name')
      .all() as { name: string; kind: string }[]

    const names = symbols.map((s) => s.name)
    expect(names).toContain('AuthService')
    expect(names).toContain('hashPassword')
    expect(names).toContain('IAuth')
  })
})
