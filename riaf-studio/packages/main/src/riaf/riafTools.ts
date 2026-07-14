// packages/main/src/riaf/riafTools.ts

import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { LLMTool } from '../llm/llmProvider.interface'

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------

export type ToolPlugin = {
  tool: LLMTool
  execute: (
    input: Record<string, unknown>,
    db: Database.Database,
    root: string,
  ) => Promise<string>
}

const pluginRegistry: ToolPlugin[] = []

export function registerToolPlugin(plugin: ToolPlugin): void {
  const existing = pluginRegistry.findIndex((p) => p.tool.name === plugin.tool.name)
  if (existing >= 0) {
    pluginRegistry[existing] = plugin
  } else {
    pluginRegistry.push(plugin)
  }
}

export function getAllTools(): LLMTool[] {
  return [...buildRiafTools(), ...pluginRegistry.map((p) => p.tool)]
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function buildRiafTools(): LLMTool[] {
  return [
    {
      name: 'read_file',
      description:
        'Read the full text content of a file relative to the workspace root. Returns line-numbered content.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path from workspace root' },
          start_line: {
            type: 'number',
            description: 'First line to return (1-based, optional)',
          },
          end_line: {
            type: 'number',
            description: 'Last line to return inclusive (optional)',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'search_codebase',
      description:
        'Full-text search across all indexed code chunks using SQLite FTS5. Returns matching snippets with file paths and line ranges.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (FTS5 syntax supported)' },
          limit: {
            type: 'number',
            description: 'Max results to return (default 10, max 50)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_symbols',
      description:
        'Search the symbol index (functions, classes, types, interfaces, enums, consts) by name or signature.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name or partial name' },
          kind: {
            type: 'string',
            description: 'Filter by kind',
            enum: ['function', 'class', 'interface', 'type', 'enum', 'const'],
          },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_file_outline',
      description:
        'Return all symbols (functions, classes, etc.) defined in a file, with line numbers and signatures.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path from workspace root' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'get_import_graph',
      description:
        'Return the import/dependency edges for a given file — what it imports and what imports it.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path from workspace root' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'get_tests_for_file',
      description:
        'Find test files and symbols that test a given source file by searching the symbol and chunk indexes.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path of the source file' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'get_ucg_metrics',
      description:
        'Return UCG (Unified Code Graph) global metrics: total nodes/edges, entry points, cycle count, hot files, external deps.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ls_dir',
      description: 'List files and subdirectories in a directory (non-recursive by default).',
      input_schema: {
        type: 'object',
        properties: {
          dir_path: {
            type: 'string',
            description: 'Relative path from workspace root (empty = root)',
          },
          recursive: {
            type: 'string',
            description: 'Set to "true" for recursive listing',
          },
        },
        required: ['dir_path'],
      },
    },
    {
      name: 'get_recently_changed',
      description:
        'Return files ranked by git change frequency, optionally filtered to recently touched files.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max files to return (default 20)' },
        },
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Tool call descriptor (mirrors Anthropic tool_use block)
// ---------------------------------------------------------------------------

export type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// executeTool
// ---------------------------------------------------------------------------

export async function executeTool(
  tc: ToolCall,
  db: Database.Database,
  workspaceRoot: string,
): Promise<string> {
  switch (tc.name) {
    case 'read_file':
      return execReadFile(tc.input, workspaceRoot)

    case 'search_codebase':
      return execSearchCodebase(tc.input, db)

    case 'search_symbols':
      return execSearchSymbols(tc.input, db)

    case 'get_file_outline':
      return execGetFileOutline(tc.input, db)

    case 'get_import_graph':
      return execGetImportGraph(tc.input, db)

    case 'get_tests_for_file':
      return execGetTestsForFile(tc.input, db)

    case 'get_ucg_metrics':
      return execGetUcgMetrics(db)

    case 'ls_dir':
      return execLsDir(tc.input, workspaceRoot)

    case 'get_recently_changed':
      return execGetRecentlyChanged(tc.input, db)

    default: {
      // check plugins
      const plugin = pluginRegistry.find((p) => p.tool.name === tc.name)
      if (plugin) return plugin.execute(tc.input, db, workspaceRoot)
      return `Unknown tool: ${tc.name}`
    }
  }
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

function execReadFile(input: Record<string, unknown>, workspaceRoot: string): string {
  const filePath = String(input['file_path'] ?? '')
  if (!filePath) return 'Error: file_path is required'

  const absPath = path.resolve(workspaceRoot, filePath)
  if (!absPath.startsWith(workspaceRoot)) return 'Error: path traversal denied'

  try {
    const raw = fs.readFileSync(absPath, 'utf8')
    const lines = raw.split('\n')

    const startLine = typeof input['start_line'] === 'number' ? input['start_line'] - 1 : 0
    const endLine =
      typeof input['end_line'] === 'number' ? input['end_line'] : lines.length

    const slice = lines.slice(Math.max(0, startLine), endLine)
    const numbered = slice
      .map((l, i) => `${String(startLine + i + 1).padStart(4, ' ')} | ${l}`)
      .join('\n')
    return `File: ${filePath}\n\`\`\`\n${numbered}\n\`\`\``
  } catch (err) {
    return `Error reading file: ${err instanceof Error ? err.message : String(err)}`
  }
}

function execSearchCodebase(input: Record<string, unknown>, db: Database.Database): string {
  const query = String(input['query'] ?? '').trim()
  if (!query) return 'Error: query is required'

  const limit = Math.min(Number(input['limit'] ?? 10), 50)

  try {
    const rows = db
      .prepare(
        `SELECT file_path, start_line, end_line, chunk_text
         FROM chunks_fts
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{
      file_path: string
      start_line: number
      end_line: number
      chunk_text: string
    }>

    if (rows.length === 0) return `No results for "${query}"`

    return rows
      .map(
        (r, i) =>
          `[${i + 1}] ${r.file_path}:${r.start_line}-${r.end_line}\n\`\`\`\n${r.chunk_text.slice(0, 500)}\n\`\`\``,
      )
      .join('\n\n')
  } catch (err) {
    return `FTS error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function execSearchSymbols(input: Record<string, unknown>, db: Database.Database): string {
  const query = String(input['query'] ?? '').trim()
  if (!query) return 'Error: query is required'

  const limit = Number(input['limit'] ?? 20)
  const kind = input['kind'] ? String(input['kind']) : null

  try {
    let rows: Array<{
      name: string
      kind: string
      file_path: string
      start_line: number
      end_line: number
      signature: string
      docstring: string
    }>

    if (kind) {
      rows = db
        .prepare(
          `SELECT s.name, s.kind, s.file_path, s.start_line, s.end_line, s.signature, s.docstring
           FROM symbols_fts sf
           JOIN symbols s ON s.rowid = sf.rowid
           WHERE symbols_fts MATCH ? AND s.kind = ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, kind, limit) as typeof rows
    } else {
      rows = db
        .prepare(
          `SELECT s.name, s.kind, s.file_path, s.start_line, s.end_line, s.signature, s.docstring
           FROM symbols_fts sf
           JOIN symbols s ON s.rowid = sf.rowid
           WHERE symbols_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as typeof rows
    }

    if (rows.length === 0) return `No symbols found for "${query}"`

    return rows
      .map(
        (r) =>
          `${r.kind} ${r.name}\n  File: ${r.file_path}:${r.start_line}-${r.end_line}\n  Sig : ${r.signature || '(none)'}${r.docstring ? `\n  Doc : ${r.docstring.slice(0, 120)}` : ''}`,
      )
      .join('\n\n')
  } catch (err) {
    return `Symbol search error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function execGetFileOutline(input: Record<string, unknown>, db: Database.Database): string {
  const filePath = String(input['file_path'] ?? '')
  if (!filePath) return 'Error: file_path is required'

  const rows = db
    .prepare(
      `SELECT name, kind, start_line, end_line, signature, is_exported
       FROM symbols
       WHERE file_path = ?
       ORDER BY start_line`,
    )
    .all(filePath) as Array<{
    name: string
    kind: string
    start_line: number
    end_line: number
    signature: string
    is_exported: number
  }>

  if (rows.length === 0) {
    return `No symbols found for ${filePath}. File may not be indexed or has no extractable symbols.`
  }

  const lines = [`Outline: ${filePath}`, '']
  for (const r of rows) {
    const exported = r.is_exported ? 'export ' : ''
    lines.push(`  L${r.start_line}-${r.end_line}  ${exported}${r.kind} ${r.name}`)
    if (r.signature) lines.push(`           ${r.signature}`)
  }
  return lines.join('\n')
}

function execGetImportGraph(input: Record<string, unknown>, db: Database.Database): string {
  const filePath = String(input['file_path'] ?? '')
  if (!filePath) return 'Error: file_path is required'

  const outgoing = db
    .prepare(
      `SELECT to_module, resolved_file, is_external, edge_type
       FROM ucg_import_edges WHERE from_file = ?`,
    )
    .all(filePath) as Array<{
    to_module: string
    resolved_file: string | null
    is_external: number
    edge_type: string
  }>

  const incoming = db
    .prepare(
      `SELECT from_file, edge_type FROM ucg_import_edges WHERE resolved_file = ?`,
    )
    .all(filePath) as Array<{ from_file: string; edge_type: string }>

  const lines: string[] = [`Import graph for: ${filePath}`, '']

  lines.push(`Imports (${outgoing.length}):`)
  for (const e of outgoing) {
    const label = e.is_external ? '[external]' : e.resolved_file ?? e.to_module
    lines.push(`  ${e.edge_type}  →  ${label}`)
  }

  lines.push(`\nImported by (${incoming.length}):`)
  for (const e of incoming) {
    lines.push(`  ${e.edge_type}  ←  ${e.from_file}`)
  }

  return lines.join('\n')
}

function execGetTestsForFile(input: Record<string, unknown>, db: Database.Database): string {
  const filePath = String(input['file_path'] ?? '')
  if (!filePath) return 'Error: file_path is required'

  const baseName = path.basename(filePath, path.extname(filePath))

  // search for test files that reference this file's basename
  const testChunks = db
    .prepare(
      `SELECT DISTINCT file_path, start_line, end_line
       FROM code_chunks
       WHERE file_path LIKE '%test%' OR file_path LIKE '%spec%'
       AND chunk_text LIKE ?
       LIMIT 20`,
    )
    .all(`%${baseName}%`) as Array<{ file_path: string; start_line: number; end_line: number }>

  // also search symbols_fts for describe/it blocks referencing the module
  const testSymbols = db
    .prepare(
      `SELECT s.name, s.file_path, s.start_line
       FROM symbols_fts sf
       JOIN symbols s ON s.rowid = sf.rowid
       WHERE symbols_fts MATCH ?
         AND (s.file_path LIKE '%test%' OR s.file_path LIKE '%spec%')
       LIMIT 10`,
    )
    .all(baseName) as Array<{ name: string; file_path: string; start_line: number }>

  if (testChunks.length === 0 && testSymbols.length === 0) {
    return `No tests found referencing ${filePath}`
  }

  const lines = [`Tests for: ${filePath}`, '']
  const seenFiles = new Set<string>()

  for (const c of testChunks) {
    if (!seenFiles.has(c.file_path)) {
      seenFiles.add(c.file_path)
      lines.push(`  Test file: ${c.file_path}`)
    }
  }

  if (testSymbols.length > 0) {
    lines.push('\nTest symbols:')
    for (const s of testSymbols) {
      lines.push(`  ${s.file_path}:${s.start_line}  ${s.name}`)
    }
  }

  return lines.join('\n')
}

function execGetUcgMetrics(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT total_nodes, total_edges, entry_count, cycle_count,
              hot_files_json, external_deps_json, computed_at
       FROM ucg_graph_metrics WHERE id = 1`,
    )
    .get() as
    | {
        total_nodes: number
        total_edges: number
        entry_count: number
        cycle_count: number
        hot_files_json: string
        external_deps_json: string
        computed_at: number
      }
    | undefined

  if (!row) return 'UCG metrics not yet computed — run the indexer first.'

  const hotFiles = JSON.parse(row.hot_files_json) as string[]
  const extDeps = JSON.parse(row.external_deps_json) as Record<string, number>
  const topExt = Object.entries(extDeps)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([k, v]) => `  ${k}: ${v} imports`)
    .join('\n')

  return `UCG Metrics (computed ${new Date(row.computed_at).toISOString()})
- Total nodes  : ${row.total_nodes}
- Total edges  : ${row.total_edges}
- Entry points : ${row.entry_count}
- Import cycles: ${row.cycle_count}

Hot files (by import-count):
${hotFiles.map((f) => `  ${f}`).join('\n') || '  (none)'}

Top external dependencies:
${topExt || '  (none)'}`
}

function execLsDir(input: Record<string, unknown>, workspaceRoot: string): string {
  const dirPath = String(input['dir_path'] ?? '')
  const recursive = String(input['recursive'] ?? 'false') === 'true'

  const absPath = path.resolve(workspaceRoot, dirPath)
  if (!absPath.startsWith(workspaceRoot)) return 'Error: path traversal denied'

  try {
    if (recursive) {
      const entries: string[] = []
      function walk(dir: string, prefix: string): void {
        let items: fs.Dirent[]
        try {
          items = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === 'node_modules') continue
          entries.push(`${prefix}${item.name}${item.isDirectory() ? '/' : ''}`)
          if (item.isDirectory() && entries.length < 500) {
            walk(path.join(dir, item.name), `${prefix}${item.name}/`)
          }
        }
      }
      walk(absPath, '')
      return `Contents of ${dirPath || '.'} (recursive):\n${entries.join('\n')}`
    } else {
      const items = fs.readdirSync(absPath, { withFileTypes: true })
      const lines = items
        .filter((i) => !i.name.startsWith('.') && i.name !== 'node_modules')
        .map((i) => `  ${i.isDirectory() ? 'd' : 'f'}  ${i.name}`)
      return `Contents of ${dirPath || '.'}:\n${lines.join('\n')}`
    }
  } catch (err) {
    return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`
  }
}

function execGetRecentlyChanged(input: Record<string, unknown>, db: Database.Database): string {
  const limit = Math.min(Number(input['limit'] ?? 20), 100)

  const rows = db
    .prepare(
      `SELECT file_path, change_count, last_changed
       FROM git_file_stats
       ORDER BY change_count DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ file_path: string; change_count: number; last_changed: string }>

  if (rows.length === 0) return 'No git file stats available — run the indexer first.'

  const lines = [`Recently changed files (top ${limit} by commit frequency):`, '']
  for (const r of rows) {
    lines.push(`  ${r.change_count.toString().padStart(4, ' ')}x  ${r.file_path}  (last: ${r.last_changed})`)
  }
  return lines.join('\n')
}
