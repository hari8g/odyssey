import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { applyMigrations } from './migrations'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('DB not initialized — call initDb(workspaceRoot) first')
  return _db
}

/**
 * Opens (or creates) the per-workspace SQLite database.
 * Location: <workspaceRoot>/.riaf/riaf.db
 */
export function initDb(workspaceRoot: string): Database.Database {
  const riafDir = path.join(workspaceRoot, '.riaf')
  fs.mkdirSync(riafDir, { recursive: true })

  const dbPath = path.join(riafDir, 'riaf.db')
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -32000')
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456')

  applyMigrations(db)

  _db = db
  return db
}

/** In-memory DB for tests */
export function initMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  _db = db
  return db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
