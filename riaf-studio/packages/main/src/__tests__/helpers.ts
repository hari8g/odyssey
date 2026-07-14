import Database from 'better-sqlite3'
import { applyMigrations } from '../db/migrations'

export function makeTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

export function seedFile(
  db: Database.Database,
  filePath: string,
  language = 'typescript',
): number {
  const result = db
    .prepare(
      `INSERT INTO file_metadata(workspace_root, file_path, language, size_bytes, last_modified, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('/tmp/test', filePath, language, 100, Date.now(), 'abc123')
  return Number(result.lastInsertRowid)
}
