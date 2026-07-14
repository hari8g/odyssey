import Database from 'better-sqlite3'
import fg from 'fast-glob'
import ignore from 'ignore'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INDEXABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'hpp', 'cs', 'swift', 'kt', 'rb', 'php', 'scala',
  'json', 'yaml', 'yml', 'toml', 'xml', 'md', 'sql', 'sh', 'bash', 'zsh',
  'css', 'scss', 'html', 'vue', 'svelte',
])

export const ALWAYS_IGNORE = [
  'node_modules',
  '.pnpm',
  '.git',
  'dist',
  'build',
  'out',
  '.riaf',
  '__pycache__',
  'target',
  'vendor',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.parcel-cache',
  'tmp',
  'temp',
  '.DS_Store',
  'Thumbs.db',
]

/** True when a path should be skipped during scan/watch (gitignore optional). */
export function isIgnoredWorkspacePath(
  workspaceRoot: string,
  targetPath: string,
  gitignore?: ReturnType<typeof ignore>,
): boolean {
  const abs = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(workspaceRoot, targetPath)
  const rel = path.relative(workspaceRoot, abs).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..')) return true

  const segments = rel.split('/')
  if (ALWAYS_IGNORE.some((name) => segments.includes(name))) return true
  if (gitignore?.ignores(rel)) return true

  return false
}

// Glob patterns passed to fast-glob for fast rejection before stat calls
const ALWAYS_IGNORE_GLOBS = [
  ...ALWAYS_IGNORE.map((p) => `**/${p}/**`),
  ...ALWAYS_IGNORE.map((p) => `**/${p}`),
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.lock',
]

export const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  scala: 'scala',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  md: 'markdown',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  css: 'css',
  scss: 'scss',
  html: 'html',
  vue: 'vue',
  svelte: 'svelte',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScannedFile = {
  absolutePath: string
  relativePath: string
  language: string
  sizeBytes: number
  lastModified: number
  contentHash: string
}

// ---------------------------------------------------------------------------
// WorkspaceScanner
// ---------------------------------------------------------------------------

const HASH_PEEK_BYTES = 8 * 1024

export class WorkspaceScanner {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  async scan(signal?: AbortSignal): Promise<ScannedFile[]> {
    const ig = ignore()

    // Respect .gitignore when present
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore')
    if (fs.existsSync(gitignorePath)) {
      try {
        ig.add(fs.readFileSync(gitignorePath, 'utf8'))
      } catch {
        // Non-fatal: proceed without .gitignore
      }
    }

    const extPattern = `**/*.{${[...INDEXABLE_EXTENSIONS].join(',')}}`

    const entries = await fg(extPattern, {
      cwd: this.workspaceRoot,
      absolute: false,
      dot: true,
      ignore: ALWAYS_IGNORE_GLOBS,
      onlyFiles: true,
      followSymbolicLinks: false,
      suppressErrors: true,
    })

    const upsert = this.db.prepare(`
      INSERT INTO file_metadata (workspace_root, file_path, language, size_bytes, last_modified, content_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_root, file_path) DO UPDATE SET
        language       = excluded.language,
        size_bytes     = excluded.size_bytes,
        last_modified  = excluded.last_modified,
        content_hash   = excluded.content_hash
    `)

    const upsertBatch = this.db.transaction((batch: ScannedFile[]) => {
      for (const f of batch) {
        upsert.run(
          this.workspaceRoot,
          f.relativePath,
          f.language,
          f.sizeBytes,
          f.lastModified,
          f.contentHash,
        )
      }
    })

    const scanned: ScannedFile[] = []

    for (const rel of entries) {
      if (signal?.aborted) break
      // Secondary filter via ignore package (handles .gitignore patterns)
      if (isIgnoredWorkspacePath(this.workspaceRoot, rel, ig)) continue

      const abs = path.join(this.workspaceRoot, rel)
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        continue
      }

      const ext = path.extname(abs).slice(1).toLowerCase()
      const language = LANGUAGE_MAP[ext] ?? 'unknown'
      const contentHash = hashFilePeek(abs)

      scanned.push({
        absolutePath: abs,
        relativePath: rel,
        language,
        sizeBytes: stat.size,
        lastModified: Math.floor(stat.mtimeMs),
        contentHash,
      })
    }

    upsertBatch(scanned)
    return scanned
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashFilePeek(filePath: string): string {
  const buf = Buffer.alloc(HASH_PEEK_BYTES)
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const bytesRead = fs.readSync(fd, buf, 0, HASH_PEEK_BYTES, 0)
    return crypto.createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  }
}
