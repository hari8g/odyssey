import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChunkType } from '@shared/index'
import type { ScannedFile } from './workspaceScanner'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHUNK_MAX_LINES = 80
export const CHUNK_OVERLAP = 10
export const CHUNK_MIN_LINES = 4
export const MAX_FILE_BYTES = 1e6

// ---------------------------------------------------------------------------
// Boundary patterns
// ---------------------------------------------------------------------------

type BoundaryPattern = {
  regex: RegExp
  type: ChunkType
}

const PATTERNS: Record<string, BoundaryPattern[]> = {
  typescript: [
    { regex: /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+\w/, type: 'class' },
    { regex: /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*\w/, type: 'function' },
    {
      regex: /^\s*(export\s+)?(const|let|var)\s+\w+\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(\(|function\b)/,
      type: 'function',
    },
  ],
  javascript: [
    { regex: /^\s*(export\s+)?(default\s+)?(class\s+\w|class\s*\{)/, type: 'class' },
    { regex: /^\s*(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*\w/, type: 'function' },
    {
      regex: /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\(|function\b)/,
      type: 'function',
    },
    { regex: /^\s*module\.exports\s*=\s*(function\b|\()/, type: 'function' },
  ],
  python: [
    { regex: /^class\s+\w/, type: 'class' },
    { regex: /^(async\s+)?def\s+\w/, type: 'function' },
    { regex: /^    (async\s+)?def\s+\w/, type: 'function' },
  ],
  java: [
    {
      regex: /^\s*(public|private|protected|static|final|abstract|native|synchronized)(\s+(public|private|protected|static|final|abstract|native|synchronized))*\s+(class|interface|enum|@interface)\s+\w/,
      type: 'class',
    },
    {
      regex: /^\s*(public|private|protected|static|final|abstract|native|synchronized)(\s+(public|private|protected|static|final|abstract|native|synchronized))*\s+\w[\w<>,\[\]\s]*\s+\w+\s*\(/,
      type: 'function',
    },
  ],
  go: [
    { regex: /^type\s+\w+\s+(struct|interface)\s*\{/, type: 'class' },
    { regex: /^func\s+(\(\w[\w\s*]*\)\s+)?\w+\s*\(/, type: 'function' },
  ],
  rust: [
    { regex: /^\s*(pub\s+)?(struct|enum|impl(\s+\w+\s+for)?\s+\w+|trait)\s+\w/, type: 'class' },
    { regex: /^\s*(pub\s+)?(async\s+)?fn\s+\w/, type: 'function' },
  ],
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RawChunk = {
  text: string
  startLine: number
  endLine: number
  type: ChunkType
}

type ProgressCallback = (done: number, total: number) => void

// ---------------------------------------------------------------------------
// CodeChunker
// ---------------------------------------------------------------------------

export class CodeChunker {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  chunkAll(files: ScannedFile[], signal?: AbortSignal, progress?: ProgressCallback): void {
    const getFileId = this.db.prepare<[string], { id: number }>(
      'SELECT id FROM file_metadata WHERE file_path = ?',
    )
    const deleteChunks = this.db.prepare('DELETE FROM code_chunks WHERE file_id = ?')
    const insertChunk = this.db.prepare(`
      INSERT INTO code_chunks (id, file_id, file_path, chunk_text, start_line, end_line, chunk_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const processFile = this.db.transaction((f: ScannedFile) => {
      const row = getFileId.get(f.relativePath)
      if (!row) return

      const abs = path.join(this.workspaceRoot, f.relativePath)
      let content: string
      try {
        const stat = fs.statSync(abs)
        if (stat.size > MAX_FILE_BYTES) return
        content = fs.readFileSync(abs, 'utf8')
      } catch {
        return
      }

      const lines = content.split('\n')
      const patterns = PATTERNS[f.language] ?? []
      const chunks =
        patterns.length > 0
          ? chunkByBoundaries(lines, patterns)
          : slidingWindow(lines, 'block')

      deleteChunks.run(row.id)
      for (const chunk of chunks) {
        insertChunk.run(
          randomUUID(),
          row.id,
          f.relativePath,
          chunk.text,
          chunk.startLine,
          chunk.endLine,
          chunk.type,
        )
      }
    })

    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) break
      const f = files[i]
      if (f) processFile(f)
      progress?.(i + 1, files.length)
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking helpers
// ---------------------------------------------------------------------------

function chunkByBoundaries(lines: string[], patterns: BoundaryPattern[]): RawChunk[] {
  // Collect boundary line indices
  const boundaries: Array<{ lineIdx: number; type: ChunkType }> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    for (const { regex, type } of patterns) {
      if (regex.test(line)) {
        boundaries.push({ lineIdx: i, type })
        break
      }
    }
  }

  if (boundaries.length === 0) return slidingWindow(lines, 'block')

  const chunks: RawChunk[] = []

  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b]!.lineIdx
    const end =
      b + 1 < boundaries.length
        ? boundaries[b + 1]!.lineIdx - 1
        : lines.length - 1
    const type = boundaries[b]!.type
    const spanLines = end - start + 1

    if (spanLines < CHUNK_MIN_LINES) continue

    if (spanLines <= CHUNK_MAX_LINES) {
      chunks.push({
        text: lines.slice(start, end + 1).join('\n'),
        startLine: start + 1,
        endLine: end + 1,
        type,
      })
    } else {
      // Oversized boundary region: apply sliding window within it
      const sub = slidingWindow(lines.slice(start, end + 1), type)
      for (const c of sub) {
        chunks.push({
          ...c,
          startLine: c.startLine + start,
          endLine: c.endLine + start,
        })
      }
    }
  }

  return chunks.length > 0 ? chunks : slidingWindow(lines, 'block')
}

function slidingWindow(lines: string[], type: ChunkType = 'block'): RawChunk[] {
  const chunks: RawChunk[] = []
  let start = 0

  while (start < lines.length) {
    const end = Math.min(start + CHUNK_MAX_LINES - 1, lines.length - 1)
    const span = end - start + 1

    if (span >= CHUNK_MIN_LINES) {
      chunks.push({
        text: lines.slice(start, end + 1).join('\n'),
        startLine: start + 1,
        endLine: end + 1,
        type,
      })
    }

    // Advance with overlap; guard against infinite loop
    const nextStart = end - CHUNK_OVERLAP + 1
    start = nextStart > start ? nextStart : end + 1
  }

  return chunks
}
