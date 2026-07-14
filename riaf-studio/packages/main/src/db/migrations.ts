import type Database from 'better-sqlite3'
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from './schema'

interface Migration {
  version: number
  up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(SCHEMA_V1)
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(SCHEMA_V2)
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(SCHEMA_V3)
    },
  },
]

/** Ensure a single-row schema_version table (legacy DBs used version as PK and could get duplicate rows). */
function ensureSchemaVersionTable(db: Database.Database): void {
  const table = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`)
    .get() as { sql: string } | undefined

  const isLegacy = table?.sql && !table.sql.includes('id INTEGER PRIMARY KEY')

  if (isLegacy) {
    const legacy = db
      .prepare('SELECT MAX(version) AS v FROM schema_version')
      .get() as { v: number | null } | undefined
    const version = legacy?.v ?? 0
    db.exec('DROP TABLE schema_version')
    db.exec(`
      CREATE TABLE schema_version (
        id      INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL DEFAULT 0
      )
    `)
    db.prepare('INSERT INTO schema_version(id, version) VALUES (1, ?)').run(version)
    return
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    )
  `)
  db.exec(`INSERT OR IGNORE INTO schema_version(id, version) VALUES (1, 0)`)
}

export function applyMigrations(db: Database.Database): void {
  ensureSchemaVersionTable(db)

  const row = db
    .prepare('SELECT version FROM schema_version WHERE id = 1')
    .get() as { version: number } | undefined

  const current = row?.version ?? 0
  const pending = MIGRATIONS.filter((m) => m.version > current)

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(migration.version)
    }
  })

  if (pending.length > 0) {
    runAll()
  }
}
