import { describe, it, expect } from 'vitest'
import { makeTestDb, seedFile } from './helpers'
import { SymbolPromoter } from '../iss/passA/symbolPromoter'
import { applyMigrations } from '../db/migrations'
import Database from 'better-sqlite3'

describe('SCHEMA_V2 / ISS migration', () => {
  it('creates feature_suggestions and iss_mining_meta', () => {
    const db = makeTestDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('feature_suggestions')
    expect(names).toContain('iss_mining_meta')
    expect(names).toContain('co_change_pairs')
    expect(names).toContain('sdlc_phase_summary')
    const ver = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number
    }
    expect(ver.version).toBeGreaterThanOrEqual(2)
    db.close()
  })

  it('is idempotent when re-applied', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyMigrations(db)
    applyMigrations(db)
    const ver = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number
    }
    expect(ver.version).toBe(2)
    db.close()
  })
})

describe('SymbolPromoter', () => {
  it('promotes symbols to CLASS / FUNCTION graph nodes', () => {
    const db = makeTestDb()
    const fileId = seedFile(db, 'src/PaymentService.ts')
    db.prepare(
      `INSERT INTO symbols(file_id, file_path, name, kind, start_line, end_line, docstring, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      fileId,
      'src/PaymentService.ts',
      'PaymentService',
      'class',
      1,
      40,
      'Handles payments',
      'h1',
    )
    db.prepare(
      `INSERT INTO symbols(file_id, file_path, name, kind, start_line, end_line, docstring, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(fileId, 'src/PaymentService.ts', 'charge', 'function', 10, 20, '', 'h2')

    const promoted = new SymbolPromoter(db).promote()
    expect(promoted).toBe(2)

    const kinds = db
      .prepare(`SELECT kind, COUNT(*) as n FROM graph_nodes GROUP BY kind`)
      .all() as { kind: string; n: number }[]
    const map = Object.fromEntries(kinds.map((k) => [k.kind, k.n]))
    expect(map['CLASS']).toBe(1)
    expect(map['FUNCTION']).toBe(1)

    // Idempotent
    expect(new SymbolPromoter(db).promote()).toBe(0)
    db.close()
  })
})
