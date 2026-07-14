import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ScannedFile } from './workspaceScanner'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RESOLVER_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']

// ---------------------------------------------------------------------------
// Import patterns
// ---------------------------------------------------------------------------

type ImportPattern = {
  regex: RegExp
  /** Group index for the module/path string */
  moduleGroup: number
  edgeType: string
}

const IMPORT_PATTERNS: Record<string, ImportPattern[]> = {
  typescript: [
    // import { ... } from 'mod'  /  import * as x from 'mod'  /  import x from 'mod'
    { regex: /^\s*import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/m, moduleGroup: 1, edgeType: 'esm' },
    // export { ... } from 'mod'  /  export * from 'mod'
    { regex: /^\s*export\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/m, moduleGroup: 1, edgeType: 'esm' },
    // dynamic import('mod')
    { regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/m, moduleGroup: 1, edgeType: 'dynamic' },
    // require('mod')
    { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/m, moduleGroup: 1, edgeType: 'cjs' },
  ],
  javascript: [
    { regex: /^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/m, moduleGroup: 1, edgeType: 'esm' },
    { regex: /^\s*export\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/m, moduleGroup: 1, edgeType: 'esm' },
    { regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/m, moduleGroup: 1, edgeType: 'dynamic' },
    { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/m, moduleGroup: 1, edgeType: 'cjs' },
  ],
  python: [
    // from .module import ...  /  from module import ...
    { regex: /^\s*from\s+([\w.]+)\s+import\s+/m, moduleGroup: 1, edgeType: 'python' },
    // import module
    { regex: /^\s*import\s+([\w.]+)/m, moduleGroup: 1, edgeType: 'python' },
  ],
  java: [
    // import com.example.Class;
    { regex: /^\s*import\s+(?:static\s+)?([\w.]+);/m, moduleGroup: 1, edgeType: 'java' },
  ],
  go: [
    // import "package"
    { regex: /^\s*import\s+"([^"]+)"/m, moduleGroup: 1, edgeType: 'go' },
    // inside import block: \t"package"
    { regex: /^\s+"([^"]+)"/m, moduleGroup: 1, edgeType: 'go' },
    // aliased: alias "package"
    { regex: /^\s+\w+\s+"([^"]+)"/m, moduleGroup: 1, edgeType: 'go' },
  ],
  rust: [
    // use crate::foo::bar;  /  use std::collections::HashMap;
    { regex: /^\s*use\s+([\w:]+)/m, moduleGroup: 1, edgeType: 'rust' },
    // extern crate foo;
    { regex: /^\s*extern\s+crate\s+(\w+)/m, moduleGroup: 1, edgeType: 'rust' },
  ],
}

// ---------------------------------------------------------------------------
// ImportExtractor
// ---------------------------------------------------------------------------

type RawEdge = {
  fromFile: string
  toModule: string
  resolvedFile: string | null
  isExternal: boolean
  edgeType: string
}

export class ImportExtractor {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  extractAll(files: ScannedFile[], signal?: AbortSignal): void {
    // Build a set of all relative file paths for resolution lookups
    const fileSet = new Set(files.map((f) => f.relativePath))

    const deleteEdges = this.db.prepare(
      'DELETE FROM ucg_import_edges WHERE from_file = ?',
    )
    const insertEdge = this.db.prepare(`
      INSERT INTO ucg_import_edges (from_file, to_module, resolved_file, is_external, edge_type)
      VALUES (?, ?, ?, ?, ?)
    `)

    const processFile = this.db.transaction((f: ScannedFile) => {
      const abs = path.join(this.workspaceRoot, f.relativePath)
      let content: string
      try {
        content = fs.readFileSync(abs, 'utf8')
      } catch {
        return
      }

      const edges = this.extractEdges(content, f.relativePath, f.language, fileSet)

      deleteEdges.run(f.relativePath)
      for (const edge of edges) {
        insertEdge.run(
          edge.fromFile,
          edge.toModule,
          edge.resolvedFile,
          edge.isExternal ? 1 : 0,
          edge.edgeType,
        )
      }
    })

    for (const f of files) {
      if (signal?.aborted) break
      const patterns = IMPORT_PATTERNS[f.language]
      if (!patterns) continue
      processFile(f)
    }
  }

  private extractEdges(
    content: string,
    relativePath: string,
    language: string,
    fileSet: Set<string>,
  ): RawEdge[] {
    const patterns = IMPORT_PATTERNS[language]
    if (!patterns) return []

    const edges: RawEdge[] = []
    const seen = new Set<string>()
    const lines = content.split('\n')

    for (const line of lines) {
      for (const { regex, moduleGroup, edgeType } of patterns) {
        // Reset lastIndex for stateful regexes
        const localRegex = new RegExp(regex.source, regex.flags.replace('g', ''))
        const m = localRegex.exec(line)
        if (!m) continue

        const rawModule = m[moduleGroup]?.trim()
        if (!rawModule || rawModule === '') continue
        if (seen.has(rawModule)) continue
        seen.add(rawModule)

        const isRelative = isRelativePath(rawModule, language)
        const resolvedFile = isRelative
          ? resolveRelative(relativePath, rawModule, fileSet)
          : null
        const isExternal = !isRelative && resolvedFile === null

        edges.push({
          fromFile: relativePath,
          toModule: rawModule,
          resolvedFile,
          isExternal,
          edgeType,
        })
      }
    }

    return edges
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function isRelativePath(module: string, language: string): boolean {
  if (language === 'python') {
    // Python relative: starts with . or ..
    return module.startsWith('.')
  }
  if (language === 'rust') {
    // Rust: crate::, self::, super:: are "internal" but we treat them as non-relative
    return false
  }
  return module.startsWith('./') || module.startsWith('../')
}

function resolveRelative(
  fromRelative: string,
  modulePath: string,
  fileSet: Set<string>,
): string | null {
  const fromDir = path.dirname(fromRelative)
  const base = path.normalize(path.join(fromDir, modulePath)).replace(/\\/g, '/')

  // 1. Exact match (already has extension)
  if (fileSet.has(base)) return base

  // 2. Try each resolvable extension
  for (const ext of RESOLVER_EXTENSIONS) {
    const candidate = `${base}${ext}`
    if (fileSet.has(candidate)) return candidate
  }

  // 3. Directory index file
  for (const ext of RESOLVER_EXTENSIONS) {
    const candidate = `${base}/index${ext}`
    if (fileSet.has(candidate)) return candidate
  }

  // 4. Python: convert dot-notation to path (e.g. ".utils" -> "utils.py")
  if (modulePath.startsWith('.')) {
    const pyPath = path.join(fromDir, modulePath.replace(/^\.+/, '').replace(/\./g, '/'))
      .replace(/\\/g, '/')
    const pyCandidate = `${pyPath}.py`
    if (fileSet.has(pyCandidate)) return pyCandidate
    const pyInit = `${pyPath}/__init__.py`
    if (fileSet.has(pyInit)) return pyInit
  }

  return null
}
