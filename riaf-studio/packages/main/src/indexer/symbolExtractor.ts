import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { SymbolKind } from '@shared/index'
import type { ScannedFile } from './workspaceScanner'

// ---------------------------------------------------------------------------
// Symbol patterns
// ---------------------------------------------------------------------------

type SymbolPattern = {
  regex: RegExp
  kind: SymbolKind
  /** Capture group index (1-based) for the symbol name */
  nameGroup: number
  /** Capture group index (1-based) for the full signature, or 0 to use entire match */
  signatureGroup: number
  /** Capture group index (1-based) that indicates export, or 0 if always exported */
  exportGroup: number
}

const SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  typescript: [
    // class
    {
      regex: /^(\s*)(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)([^{]*)/,
      kind: 'class',
      nameGroup: 5,
      signatureGroup: 6,
      exportGroup: 2,
    },
    // interface
    {
      regex: /^(\s*)(export\s+)?interface\s+(\w+)([^{]*)/,
      kind: 'interface',
      nameGroup: 3,
      signatureGroup: 4,
      exportGroup: 2,
    },
    // type alias
    {
      regex: /^(\s*)(export\s+)?type\s+(\w+)(\s*<[^=]*>)?\s*=/,
      kind: 'type',
      nameGroup: 3,
      signatureGroup: 4,
      exportGroup: 2,
    },
    // enum
    {
      regex: /^(\s*)(export\s+)?(const\s+)?enum\s+(\w+)/,
      kind: 'enum',
      nameGroup: 4,
      signatureGroup: 0,
      exportGroup: 2,
    },
    // function declaration
    {
      regex: /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s+(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 5,
      signatureGroup: 6,
      exportGroup: 2,
    },
    // arrow / const function
    {
      regex: /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(\([^)]*\)|\w+)\s*=>/,
      kind: 'function',
      nameGroup: 4,
      signatureGroup: 6,
      exportGroup: 2,
    },
    // const non-function (fallback)
    {
      regex: /^(\s*)(export\s+)?(const)\s+(\w+)\s*(?::\s*[^=]+)?\s*=/,
      kind: 'const',
      nameGroup: 4,
      signatureGroup: 0,
      exportGroup: 2,
    },
  ],
  javascript: [
    {
      regex: /^(\s*)(export\s+)?(default\s+)?(class\s+(\w+))/,
      kind: 'class',
      nameGroup: 5,
      signatureGroup: 4,
      exportGroup: 2,
    },
    {
      regex: /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s+(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 5,
      signatureGroup: 6,
      exportGroup: 2,
    },
    {
      regex: /^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?(\([^)]*\)|\w+)\s*=>/,
      kind: 'function',
      nameGroup: 4,
      signatureGroup: 6,
      exportGroup: 2,
    },
    {
      regex: /^(\s*)(export\s+)?(const)\s+(\w+)\s*=/,
      kind: 'const',
      nameGroup: 4,
      signatureGroup: 0,
      exportGroup: 2,
    },
    {
      regex: /^(\s*)module\.exports\.(\w+)\s*=\s*(async\s+)?function\s*\*?\s*\(/,
      kind: 'function',
      nameGroup: 2,
      signatureGroup: 0,
      exportGroup: 0,
    },
  ],
  python: [
    {
      regex: /^(class)\s+(\w+)(\([^)]*\))?:/,
      kind: 'class',
      nameGroup: 2,
      signatureGroup: 3,
      exportGroup: 0,
    },
    {
      regex: /^(async\s+)?def\s+(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 2,
      signatureGroup: 3,
      exportGroup: 0,
    },
    // class method (indented)
    {
      regex: /^    (async\s+)?def\s+(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 2,
      signatureGroup: 3,
      exportGroup: 0,
    },
  ],
  java: [
    {
      regex: /^\s*(public\s+)?(abstract\s+|final\s+)?(class|interface|enum)\s+(\w+)/,
      kind: 'class',
      nameGroup: 4,
      signatureGroup: 0,
      exportGroup: 1,
    },
    {
      regex:
        /^\s*(public|private|protected)\s+(static\s+)?(final\s+)?(async\s+)?[\w<>,\[\]]+\s+(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 5,
      signatureGroup: 6,
      exportGroup: 1,
    },
  ],
  go: [
    {
      regex: /^type\s+(\w+)\s+(struct|interface)\s*\{/,
      kind: 'class',
      nameGroup: 1,
      signatureGroup: 0,
      exportGroup: 0,
    },
    {
      regex: /^func\s+(\(\w[\w\s*]*\)\s+)?(\w+)\s*(\([^)]*\))/,
      kind: 'function',
      nameGroup: 2,
      signatureGroup: 3,
      exportGroup: 0,
    },
  ],
}

// ---------------------------------------------------------------------------
// Extracted symbol (internal)
// ---------------------------------------------------------------------------

type ExtractedSymbolRaw = {
  name: string
  kind: SymbolKind
  startLine: number
  endLine: number
  signature: string
  docstring: string
  isExported: boolean
  contentHash: string
}

// ---------------------------------------------------------------------------
// SymbolExtractor
// ---------------------------------------------------------------------------

export class SymbolExtractor {
  private readonly db: Database.Database
  private readonly workspaceRoot: string

  constructor(db: Database.Database, workspaceRoot: string) {
    this.db = db
    this.workspaceRoot = workspaceRoot
  }

  extractAll(files: ScannedFile[], signal?: AbortSignal): void {
    const getFileId = this.db.prepare<[string], { id: number }>(
      'SELECT id FROM file_metadata WHERE file_path = ?',
    )
    const deleteSymbols = this.db.prepare('DELETE FROM symbols WHERE file_id = ?')
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols
        (file_id, file_path, name, kind, start_line, end_line, signature, docstring, is_exported, content_hash)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const processFile = this.db.transaction((f: ScannedFile) => {
      const row = getFileId.get(f.relativePath)
      if (!row) return

      const abs = path.join(this.workspaceRoot, f.relativePath)
      let content: string
      try {
        content = fs.readFileSync(abs, 'utf8')
      } catch {
        return
      }

      const symbols = this.extractFromContent(content, f.language)

      deleteSymbols.run(row.id)
      for (const s of symbols) {
        insertSymbol.run(
          row.id,
          f.relativePath,
          s.name,
          s.kind,
          s.startLine,
          s.endLine,
          s.signature,
          s.docstring,
          s.isExported ? 1 : 0,
          s.contentHash,
        )
      }
    })

    for (const f of files) {
      if (signal?.aborted) break
      const patterns = SYMBOL_PATTERNS[f.language]
      if (!patterns) continue
      processFile(f)
    }
  }

  extractFromContent(content: string, language: string): ExtractedSymbolRaw[] {
    const patterns = SYMBOL_PATTERNS[language]
    if (!patterns) return []

    const lines = content.split('\n')
    const symbols: ExtractedSymbolRaw[] = []
    const seen = new Set<string>() // deduplicate by name+line

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''

      for (const pat of patterns) {
        const m = pat.regex.exec(line)
        if (!m) continue

        const name = m[pat.nameGroup]?.trim()
        if (!name || name === '') continue

        // Avoid duplicate matches on same line from multiple patterns
        const key = `${name}:${i}`
        if (seen.has(key)) continue
        seen.add(key)

        const sigRaw =
          pat.signatureGroup > 0
            ? (m[pat.signatureGroup]?.trim() ?? '')
            : ''
        const signature = sigRaw ? `${name}${sigRaw}` : name

        const isExported =
          pat.exportGroup === 0
            ? language !== 'python' // Python: everything in top-level is "exported" by convention
            : Boolean(m[pat.exportGroup])

        const endLine = findBlockEnd(lines, i)
        const docstring = this.extractDocstring(lines, i, language)
        const blockText = lines.slice(i, endLine + 1).join('\n')
        const contentHash = crypto.createHash('sha256').update(blockText).digest('hex')

        symbols.push({
          name,
          kind: pat.kind,
          startLine: i + 1,
          endLine: endLine + 1,
          signature,
          docstring,
          isExported,
          contentHash,
        })
        break // Only match first pattern per line
      }
    }

    return symbols
  }

  extractDocstring(lines: string[], symbolLineIdx: number, language: string): string {
    if (language === 'python') {
      return extractPythonDocstring(lines, symbolLineIdx)
    }
    return extractJsDocstring(lines, symbolLineIdx)
  }
}

// ---------------------------------------------------------------------------
// Block end heuristic
// ---------------------------------------------------------------------------

function findBlockEnd(lines: string[], startIdx: number): number {
  // Very rough heuristic: scan forward for the matching closing brace
  // or a blank line followed by non-indented content (Python).
  let depth = 0
  let foundOpen = false

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i] ?? ''
    for (const ch of line) {
      if (ch === '{') { depth++; foundOpen = true }
      else if (ch === '}') { depth-- }
    }
    if (foundOpen && depth <= 0) return Math.min(i, startIdx + 300)
  }

  // Python / no-brace: use indentation to find end
  if (!foundOpen) {
    const baseIndent = indentLevel(lines[startIdx] ?? '')
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i] ?? ''
      if (l.trim() === '') continue
      if (indentLevel(l) <= baseIndent) return i - 1
    }
  }

  return Math.min(startIdx + 80, lines.length - 1)
}

function indentLevel(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 4
    else break
  }
  return n
}

// ---------------------------------------------------------------------------
// Docstring extraction
// ---------------------------------------------------------------------------

function extractJsDocstring(lines: string[], symbolLineIdx: number): string {
  // Walk backwards from symbolLineIdx to find /** ... */ block
  let end = symbolLineIdx - 1
  // Skip decorator / blank lines
  while (end >= 0 && /^\s*(@\w+|\/\/.*)?$/.test(lines[end] ?? '')) end--

  if (end < 0) return ''
  const endLine = lines[end] ?? ''
  if (!endLine.trimEnd().endsWith('*/')) return ''

  // Walk back to find opening /**
  let start = end
  while (start >= 0 && !(lines[start] ?? '').trimStart().startsWith('/**')) {
    start--
  }
  if (start < 0) return ''

  return lines
    .slice(start, end + 1)
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .filter((l) => !l.startsWith('/**') && !l.startsWith('*/') && !l.startsWith('*'))
    .join(' ')
    .trim()
    || lines
      .slice(start, end + 1)
      .map((l) => l.replace(/^\s*\/?\*+\/?/, '').trim())
      .join(' ')
      .trim()
}

function extractPythonDocstring(lines: string[], symbolLineIdx: number): string {
  // Look for triple-quoted string on the line(s) immediately after the def/class
  const bodyStart = symbolLineIdx + 1
  if (bodyStart >= lines.length) return ''

  const firstLine = (lines[bodyStart] ?? '').trim()
  const tripleDouble = '"""'
  const tripleSingle = "'''"

  const quote = firstLine.startsWith(tripleDouble)
    ? tripleDouble
    : firstLine.startsWith(tripleSingle)
      ? tripleSingle
      : null

  if (!quote) return ''

  const inner = firstLine.slice(quote.length)
  if (inner.includes(quote)) {
    // Single-line docstring
    return inner.slice(0, inner.indexOf(quote)).trim()
  }

  // Multi-line docstring
  const parts: string[] = [inner]
  for (let i = bodyStart + 1; i < lines.length && i < bodyStart + 30; i++) {
    const l = lines[i] ?? ''
    const closeIdx = l.indexOf(quote)
    if (closeIdx !== -1) {
      parts.push(l.slice(0, closeIdx).trim())
      break
    }
    parts.push(l.trim())
  }

  return parts.filter(Boolean).join(' ').trim()
}
