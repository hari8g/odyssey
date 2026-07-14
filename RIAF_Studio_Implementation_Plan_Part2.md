# RIAF Studio — Complete From-Scratch Implementation Plan
## Part 2 of 2: LLM Layer, RIAF Agent, IPC Handlers, React UI, Packaging, ISS Contract

> Continues directly from Part 1. All file paths are relative to `riaf-studio/`.

---

## Table of Contents — Part 2

10. [Settings Store](#10-settings-store)
11. [LLM Provider Layer](#11-llm-provider-layer)
12. [RIAF Agent](#12-riaf-agent)
13. [Main Process Entry & IPC Handler Registration](#13-main-process-entry--ipc-handler-registration)
14. [React Renderer — App Shell & Store](#14-react-renderer--app-shell--store)
15. [UI Panels — Detailed Specifications](#15-ui-panels--detailed-specifications)
16. [Cross-Platform Packaging](#16-cross-platform-packaging)
17. [ISS Extensibility Contract](#17-iss-extensibility-contract)
18. [Build Order & Milestones](#18-build-order--milestones)
19. [Testing Strategy](#19-testing-strategy)

---

## 10. Settings Store

The settings store is a typed `electron-store` wrapper. It lives in the main process
and is read/written via IPC. The preload already exposes `getSettings`/`setSettings`.

```typescript
// packages/main/src/settingsStore.ts
import Store from 'electron-store'

export type LLMProvider = 'anthropic' | 'openai-compat'

export type AppSettings = {
  // LLM
  llmProvider:        LLMProvider
  anthropicApiKey:    string
  openAICompatBaseUrl: string
  openAICompatApiKey:  string
  defaultModel:       string            // 'claude-sonnet-4-6' | 'gpt-4o' | etc.

  // Embeddings (optional, independent of LLM)
  embeddingBaseUrl:   string            // default 'https://api.openai.com'
  embeddingApiKey:    string
  embeddingModel:     string            // default 'text-embedding-3-small'
  embeddingsEnabled:  boolean

  // RIAF agent
  riafMaxFiles:       number            // default 150
  riafIncludeTests:   boolean           // default false

  // Workspace
  recentWorkspaces:   string[]          // up to 10 most recent

  // UI
  theme: 'dark' | 'light' | 'system'
}

const DEFAULTS: AppSettings = {
  llmProvider:         'anthropic',
  anthropicApiKey:     '',
  openAICompatBaseUrl: 'http://localhost:4000',
  openAICompatApiKey:  '',
  defaultModel:        'claude-sonnet-4-6',
  embeddingBaseUrl:    'https://api.openai.com',
  embeddingApiKey:     '',
  embeddingModel:      'text-embedding-3-small',
  embeddingsEnabled:   false,
  riafMaxFiles:        150,
  riafIncludeTests:    false,
  recentWorkspaces:    [],
  theme:               'dark',
}

// Singleton — created once in index.ts
let _store: Store<AppSettings> | null = null

export function getStore(): Store<AppSettings> {
  if (!_store) {
    _store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULTS,
      // Electron-store will put this in:
      //   Windows: %APPDATA%\riaf-studio\settings.json
      //   macOS:   ~/Library/Application Support/riaf-studio/settings.json
    })
  }
  return _store
}

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getStore().get(key)
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  getStore().set(key, value)
}

export function addRecentWorkspace(dir: string): void {
  const store = getStore()
  const recents = store.get('recentWorkspaces').filter(d => d !== dir)
  recents.unshift(dir)
  store.set('recentWorkspaces', recents.slice(0, 10))
}
```

---

## 11. LLM Provider Layer

### 11.1 Provider Interface

```typescript
// packages/main/src/llm/llmProvider.interface.ts

export type LLMMessage = {
  role:    'user' | 'assistant'
  content: string | LLMContentBlock[]
}

export type LLMContentBlock =
  | { type: 'text';       text: string }
  | { type: 'tool_use';   id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type LLMTool = {
  name:        string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required:   string[]
  }
}

export type LLMRequest = {
  model:      string
  system:     string
  messages:   LLMMessage[]
  tools?:     LLMTool[]
  max_tokens: number
}

// Events emitted to the renderer via IPC during streaming
export type StreamEvent =
  | { type: 'text_delta';      delta: string }
  | { type: 'tool_use_start';  id: string; name: string }
  | { type: 'tool_use_input';  id: string; delta: string }
  | { type: 'message_stop' }
  | { type: 'error';           message: string }

export type ToolCallResult = {
  id:      string
  name:    string
  input:   Record<string, unknown>
  result?: string   // populated after tool execution
}

export interface ILLMProvider {
  readonly name: string

  /** Non-streaming: returns full text. Used for cheap sub-calls. */
  complete(req: LLMRequest): Promise<string>

  /** Streaming: calls onEvent for each delta. Returns final tool calls (if any). */
  stream(
    req:     LLMRequest,
    onEvent: (e: StreamEvent) => void,
  ): Promise<{ stopReason: 'end_turn' | 'tool_use' | 'max_tokens'; toolCalls: ToolCallResult[] }>
}
```

### 11.2 Anthropic Provider

```typescript
// packages/main/src/llm/anthropicProvider.ts
import Anthropic from '@anthropic-ai/sdk'
import type {
  ILLMProvider, LLMRequest, StreamEvent, ToolCallResult
} from './llmProvider.interface'

export class AnthropicProvider implements ILLMProvider {
  readonly name = 'anthropic'
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(req: LLMRequest): Promise<string> {
    const msg = await this.client.messages.create({
      model:      req.model,
      system:     req.system,
      messages:   this.convertMessages(req.messages),
      max_tokens: req.max_tokens,
    })
    const block = msg.content[0]
    return block?.type === 'text' ? block.text : ''
  }

  async stream(
    req:     LLMRequest,
    onEvent: (e: StreamEvent) => void,
  ): Promise<{ stopReason: 'end_turn' | 'tool_use' | 'max_tokens'; toolCalls: ToolCallResult[] }> {
    const toolCalls: ToolCallResult[] = []
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
    let currentToolId = ''
    let currentToolName = ''

    const stream = this.client.messages.stream({
      model:      req.model,
      system:     req.system,
      messages:   this.convertMessages(req.messages),
      tools:      req.tools as Anthropic.Tool[],
      max_tokens: req.max_tokens,
    })

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentToolId   = event.content_block.id
            currentToolName = event.content_block.name
            toolCalls.push({ id: currentToolId, name: currentToolName, input: {} })
            onEvent({ type: 'tool_use_start', id: currentToolId, name: currentToolName })
          }
          break

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            onEvent({ type: 'text_delta', delta: event.delta.text })
          } else if (event.delta.type === 'input_json_delta') {
            onEvent({ type: 'tool_use_input', id: currentToolId, delta: event.delta.partial_json })
          }
          break

        case 'message_delta':
          if (event.delta.stop_reason === 'tool_use')    stopReason = 'tool_use'
          if (event.delta.stop_reason === 'max_tokens')  stopReason = 'max_tokens'
          break

        case 'message_stop':
          onEvent({ type: 'message_stop' })
          break
      }
    }

    // Parse tool inputs (accumulated as JSON strings)
    const finalMsg = await stream.finalMessage()
    for (const block of finalMsg.content) {
      if (block.type === 'tool_use') {
        const tc = toolCalls.find(t => t.id === block.id)
        if (tc) tc.input = block.input as Record<string, unknown>
      }
    }

    return { stopReason, toolCalls }
  }

  private convertMessages(msgs: LLMRequest['messages']): Anthropic.MessageParam[] {
    return msgs.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content :
        m.content.map(b => {
          if (b.type === 'text')        return { type: 'text' as const, text: b.text }
          if (b.type === 'tool_result') return {
            type: 'tool_result' as const,
            tool_use_id: b.tool_use_id,
            content: b.content,
          }
          return b as Anthropic.ToolUseBlock
        })
    }))
  }
}
```

### 11.3 OpenAI-Compatible Provider

```typescript
// packages/main/src/llm/openAICompatProvider.ts
import type {
  ILLMProvider, LLMRequest, StreamEvent, ToolCallResult
} from './llmProvider.interface'

export class OpenAICompatProvider implements ILLMProvider {
  readonly name = 'openai-compat'

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async complete(req: LLMRequest): Promise<string> {
    const resp = await this.post('/v1/chat/completions', {
      model:       req.model,
      messages:    [{ role: 'system', content: req.system }, ...this.convertMessages(req.messages)],
      max_tokens:  req.max_tokens,
      stream:      false,
    })
    return resp.choices?.[0]?.message?.content ?? ''
  }

  async stream(
    req:     LLMRequest,
    onEvent: (e: StreamEvent) => void,
  ): Promise<{ stopReason: 'end_turn' | 'tool_use' | 'max_tokens'; toolCalls: ToolCallResult[] }> {
    const toolCalls: ToolCallResult[] = []
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
    const toolInputAccum: Record<string, string> = {}

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:    req.model,
        messages: [{ role: 'system', content: req.system }, ...this.convertMessages(req.messages)],
        tools:    req.tools?.map(t => ({ type: 'function', function: { name: t.name,
                    description: t.description, parameters: t.input_schema } })),
        max_tokens: req.max_tokens,
        stream:   true,
      }),
    })

    if (!response.ok || !response.body) {
      onEvent({ type: 'error', message: `HTTP ${response.status}` })
      return { stopReason: 'end_turn', toolCalls }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') { onEvent({ type: 'message_stop' }); continue }
        try {
          const chunk = JSON.parse(data)
          const delta = chunk.choices?.[0]?.delta
          const finishReason = chunk.choices?.[0]?.finish_reason

          if (delta?.content) onEvent({ type: 'text_delta', delta: delta.content })

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.name) {
                toolCalls.push({ id: tc.id ?? `tc_${tc.index}`,
                                 name: tc.function.name, input: {} })
                onEvent({ type: 'tool_use_start', id: tc.id, name: tc.function.name })
              }
              if (tc.function?.arguments) {
                const id = toolCalls[tc.index ?? 0]?.id ?? ''
                toolInputAccum[id] = (toolInputAccum[id] ?? '') + tc.function.arguments
                onEvent({ type: 'tool_use_input', id, delta: tc.function.arguments })
              }
            }
          }

          if (finishReason === 'tool_calls')  stopReason = 'tool_use'
          if (finishReason === 'length')       stopReason = 'max_tokens'
        } catch { /* skip invalid SSE chunks */ }
      }
    }

    // Parse accumulated tool inputs
    for (const tc of toolCalls) {
      try { tc.input = JSON.parse(toolInputAccum[tc.id] ?? '{}') } catch { tc.input = {} }
    }

    return { stopReason, toolCalls }
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    })
    return r.json() as Promise<Record<string, unknown>>
  }

  private convertMessages(msgs: LLMRequest['messages']) {
    return msgs.map(m => ({
      role:    m.role,
      content: typeof m.content === 'string' ? m.content :
        m.content
          .filter(b => b.type === 'text' || b.type === 'tool_result')
          .map(b => b.type === 'text' ? b.text : (b as { content: string }).content)
          .join('\n'),
    }))
  }
}
```

### 11.4 Tool Runner — Agent Loop

```typescript
// packages/main/src/llm/toolRunner.ts
// Executes the LLM agentic loop: stream → collect tool calls → execute → append
// results → stream again, until stop_reason = 'end_turn'.
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMRequest, LLMMessage, ToolCallResult } from './llmProvider.interface'
import { IPC } from '@shared/index'
import type { RiafStreamChunk } from '@shared/index'
import { buildRiafTools, executeTool } from '../riaf/riafTools'

const MAX_ITERATIONS = 30   // safety limit

export async function runAgentLoop(
  provider: ILLMProvider,
  req:      LLMRequest,
  db:       Database.Database,
  workspaceRoot: string,
  win:      BrowserWindow,
): Promise<string> {
  const messages: LLMMessage[] = [...req.messages]
  const tools = buildRiafTools()
  let fullText = ''
  let iterations = 0

  const push = (chunk: RiafStreamChunk) =>
    win.webContents.send(IPC.RIAF_STREAM_CHUNK, chunk)

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const { stopReason, toolCalls } = await provider.stream(
      { ...req, messages, tools },
      (event) => {
        if (event.type === 'text_delta') {
          fullText += event.delta
          push({ type: 'text', content: event.delta })
        } else if (event.type === 'tool_use_start') {
          push({ type: 'tool_use_start', content: '', toolName: event.name })
        }
      }
    )

    if (stopReason === 'end_turn' || toolCalls.length === 0) break

    // Append assistant message with tool_use blocks
    messages.push({
      role: 'assistant',
      content: toolCalls.map(tc => ({
        type: 'tool_use' as const,
        id:    tc.id,
        name:  tc.name,
        input: tc.input,
      })),
    })

    // Execute all tool calls and build tool_result content
    const results: LLMMessage['content'] = []
    for (const tc of toolCalls) {
      const result = await executeTool(tc, db, workspaceRoot)
      tc.result = result
      push({ type: 'tool_result', content: result.slice(0, 200), toolName: tc.name })
      results.push({ type: 'tool_result', tool_use_id: tc.id, content: result })
    }

    messages.push({ role: 'user', content: results })
  }

  push({ type: 'done', content: '' })
  return fullText
}
```

### 11.5 Context Assembler — System Prompt Builder

```typescript
// packages/main/src/llm/contextAssembler.ts
import type { RiafIndexSnapshot } from '@shared/index'

// Character budgets per section
const BUDGET = {
  header:       300,
  snapshot:     4_000,
  instructions: 3_000,
  template:     600,
}

export function buildRiafSystemPrompt(snapshot: RiafIndexSnapshot): string {
  const snapshotBlock = `
## Repository Intelligence Snapshot
(Pre-computed by RIAF index — do not re-discover these facts by reading files)

- **Languages**: ${snapshot.languageStack.join(', ')}
- **Frameworks**: ${snapshot.frameworks.join(', ') || 'none detected'}
- **Package managers**: ${snapshot.packageManagers.join(', ') || 'none'}
- **Files indexed**: ${snapshot.fileCount.toLocaleString()}
- **Total LoC (est.)**: ${snapshot.totalLoc.toLocaleString()}
- **Chunks indexed**: ${snapshot.chunkCount.toLocaleString()}
- **Symbols extracted**: ${snapshot.symbolCount.toLocaleString()}
- **Build commands**: ${snapshot.buildCommands.slice(0, 3).join('; ') || 'none'}
- **Test commands**: ${snapshot.testCommands.slice(0, 3).join('; ') || 'none'}
- **Hot files (top fan-in)**: ${snapshot.hotFiles.slice(0, 8).join(', ')}
- **Import cycles**: ${snapshot.cycleCount}
- **External dep packages**: ${snapshot.externalDepCount}
- **Git branch**: ${snapshot.gitBranch ?? 'N/A'}
- **Recently changed**: ${snapshot.recentlyChanged.slice(0, 6).join(', ')}
`.trim()

  return `
You are RIAF (Repository Intelligence and Analysis Framework), an expert code intelligence agent.
Your job is to analyze a software repository and produce a comprehensive, factually grounded
context document that helps engineers understand the codebase instantly.

${snapshotBlock}

## Your tools
You have access to these tools to read the codebase:
- **read_file(path, startLine?, endLine?)** — read any source file
- **search_codebase(query)** — full-text search (BM25) over all indexed chunks
- **search_symbols(query)** — find functions/classes/interfaces by name or signature
- **get_file_outline(path)** — list all symbols in a file
- **get_import_graph(path, direction)** — imports/importedBy for a file
- **get_tests_for_file(path)** — test files covering this source file
- **get_ucg_metrics()** — full UCG graph metrics (cycles, hot files, arch layers)
- **ls_dir(path)** — list directory contents
- **get_recently_changed(limit?)** — files changed most in recent commits

## Output format
Produce exactly this 12-section Markdown document. Every section must be specific to THIS
codebase. Zero generic boilerplate. Cite actual file paths and method names.

DO NOT use sections or headers beyond the 12 required. DO NOT exceed 6,000 words total.
DO NOT guess — if uncertain, use a tool to verify.

Begin writing the document immediately after completing your tool calls.
`.trim()
}

/** Builds the snapshot from the DB and profile table */
export function buildSnapshotFromDb(db: import('better-sqlite3').Database): RiafIndexSnapshot {
  const profile = db
    .prepare<[], {
      language_stack_json: string; frameworks_json: string; package_managers_json: string;
      build_commands_json: string; test_commands_json: string; file_count: number; total_loc: number;
      project_purpose: string | null; architecture_summary: string | null;
    }>('SELECT * FROM workspace_profiles WHERE id = 1')
    .get()

  const chunkCount  = (db.prepare('SELECT COUNT(*) as n FROM code_chunks').get() as { n: number }).n
  const symbolCount = (db.prepare('SELECT COUNT(*) as n FROM symbols').get() as { n: number }).n

  const metrics = db
    .prepare<[], { hot_files_json: string; cycle_count: number; external_deps_json: string }>(
      'SELECT hot_files_json, cycle_count, external_deps_json FROM ucg_graph_metrics WHERE id = 1'
    )
    .get()

  const gitFiles = db
    .prepare<[], { file_path: string }>(
      'SELECT file_path FROM git_file_stats ORDER BY change_count DESC LIMIT 10'
    )
    .all()

  const gitBranch = null  // fetched live by gitIndexer on demand

  return {
    languageStack:    profile ? JSON.parse(profile.language_stack_json) : [],
    frameworks:       profile ? JSON.parse(profile.frameworks_json).map((f: { name: string }) => f.name) : [],
    packageManagers:  profile ? JSON.parse(profile.package_managers_json) : [],
    fileCount:        profile?.file_count ?? 0,
    totalLoc:         profile?.total_loc ?? 0,
    chunkCount,
    symbolCount,
    projectPurpose:   profile?.project_purpose ?? null,
    architectureSummary: profile?.architecture_summary ?? null,
    buildCommands:    profile ? JSON.parse(profile.build_commands_json).map((c: { command: string }) => c.command) : [],
    testCommands:     profile ? JSON.parse(profile.test_commands_json).map((c: { command: string }) => c.command) : [],
    hotFiles:         metrics ? JSON.parse(metrics.hot_files_json) : [],
    cycleCount:       metrics?.cycle_count ?? 0,
    externalDepCount: metrics ? Object.keys(JSON.parse(metrics.external_deps_json)).length : 0,
    gitBranch,
    recentlyChanged:  gitFiles.map(r => r.file_path),
  }
}
```

---

## 12. RIAF Agent

### 12.1 RIAF Tools — What the Agent Can Call

```typescript
// packages/main/src/riaf/riafTools.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { LLMTool, ToolCallResult } from '../llm/llmProvider.interface'

export function buildRiafTools(): LLMTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file. Specify startLine/endLine to read a slice.',
      input_schema: {
        type: 'object',
        properties: {
          path:      { type: 'string',  description: 'File path relative to workspace root' },
          startLine: { type: 'number',  description: 'First line to read (1-indexed, optional)' },
          endLine:   { type: 'number',  description: 'Last line to read (inclusive, optional)' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_codebase',
      description: 'Full-text search over all indexed code chunks using BM25. Returns ranked snippets.',
      input_schema: {
        type: 'object',
        properties: {
          query:      { type: 'string', description: 'Search query (keywords, symbol names, etc.)' },
          maxResults: { type: 'number', description: 'Max results to return (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_symbols',
      description: 'Search for functions, classes, interfaces, types, enums by name or docstring.',
      input_schema: {
        type: 'object',
        properties: {
          query:      { type: 'string', description: 'Symbol name or description keywords' },
          maxResults: { type: 'number', description: 'Max results (default 15)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_file_outline',
      description: 'List all extracted symbols (functions, classes, types) in a file with line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_import_graph',
      description: 'Get import relationships for a file — what it imports and what imports it.',
      input_schema: {
        type: 'object',
        properties: {
          path:      { type: 'string', description: 'File path relative to workspace root' },
          direction: {
            type: 'string',
            description: 'Direction to traverse',
            enum: ['imports', 'importedBy', 'both'],
          },
        },
        required: ['path', 'direction'],
      },
    },
    {
      name: 'get_tests_for_file',
      description: 'Find test files that cover a given source file.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Source file path relative to workspace root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_ucg_metrics',
      description: 'Get Universal Context Graph metrics: hot files, cycles, arch layer breakdown, external deps.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'ls_dir',
      description: 'List the contents of a directory (non-recursive, first 60 entries).',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to workspace root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_recently_changed',
      description: 'Get the files most frequently changed in recent git history, by change count.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max files to return (default 20)' },
        },
        required: [],
      },
    },
  ]
}

export async function executeTool(
  tc:            ToolCallResult,
  db:            Database.Database,
  workspaceRoot: string,
): Promise<string> {
  try {
    switch (tc.name) {
      case 'read_file': {
        const { path: rel, startLine, endLine } = tc.input as {
          path: string; startLine?: number; endLine?: number
        }
        const abs = path.join(workspaceRoot, rel)
        if (!fs.existsSync(abs)) return `Error: File not found: ${rel}`
        const content = fs.readFileSync(abs, 'utf8')
        if (!startLine && !endLine) {
          const lines = content.split('\n')
          if (lines.length > 300) {
            return lines.slice(0, 300).join('\n') + `\n\n[... truncated at 300 lines — use startLine/endLine to read more]`
          }
          return content
        }
        const lines = content.split('\n')
        const s = Math.max(0, (startLine ?? 1) - 1)
        const e = endLine ? Math.min(lines.length, endLine) : s + 120
        return lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n')
      }

      case 'search_codebase': {
        const { query, maxResults = 10 } = tc.input as { query: string; maxResults?: number }
        const sanitized = query.replace(/['"*()]/g, ' ').trim() + '*'
        const rows = db.prepare<[string, number], {
          file_path: string; start_line: number; end_line: number;
          chunk_text: string; bm25_score: number
        }>(`
          SELECT c.file_path, c.start_line, c.end_line,
                 substr(c.chunk_text, 1, 400) as chunk_text,
                 bm25(chunks_fts) as bm25_score
          FROM chunks_fts
          JOIN code_chunks c ON c.rowid = chunks_fts.rowid
          WHERE chunks_fts MATCH ?
          ORDER BY bm25_score LIMIT ?
        `).all(sanitized, maxResults)

        if (rows.length === 0) return `No results for: ${query}`
        return rows.map(r =>
          `[${r.file_path}:${r.start_line}-${r.end_line}]\n${r.chunk_text}`
        ).join('\n\n---\n\n')
      }

      case 'search_symbols': {
        const { query, maxResults = 15 } = tc.input as { query: string; maxResults?: number }
        const sanitized = query.replace(/['"*()]/g, ' ').trim() + '*'
        const rows = db.prepare<[string, number], {
          name: string; kind: string; file_path: string;
          start_line: number; signature: string; docstring: string
        }>(`
          SELECT s.name, s.kind, s.file_path, s.start_line, s.signature, s.docstring
          FROM symbols_fts
          JOIN symbols s ON s.rowid = symbols_fts.rowid
          WHERE symbols_fts MATCH ?
          ORDER BY rank LIMIT ?
        `).all(sanitized, maxResults)

        if (rows.length === 0) return `No symbols matching: ${query}`
        return rows.map(r =>
          `${r.kind.toUpperCase()} ${r.name}${r.signature ? `(${r.signature})` : ''} — ${r.file_path}:${r.start_line}` +
          (r.docstring ? `\n  // ${r.docstring}` : '')
        ).join('\n')
      }

      case 'get_file_outline': {
        const { path: rel } = tc.input as { path: string }
        const rows = db.prepare<[string], {
          name: string; kind: string; start_line: number; end_line: number; signature: string
        }>(`SELECT name, kind, start_line, end_line, signature
            FROM symbols WHERE file_path = ? ORDER BY start_line`
        ).all(rel)

        if (rows.length === 0) return `No symbols extracted from: ${rel}`
        return rows.map(r =>
          `L${r.start_line}-${r.end_line} [${r.kind}] ${r.name}${r.signature ? ` ${r.signature}` : ''}`
        ).join('\n')
      }

      case 'get_import_graph': {
        const { path: rel, direction } = tc.input as {
          path: string; direction: 'imports' | 'importedBy' | 'both'
        }
        const imports = direction !== 'importedBy' ?
          db.prepare<[string], { resolved_file: string | null; to_module: string; is_external: number }>(
            'SELECT resolved_file, to_module, is_external FROM ucg_import_edges WHERE from_file = ?'
          ).all(rel) : []

        const importedBy = direction !== 'imports' ?
          db.prepare<[string], { from_file: string }>(
            'SELECT from_file FROM ucg_import_edges WHERE resolved_file = ?'
          ).all(rel) : []

        const parts: string[] = []
        if (imports.length > 0) {
          parts.push('IMPORTS:\n' + imports.map(e =>
            `  ${e.is_external ? '[ext]' : '[int]'} ${e.to_module}` +
            (e.resolved_file ? ` → ${e.resolved_file}` : '')
          ).join('\n'))
        }
        if (importedBy.length > 0) {
          parts.push('IMPORTED BY:\n' + importedBy.map(e => `  ${e.from_file}`).join('\n'))
        }
        return parts.length > 0 ? parts.join('\n\n') : `No import relationships found for: ${rel}`
      }

      case 'get_tests_for_file': {
        const { path: rel } = tc.input as { path: string }
        // Convention-based: look for matching spec/test files
        const base = rel.replace(/\.(ts|tsx|js|jsx)$/, '')
        const patterns = [`${base}.spec.`, `${base}.test.`,
                          `__tests__/${path.basename(base)}`]
        const rows = db.prepare<[string], { file_path: string }>(
          `SELECT file_path FROM file_metadata WHERE ${patterns.map(() => 'file_path LIKE ?').join(' OR ')}`
        ).all(...patterns.map(p => `%${p}%`))

        return rows.length > 0 ?
          'Test files:\n' + rows.map(r => `  ${r.file_path}`).join('\n') :
          `No test files found for: ${rel}`
      }

      case 'get_ucg_metrics': {
        const row = db
          .prepare<[], {
            total_nodes: number; total_edges: number; entry_count: number;
            cycle_count: number; cycles_json: string; hot_files_json: string;
            external_deps_json: string
          }>('SELECT * FROM ucg_graph_metrics WHERE id = 1')
          .get()
        if (!row) return 'UCG metrics not yet computed — run the indexer first'

        const cycles  = JSON.parse(row.cycles_json) as string[][]
        const hotFiles = JSON.parse(row.hot_files_json) as string[]
        const extDeps  = JSON.parse(row.external_deps_json) as Record<string, number>
        const topDeps  = Object.entries(extDeps).sort((a, b) => b[1] - a[1]).slice(0, 15)

        return [
          `Nodes: ${row.total_nodes}, Edges: ${row.total_edges}, Entry points: ${row.entry_count}`,
          `Import cycles (${row.cycle_count}):`,
          cycles.slice(0, 5).map(c => `  [${c.join(' → ')}]`).join('\n'),
          `Hot files (by import fan-in):`,
          hotFiles.slice(0, 8).map((f, i) => `  ${i + 1}. ${f}`).join('\n'),
          `Top external packages:`,
          topDeps.map(([pkg, n]) => `  ${pkg} (${n} imports)`).join('\n'),
        ].join('\n')
      }

      case 'ls_dir': {
        const { path: rel } = tc.input as { path: string }
        const abs = path.join(workspaceRoot, rel)
        if (!fs.existsSync(abs)) return `Directory not found: ${rel}`
        const entries = fs.readdirSync(abs, { withFileTypes: true })
        return entries.slice(0, 60)
          .map(e => `${e.isDirectory() ? '[dir] ' : '      '}${e.name}`)
          .join('\n') +
          (entries.length > 60 ? `\n… and ${entries.length - 60} more` : '')
      }

      case 'get_recently_changed': {
        const { limit = 20 } = tc.input as { limit?: number }
        const rows = db.prepare<[number], { file_path: string; change_count: number; last_changed: string }>(
          'SELECT file_path, change_count, last_changed FROM git_file_stats ORDER BY change_count DESC LIMIT ?'
        ).all(limit)
        return rows.map(r => `${r.change_count}x  ${r.file_path}  (last: ${r.last_changed})`).join('\n')
      }

      default:
        return `Unknown tool: ${tc.name}`
    }
  } catch (err) {
    return `Tool error (${tc.name}): ${err instanceof Error ? err.message : String(err)}`
  }
}
```

### 12.2 RIAF Prompt Template

```typescript
// packages/main/src/riaf/riafPrompts.ts

/** The user-turn message that starts the RIAF analysis run. */
export function buildRiafUserMessage(
  repoTitle:      string,
  outputFileName: string,
  maxFiles:       number,
  includeTests:   boolean,
): string {
  return `
Analyze the repository "${repoTitle}" and produce the context document.

Output filename: \`${outputFileName}\`
Max source files to read: ${maxFiles}
Include test files in analysis: ${includeTests ? 'yes' : 'no (focus on source files only)'}

Produce a complete Markdown document with EXACTLY these 12 sections in order.
Every sentence must be specific to this codebase. Zero boilerplate. Cite real file paths.

---

# ${outputFileName}
> Auto-generated by RIAF Studio — ${repoTitle} — ${new Date().toISOString().split('T')[0]}

---

## 1. What This Repository Does

[2–3 paragraphs. Purpose, target users, key capabilities. Every sentence specific to THIS repo.]

---

## 2. Architecture Overview

\`\`\`
[ASCII diagram: layers, major components, data flow.
Use → for data flow, ── for layer boundaries, clear labels on every box.
For multi-process apps (Electron, microservices): show process boundaries.]
\`\`\`

[2 paragraphs explaining key architectural decisions and layer boundary rules.
Quote actual constraint names or patterns found in source.]

---

## 3. File Responsibility Map

[Annotated directory tree. Every non-trivial file/directory gets a ← comment.
Format exactly:
  path/to/file.ts     ← what it owns and why it matters
Skip: node_modules, dist, build, .git, coverage, lock files, generated files.]

---

## 4. Module Wiring & Data Flow

[MOST IMPORTANT SECTION. Every subsystem gets a sub-header.
For each subsystem write:
  - Entry point (file + method that triggers it)
  - Full call chain using format: File.method() → File.method() → File.method()
  - Input types → output types
  - Side effects: DB writes, file writes, events emitted, IPC messages
Do NOT write "X calls Y". Write "X.methodA() calls Y.methodB(params)".]

---

## 5. External Dependencies

[Group by: Core Runtime | UI/Rendering | State | Data/DB | Networking | Build/Tooling | Testing
For each: **package-name** (\`version\`) — one sentence purpose, which files import it.]

---

## 6. Entry Points & Bootstrap Sequence

[Numbered ordered list. What runs first, what it initialises, exact file + method at each step.]

---

## 7. Key Patterns & Conventions

[Rules an engineer MUST follow to add code that fits this codebase.
Only rules ACTUALLY enforced in the source — no guesses.
Examples: service registration patterns, IPC conventions, write-guard requirements,
naming conventions, file placement rules, import constraints.]

---

## 8. Implementation Cookbook

[Step-by-step recipes for the 4–6 most common extension points.
Every recipe cites a specific existing file as the reference example.

### How to add a new [X]
1. Create \`path/new-file.ts\` — follow the pattern in \`path/existing-file.ts\`
2. Register in \`path/contribution.ts\`
3. …]

---

## 9. Configuration & Environment

[Every config file and what it controls.
Every env var: NAME | purpose | required? | example value.
Settings/preferences that affect runtime behavior.]

---

## 10. Testing

[Test framework, where tests live, naming convention, how to run.
List every test suite with a one-line description.]

---

## 11. Known Issues & TODOs

[Every TODO / FIXME / HACK / NOTE comment found in the source.
Quote verbatim and cite file path. Group by file.]

---

## 12. Quick Reference

[A 10–20 line cheat sheet: most important commands, most important files,
most important patterns. A new engineer's first 10 minutes in this repo.]
`.trim()
}
```

### 12.3 RIAF Controller — FSM

```typescript
// packages/main/src/riaf/riafController.ts
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { RiafConfig, RiafRunState } from '@shared/index'
import { IPC, DEFAULT_RIAF_CONFIG } from '@shared/index'
import { AnthropicProvider } from '../llm/anthropicProvider'
import { OpenAICompatProvider } from '../llm/openAICompatProvider'
import { buildRiafSystemPrompt, buildSnapshotFromDb } from '../llm/contextAssembler'
import { buildRiafUserMessage } from './riafPrompts'
import { runAgentLoop } from '../llm/toolRunner'
import { getSetting } from '../settingsStore'
import type { ILLMProvider } from '../llm/llmProvider.interface'

export class RiafController {
  private state: RiafRunState = { status: 'idle' }
  private abortController: AbortController | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly workspaceRoot: string,
    private readonly win: BrowserWindow,
  ) {}

  getState(): RiafRunState { return this.state }

  async start(config: Partial<RiafConfig> = {}): Promise<void> {
    if (this.state.status === 'running') return

    const mergedConfig: RiafConfig = { ...DEFAULT_RIAF_CONFIG, ...config }
    const repoTitle = path.basename(this.workspaceRoot)
    const outputPath = path.join(this.workspaceRoot, mergedConfig.outputFileName)
    const startedAt = Date.now()

    this.setState({ status: 'running', startedAt, outputPath })

    try {
      const provider = this.buildProvider(mergedConfig.model)
      const snapshot = buildSnapshotFromDb(this.db)
      const systemPrompt = buildRiafSystemPrompt(snapshot)
      const userMessage  = buildRiafUserMessage(
        repoTitle, mergedConfig.outputFileName,
        mergedConfig.maxFiles, mergedConfig.includeTests
      )

      const fullText = await runAgentLoop(
        provider,
        {
          model:      mergedConfig.model,
          system:     systemPrompt,
          messages:   [{ role: 'user', content: userMessage }],
          max_tokens: 8192,
        },
        this.db,
        this.workspaceRoot,
        this.win,
      )

      // Write output file
      fs.writeFileSync(outputPath, fullText, 'utf8')

      this.setState({
        status: 'done',
        startedAt,
        outputPath,
        durationMs: Date.now() - startedAt,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ status: 'error', startedAt, message })
    }
  }

  abort(): void {
    this.abortController?.abort()
    if (this.state.status === 'running') {
      this.setState({ status: 'idle' })
    }
  }

  private setState(s: RiafRunState): void {
    this.state = s
    this.win.webContents.send(IPC.RIAF_STATE_CHANGE, s)
  }

  private buildProvider(model: string): ILLMProvider {
    const providerType = getSetting('llmProvider')
    if (providerType === 'anthropic') {
      const key = getSetting('anthropicApiKey')
      if (!key) throw new Error('Anthropic API key not configured. Go to Settings.')
      return new AnthropicProvider(key)
    } else {
      return new OpenAICompatProvider(
        getSetting('openAICompatBaseUrl'),
        getSetting('openAICompatApiKey'),
      )
    }
  }
}
```

---

## 13. Main Process Entry & IPC Handler Registration

### 13.1 `packages/main/src/index.ts` — App Entry Point

```typescript
// packages/main/src/index.ts
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, closeDb } from './db/db'
import { IndexingPipeline } from './indexer/indexingPipeline'
import { FileWatcher } from './indexer/fileWatcher'
import { RiafController } from './riaf/riafController'
import { registerIpcHandlers } from './ipcHandlers'
import { getStore, addRecentWorkspace } from './settingsStore'

// ── State (module-level singletons per workspace session) ─────────────────────
let mainWindow: BrowserWindow | null = null
let currentWorkspaceRoot: string | null = null
let pipeline: IndexingPipeline | null = null
let watcher: FileWatcher | null = null
let riafCtrl: RiafController | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    show:            false,
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload:          path.join(__dirname, '../preload/preload.js'),
      sandbox:          false,
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dev: load Vite dev server; Prod: load built index.html
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ── Workspace lifecycle ───────────────────────────────────────────────────────
export function openWorkspace(dir: string): void {
  if (!mainWindow) return

  // Tear down any existing session
  watcher?.stop()
  closeDb()
  currentWorkspaceRoot = null

  // Initialize new session
  currentWorkspaceRoot = dir
  const db = initDb(dir)
  addRecentWorkspace(dir)

  pipeline = new IndexingPipeline(db, dir, mainWindow)
  watcher  = new FileWatcher(db, dir, mainWindow)
  riafCtrl = new RiafController(db, dir, mainWindow)

  // Auto-start indexing
  pipeline.run()

  // Start file watching AFTER first indexing completes
  // (file watcher listens on indexer:complete — handled in renderer via
  //  a one-time listener, then calls back to main via startWatcher IPC)
}

export function getOpenWorkspaceRoot() { return currentWorkspaceRoot }
export function getPipeline()          { return pipeline }
export function getWatcher()           { return watcher }
export function getRiafController()    { return riafCtrl }

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.riafstudio.app')

  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  createWindow()

  // Register all ipcMain.handle calls
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher?.stop()
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})
```

### 13.2 `packages/main/src/ipcHandlers.ts` — All IPC Registrations

```typescript
// packages/main/src/ipcHandlers.ts
import { ipcMain, dialog } from 'electron'
import { getDb } from './db/db'
import { EmbeddingService } from './indexer/embeddingService'
import {
  openWorkspace, getOpenWorkspaceRoot,
  getPipeline, getWatcher, getRiafController,
} from './index'
import { getSetting, setSetting } from './settingsStore'
import { GitIndexer } from './indexer/gitIndexer'

export function registerIpcHandlers(): void {

  // ── Workspace ───────────────────────────────────────────────────────────────
  ipcMain.handle('workspace:open', async (_e, providedDir?: string) => {
    let dir = providedDir
    if (!dir) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Repository',
      })
      if (result.canceled || !result.filePaths[0]) return null
      dir = result.filePaths[0]
    }
    openWorkspace(dir)
    return dir
  })

  ipcMain.handle('workspace:close', () => {
    getWatcher()?.stop()
    return true
  })

  ipcMain.handle('workspace:getProfile', () => {
    const db = getDb()
    const row = db.prepare(`
      SELECT workspace_root, last_scanned_at, language_stack_json, frameworks_json,
             package_managers_json, build_commands_json, test_commands_json,
             lint_commands_json, file_count, total_loc, project_purpose, architecture_summary
      FROM workspace_profiles WHERE id = 1
    `).get() as Record<string, unknown> | undefined
    if (!row) return null
    return {
      workspaceRoot:       row['workspace_root'],
      lastScannedAt:       row['last_scanned_at'],
      languageStack:       JSON.parse(row['language_stack_json'] as string),
      frameworks:          JSON.parse(row['frameworks_json'] as string),
      packageManagers:     JSON.parse(row['package_managers_json'] as string),
      buildCommands:       JSON.parse(row['build_commands_json'] as string),
      testCommands:        JSON.parse(row['test_commands_json'] as string),
      lintCommands:        JSON.parse(row['lint_commands_json'] as string),
      fileCount:           row['file_count'],
      totalLoc:            row['total_loc'],
      projectPurpose:      row['project_purpose'],
      architectureSummary: row['architecture_summary'],
      isStale:             false,
    }
  })

  // ── Indexer ─────────────────────────────────────────────────────────────────
  ipcMain.handle('indexer:start', async () => {
    await getPipeline()?.run()
  })

  ipcMain.handle('indexer:abort', () => {
    getPipeline()?.abort()
  })

  ipcMain.handle('indexer:getStatus', () => ({
    isRunning:         getPipeline()?.running ?? false,
    lastCompletedAt:   null,   // store in settings if needed
  }))

  // ── Search ───────────────────────────────────────────────────────────────────
  ipcMain.handle('search:codebase', (_e, { query, max = 10 }: { query: string; max?: number }) => {
    const db = getDb()
    const sanitized = query.replace(/['"*()]/g, ' ').trim() + '*'
    return db.prepare<[string, number], {
      file_path: string; start_line: number; end_line: number; chunk_text: string
    }>(`
      SELECT c.file_path, c.start_line, c.end_line, substr(c.chunk_text, 1, 400) as chunk_text
      FROM chunks_fts
      JOIN code_chunks c ON c.rowid = chunks_fts.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts) LIMIT ?
    `).all(sanitized, max).map(r => ({
      filePath:  r.file_path,
      startLine: r.start_line,
      endLine:   r.end_line,
      snippet:   r.chunk_text,
      score:     1,
    }))
  })

  ipcMain.handle('search:codebaseHybrid', async (_e, { query, max = 10 }: { query: string; max?: number }) => {
    return EmbeddingService.getInstance().hybridSearch(getDb(), query, max)
  })

  ipcMain.handle('search:symbols', (_e, { query, max = 15 }: { query: string; max?: number }) => {
    const db = getDb()
    const sanitized = query.replace(/['"*()]/g, ' ').trim() + '*'
    return db.prepare<[string, number], {
      name: string; kind: string; file_path: string; start_line: number;
      end_line: number; signature: string; docstring: string; is_exported: number
    }>(`
      SELECT s.name, s.kind, s.file_path, s.start_line, s.end_line,
             s.signature, s.docstring, s.is_exported
      FROM symbols_fts
      JOIN symbols s ON s.rowid = symbols_fts.rowid
      WHERE symbols_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(sanitized, max).map(r => ({
      name:       r.name,
      kind:       r.kind,
      filePath:   r.file_path,
      startLine:  r.start_line,
      endLine:    r.end_line,
      signature:  r.signature,
      docstring:  r.docstring,
      isExported: r.is_exported === 1,
      contentHash: '',
    }))
  })

  // ── UCG ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('ucg:getGraph', () => {
    const db = getDb()
    const nodes = db.prepare('SELECT * FROM ucg_file_nodes').all()
    const edges = db.prepare('SELECT * FROM ucg_import_edges').all()
    const metrics = db.prepare('SELECT * FROM ucg_graph_metrics WHERE id = 1').get() as
      Record<string, unknown> | undefined
    return {
      nodes: nodes.map((n: Record<string, unknown>) => ({
        id:             n['id'],
        filePath:       n['file_path'],
        language:       n['language'],
        nodeType:       n['node_type'],
        archLayer:      n['arch_layer'],
        isEntryPoint:   n['is_entry_point'] === 1,
        importCount:    n['import_count'],
        importedByCount: n['imported_by_count'],
      })),
      edges: edges.map((e: Record<string, unknown>) => ({
        id:           e['id'],
        fromFile:     e['from_file'],
        toModule:     e['to_module'],
        resolvedFile: e['resolved_file'],
        isExternal:   e['is_external'] === 1,
        edgeType:     e['edge_type'],
      })),
      metrics: metrics ? {
        totalNodes:   metrics['total_nodes'],
        totalEdges:   metrics['total_edges'],
        entryCount:   metrics['entry_count'],
        cycleCount:   metrics['cycle_count'],
        cycles:       JSON.parse(metrics['cycles_json'] as string),
        hotFiles:     JSON.parse(metrics['hot_files_json'] as string),
        externalDeps: JSON.parse(metrics['external_deps_json'] as string),
        computedAt:   metrics['computed_at'],
      } : null,
    }
  })

  ipcMain.handle('ucg:getMetrics', () => {
    const row = getDb().prepare('SELECT * FROM ucg_graph_metrics WHERE id = 1').get() as
      Record<string, unknown> | undefined
    if (!row) return null
    return {
      totalNodes:   row['total_nodes'],
      totalEdges:   row['total_edges'],
      entryCount:   row['entry_count'],
      cycleCount:   row['cycle_count'],
      cycles:       JSON.parse(row['cycles_json'] as string),
      hotFiles:     JSON.parse(row['hot_files_json'] as string),
      externalDeps: JSON.parse(row['external_deps_json'] as string),
      computedAt:   row['computed_at'],
    }
  })

  ipcMain.handle('ucg:getImportGraph', (_e, { filePath, direction }) => {
    const db = getDb()
    const imports = ['imports', 'both'].includes(direction) ?
      db.prepare<[string], { resolved_file: string | null; to_module: string }>(
        'SELECT resolved_file, to_module FROM ucg_import_edges WHERE from_file = ?'
      ).all(filePath).map(r => r.resolved_file ?? r.to_module) : []

    const importedBy = ['importedBy', 'both'].includes(direction) ?
      db.prepare<[string], { from_file: string }>(
        'SELECT from_file FROM ucg_import_edges WHERE resolved_file = ?'
      ).all(filePath).map(r => r.from_file) : []

    const externalDeps = db.prepare<[string], { to_module: string }>(
      'SELECT to_module FROM ucg_import_edges WHERE from_file = ? AND is_external = 1'
    ).all(filePath).map(r => r.to_module)

    return { imports, importedBy, externalDeps }
  })

  // ── Git ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('git:diffStat', async () => {
    const root = getOpenWorkspaceRoot()
    if (!root) return null
    return new GitIndexer(getDb(), root).getDiffStat()
  })

  ipcMain.handle('git:recentlyChanged', async (_e, limit = 20) => {
    const db = getDb()
    return db.prepare<[number], { file_path: string; change_count: number; last_changed: string }>(
      'SELECT file_path, change_count, last_changed FROM git_file_stats ORDER BY change_count DESC LIMIT ?'
    ).all(limit)
  })

  // ── RIAF ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('riaf:start', async (_e, config) => {
    await getRiafController()?.start(config)
  })

  ipcMain.handle('riaf:abort', () => {
    getRiafController()?.abort()
  })

  ipcMain.handle('riaf:getState', () => {
    return getRiafController()?.getState() ?? { status: 'idle' }
  })

  // ── Settings ─────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', (_e, key: string) => getSetting(key as never))
  ipcMain.handle('settings:set', (_e, { key, value }: { key: string; value: unknown }) => {
    setSetting(key as never, value as never)

    // Side effect: reconfigure embedding service when relevant settings change
    if (key === 'embeddingBaseUrl' || key === 'embeddingApiKey') {
      EmbeddingService.configure(
        getSetting('embeddingBaseUrl'),
        getSetting('embeddingApiKey'),
      )
    }
  })

  // ── Dialog (direct call, no event bus needed) ─────────────────────────────────
  ipcMain.handle('dialog:showOpen', (_e, opts: Electron.OpenDialogOptions) =>
    dialog.showOpenDialog(opts)
  )

  // ── ISS stubs (Phase 1: return not-implemented) ───────────────────────────────
  for (const ch of ['iss:traceFeature','iss:impactAnalysis','iss:featureStatus',
                     'iss:findSimilar','iss:genCriteria','iss:suggestArch']) {
    ipcMain.handle(ch, () => ({ error: 'ISS Graph not yet implemented' }))
  }
}
```

---

## 14. React Renderer — App Shell & Store

### 14.1 Zustand Stores

```typescript
// packages/renderer/src/store/workspace.store.ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { WorkspaceProfile, UCGGraphData } from '@shared/index'

type WorkspaceState = {
  root:         string | null
  profile:      WorkspaceProfile | null
  ucgData:      UCGGraphData | null
  recentPaths:  string[]

  setRoot:      (root: string | null) => void
  setProfile:   (p: WorkspaceProfile | null) => void
  setUcgData:   (d: UCGGraphData | null) => void
  setRecents:   (paths: string[]) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    root:        null,
    profile:     null,
    ucgData:     null,
    recentPaths: [],

    setRoot:    (root)    => set(s => { s.root = root }),
    setProfile: (profile) => set(s => { s.profile = profile }),
    setUcgData: (d)       => set(s => { s.ucgData = d }),
    setRecents: (paths)   => set(s => { s.recentPaths = paths }),
  }))
)
```

```typescript
// packages/renderer/src/store/indexing.store.ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { IndexingStatus } from '@shared/index'

type IndexingState = {
  isRunning:       boolean
  lastStatus:      IndexingStatus | null
  completedAt:     number | null
  error:           string | null

  setRunning:      (v: boolean) => void
  setStatus:       (s: IndexingStatus) => void
  setCompletedAt:  (t: number) => void
  setError:        (msg: string | null) => void
}

export const useIndexingStore = create<IndexingState>()(
  immer((set) => ({
    isRunning:    false,
    lastStatus:   null,
    completedAt:  null,
    error:        null,

    setRunning:     (v)   => set(s => { s.isRunning = v }),
    setStatus:      (st)  => set(s => { s.lastStatus = st }),
    setCompletedAt: (t)   => set(s => { s.completedAt = t }),
    setError:       (msg) => set(s => { s.error = msg }),
  }))
)
```

```typescript
// packages/renderer/src/store/riaf.store.ts
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RiafRunState, RiafStreamChunk } from '@shared/index'

type RiafState = {
  runState:     RiafRunState
  streamBuffer: RiafStreamChunk[]

  setRunState:   (s: RiafRunState) => void
  appendChunk:   (c: RiafStreamChunk) => void
  clearBuffer:   () => void
}

export const useRiafStore = create<RiafState>()(
  immer((set) => ({
    runState:     { status: 'idle' },
    streamBuffer: [],

    setRunState:  (s) => set(st => { st.runState = s }),
    appendChunk:  (c) => set(st => { st.streamBuffer.push(c) }),
    clearBuffer:  ()  => set(st => { st.streamBuffer = [] }),
  }))
)
```

### 14.2 App Shell

```typescript
// packages/renderer/src/App.tsx
import { useState, useEffect } from 'react'
import { useWorkspaceStore } from './store/workspace.store'
import { useIndexingStore }  from './store/indexing.store'
import { useRiafStore }      from './store/riaf.store'
import { WorkspacePanel }    from './panels/WorkspacePanel'
import { IndexingPanel }     from './panels/IndexingPanel'
import { UCGGraphPanel }     from './panels/UCGGraphPanel'
import { SearchPanel }       from './panels/SearchPanel'
import { SymbolBrowserPanel } from './panels/SymbolBrowserPanel'
import { RiafPanel }         from './panels/RiafPanel'
import { SettingsPanel }     from './panels/SettingsPanel'
import { Sidebar }           from './components/Sidebar'

type ActivePanel = 'workspace' | 'indexing' | 'ucg' | 'search' | 'symbols' | 'riaf' | 'settings'

export default function App() {
  const [activePanel, setActivePanel] = useState<ActivePanel>('workspace')
  const root = useWorkspaceStore(s => s.root)
  const { setStatus, setRunning, setCompletedAt, setError } = useIndexingStore()
  const { setRunState, appendChunk } = useRiafStore()

  // Wire up IPC event listeners for push events from main
  useEffect(() => {
    const api = window.electronAPI

    const unsubProgress = api.onIndexerProgress((status) => {
      setStatus(status)
      setRunning(true)
    })
    const unsubComplete = api.onIndexerComplete(() => {
      setRunning(false)
      setCompletedAt(Date.now())
      // Refresh UCG data and profile after indexing
      api.getUCGGraph().then(d => useWorkspaceStore.getState().setUcgData(d))
      api.getProfile().then(p => useWorkspaceStore.getState().setProfile(p))
    })
    const unsubError = api.onIndexerError((msg) => {
      setRunning(false)
      setError(msg)
    })
    const unsubRiafStream = api.onRiafStream((chunk) => appendChunk(chunk))
    const unsubRiafState  = api.onRiafStateChange((state) => setRunState(state))

    return () => {
      unsubProgress(); unsubComplete(); unsubError()
      unsubRiafStream(); unsubRiafState()
    }
  }, [])

  // Load recent workspaces on mount
  useEffect(() => {
    window.electronAPI.getSettings<string[]>('recentWorkspaces').then(paths => {
      useWorkspaceStore.getState().setRecents(paths ?? [])
    })
  }, [])

  const panels: Record<ActivePanel, React.ReactNode> = {
    workspace: <WorkspacePanel onWorkspaceOpened={(dir) => {
      useWorkspaceStore.getState().setRoot(dir)
      setActivePanel('indexing')
    }} />,
    indexing:  <IndexingPanel />,
    ucg:       <UCGGraphPanel />,
    search:    <SearchPanel />,
    symbols:   <SymbolBrowserPanel />,
    riaf:      <RiafPanel />,
    settings:  <SettingsPanel />,
  }

  return (
    <div className="flex h-screen w-screen bg-[#0d0d0f] text-zinc-100 overflow-hidden font-mono">
      <Sidebar
        active={activePanel}
        onSelect={setActivePanel}
        hasWorkspace={!!root}
      />
      <main className="flex-1 overflow-hidden">
        {panels[activePanel]}
      </main>
    </div>
  )
}
```

---

## 15. UI Panels — Detailed Specifications

Each panel spec below includes: purpose, key state, layout, and the critical interaction flows.
Full component code is omitted for brevity but these specs are complete enough to implement directly.

### 15.1 WorkspacePanel

**Purpose**: Open a repository or re-open a recent one.

**Layout**:
```
┌─────────────────────────────────────────────┐
│   RIAF Studio                               │
│   Repository Intelligence Framework         │
│                                             │
│   [ Open Repository ]   ← large button      │
│                                             │
│   Recent                                    │
│   ─────────────────────────────────────     │
│   ▸ ~/projects/my-app          2h ago       │
│   ▸ ~/code/api-service         1d ago       │
│   ▸ /work/monorepo             3d ago       │
│                                             │
└─────────────────────────────────────────────┘
```

**Key interactions**:
- "Open Repository" button → calls `window.electronAPI.openWorkspace()` (shows OS picker)
- Clicking a recent item → calls `window.electronAPI.openWorkspace(path)`
- Both → navigate to IndexingPanel automatically (handled in App.tsx)

### 15.2 IndexingPanel

**Purpose**: Live progress display during the 10-stage indexing pipeline.

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  Indexing ~/projects/my-app                         │
│  ────────────────────────────────────────────────   │
│  ✓ scan        files: 2,341 discovered              │
│  ✓ chunk       2,341 files → 18,203 chunks          │
│  ✓ symbols     6,892 symbols extracted              │
│  ✓ imports     14,201 import edges                  │
│  ✓ graph       UCG: 2,341 nodes, 3 cycles           │
│  ✓ commands    npm run build, npm test              │
│  ✓ git         last 100 commits analyzed            │
│  ◌ embeddings  [████████░░] 84% — 15,290/18,203     │
│  ○ profile                                          │
│                                                     │
│  Elapsed: 12.4s          [ Abort ]                  │
└─────────────────────────────────────────────────────┘
```

**Key interactions**:
- Subscribes to `indexer:progress` events via store
- Each stage row shows: ✓ (done) / ◌ (running + progress bar) / ○ (pending)
- After completion: shows summary card (files/chunks/symbols/cycles/hot-files)
- "Run RIAF Analysis →" button appears after completion

### 15.3 UCGGraphPanel

**Purpose**: Interactive visualization of the file-level import graph.

**Implementation**: Use `reactflow`. Nodes are files, edges are imports.
Color-code by `archLayer`: presentation=#6366f1, domain=#10b981, infra=#f59e0b,
test=#94a3b8, build=#ef4444.

**Layout**:
```
┌──────────────────────────────────────────────────────────────────┐
│  UCG — Universal Context Graph          [Filters ▼] [Layout ▼]  │
│  2,341 nodes · 14,201 edges · 3 cycles                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                                                            │ │
│  │         [graph canvas — React Flow]                        │ │
│  │         Drag to pan, scroll to zoom                        │ │
│  │         Click node → file detail panel                     │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Legend: ■ presentation  ■ domain  ■ infra  ■ test  ■ build    │
│                                                                  │
│  Selected: src/services/AuthService.ts                           │
│  Imports (3): crypto, src/db/db.ts, src/utils/logger.ts         │
│  Imported by (7): src/routes/auth.ts, src/app.ts …              │
└──────────────────────────────────────────────────────────────────┘
```

**Performance note**: For repos with >2,000 files, use React Flow's `<MiniMap>` and
viewport-culled rendering. Pre-cluster by archLayer using a hierarchical layout
(dagre library) before passing nodes to React Flow.

**Key interactions**:
- Click node → shows import-graph side panel for that file
- Filter by archLayer (checkboxes in dropdown)
- "Show cycles" toggle highlights cycle nodes in red
- Layout dropdown: dagre-hierarchical | dagre-LR | force-directed

### 15.4 SearchPanel

**Purpose**: Full-text + hybrid semantic search over the indexed codebase.

**Layout**:
```
┌──────────────────────────────────────────────────────────────────┐
│  Search                                                          │
│                                                                  │
│  [ PaymentService charge method_______________ ]  [BM25 ▾]      │
│                                                                  │
│  12 results                              Hybrid search on ✓      │
│  ─────────────────────────────────────────────────────────────  │
│  ▸ src/services/payment.service.ts :45                           │
│    async charge(amount: number, customerId: string): Promise<… │
│                                                                  │
│  ▸ src/services/payment.service.ts :112                          │
│    private async validateCharge(data: ChargePayload): Promise… │
│                                                                  │
│  ▸ src/tests/payment.spec.ts :23                                 │
│    describe('PaymentService.charge', () => { …                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key interactions**:
- Debounced search (300ms) on input change
- Toggle between BM25-only / hybrid (BM25+embeddings)
- Click result → opens file at line in OS default editor via `shell.openPath`
- Right-click → "Copy path", "Copy snippet"

### 15.5 SymbolBrowserPanel

**Purpose**: Browse/search extracted symbols (functions, classes, interfaces).

**Layout**:
```
┌──────────────────────────────────────────────────────────────────┐
│  Symbol Browser                                                  │
│                                                                  │
│  [ AuthService___________________________ ]  Kind: [All ▾]       │
│                                                                  │
│  KIND      NAME               FILE                   LINE        │
│  ─────────────────────────────────────────────────────────────  │
│  class     AuthService        src/services/auth.ts    12         │
│  function  validateToken      src/services/auth.ts    45         │
│  interface IAuthService       src/types/auth.ts       3          │
│  function  hashPassword       src/utils/crypto.ts     78         │
│                                                                  │
│  [ function validateToken ]─────────────────────────────────── │
│  src/services/auth.ts : L45–L67                                  │
│  signature: (token: string, secret: string): boolean             │
│  // Validates a JWT token against the signing secret             │
└──────────────────────────────────────────────────────────────────┘
```

### 15.6 RiafPanel

**Purpose**: Configure and run the RIAF analysis agent; stream its output live.

**Layout**:
```
┌──────────────────────────────────────────────────────────────────┐
│  RIAF Analysis                                                   │
│                                                                  │
│  Output file:    [ repo_context.md              ]               │
│  Max files:      [ 150     ]   Include tests: [ ]               │
│  Model:          [ claude-sonnet-4-6 ▾ ]                        │
│                                                                  │
│  [ ▶ Run Analysis ]                [ ✕ Abort ]                  │
│                                                                  │
│  ─────────────────── Live Output ──────────────────────────── │
│  ▸ Using tool: read_file(src/index.ts)                           │
│  ▸ Using tool: get_ucg_metrics()                                 │
│  ▸ Using tool: search_codebase("entry point bootstrap")         │
│                                                                  │
│  # repo_context.md                                               │
│  > Auto-generated by RIAF Studio …                               │
│                                                                  │
│  ## 1. What This Repository Does                                 │
│  This repository implements a …                                  │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Status: Running · 8 tool calls · 2m 14s                        │
│  [ Open Output File ]                                            │
└──────────────────────────────────────────────────────────────────┘
```

**Key interactions**:
- "Run Analysis" → calls `window.electronAPI.startRiaf(config)` + clears stream buffer
- Stream buffer renders in a scrolling `<pre>` with auto-scroll-to-bottom
- Tool use events shown as collapsible "▸ Using tool: X(args)" lines (dimmer color)
- Text delta events rendered as Markdown (use `marked` or `@uiw/react-markdown-preview`)
- "Open Output File" → `window.electronAPI` → `shell.openPath` in main

### 15.7 SettingsPanel

**Purpose**: Configure LLM provider, embeddings, and app preferences.

**Sections**:
1. **LLM Provider** — Radio: Anthropic / OpenAI-compatible → conditional fields for API key / base URL / model
2. **Embeddings** — Toggle to enable, base URL, API key, model selection
3. **RIAF Defaults** — Max files, include tests, default model
4. **Appearance** — Theme (dark/light/system)
5. **Danger Zone** — Clear all indexed data for current workspace

**Pattern**: Each field calls `window.electronAPI.setSettings(key, value)` on blur.
Show a green ✓ tick for 2 seconds after successful save.

---

## 16. Cross-Platform Packaging

### 16.1 `packages/renderer/src/main.tsx` — Renderer Entry

```tsx
// packages/renderer/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### 16.2 `packages/renderer/tailwind.config.ts`

```typescript
// packages/renderer/tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // RIAF Studio design tokens
        surface:   '#0d0d0f',    // main background
        'surface-2': '#141418',  // card/panel background
        'surface-3': '#1c1c23',  // input/hover background
        border:    '#2a2a35',    // subtle borders
        accent:    '#7c6aff',    // primary accent — electric indigo
        'accent-2': '#10b981',   // secondary — graph domain-green
        warn:      '#f59e0b',    // cycles / warnings
        danger:    '#ef4444',    // errors
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
```

### 16.3 `packages/renderer/index.html`

```html
<!-- packages/renderer/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- CSP: no inline scripts, only same-origin and Vite HMR ws: -->
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
  <title>RIAF Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

### 16.4 Platform-Specific Notes

**Windows:**
- `better-sqlite3` is rebuilt for Windows x64/arm64 by `@electron/rebuild` automatically
- Chokidar uses `usePolling: true` on Windows (already set in `fileWatcher.ts`)
- `execFile('git', ...)` requires Git in PATH; show a user-friendly banner if `git --version` fails
- App data path: `%APPDATA%\riaf-studio\` (Electron sets `app.getPath('userData')` correctly)
- Squirrel installer: configured in `forge.config.ts`; creates Start Menu shortcut, supports silent install/update

**macOS:**
- Chokidar uses FSEvents natively (no polling)
- `hiddenInset` title bar in `createWindow()` gives the native macOS traffic lights look
- App sandbox: disabled in our config (required for file system access; add entitlements if distributing via App Store)
- `.dmg` maker handles drag-to-Applications installation
- Apple Silicon: `better-sqlite3` is pre-built for arm64; `@electron/rebuild` handles universal builds with `--arch universal`

**Both:**
- `.riaf/` folder is created per-workspace (hidden directory; `.gitignore` this in templates)
- `shell.openPath(outputPath)` opens the RIAF output file in the OS default Markdown editor
- Window state (size/position) should be persisted via `electron-window-state` package

### 16.5 Complete Build Commands

```bash
# Development (hot reload)
pnpm dev

# Production build
pnpm build

# Rebuild native modules (run after node_modules install or Electron version change)
pnpm rebuild

# Package (creates distributables in out/)
pnpm package

# Make installers (squirrel.exe for Windows, .dmg for macOS)
pnpm make

# Cross-compile from macOS for Windows (requires wine / electron-forge cross-compile)
# pnpm make --platform win32 --arch x64

# Tests
pnpm test
```

---

## 17. ISS Extensibility Contract

This section defines the precise contract that ISS Phase 1 must satisfy when building on top of RIAF.
These are architectural guarantees RIAF makes, not things ISS has to work around.

### 17.1 Database contract

RIAF guarantees these tables exist and will never be dropped or renamed:

| Table | ISS usage |
|---|---|
| `graph_nodes` | INSERT ISS nodes (EPIC, FEATURE, DOMAIN_SERVICE, etc.) with their kind/phase/label |
| `graph_edges` | INSERT ISS edges (IMPLEMENTS, TRACES_TO, VALIDATES, CO_CHANGES_WITH, etc.) |
| `feature_traces` | MATERIALIZED cache for feature→code traversal results |
| `symbols` | READ ONLY — ISS promotes symbol rows to FUNCTION/CLASS graph nodes |
| `file_metadata` | READ ONLY — ISS uses file_id FK for structural nodes |
| `ucg_import_edges` | READ ONLY — ISS reads IMPORTS edges from here |
| `code_chunks` + FTS | READ ONLY — ISS uses BM25 as α-signal in FIS |
| `chunk_embeddings` | READ ONLY — ISS uses cosine similarity as β-signal in FIS |
| `git_file_stats` | READ ONLY — ISS uses change_count for CO_CHANGES_WITH seed data |

### 17.2 IPC contract

RIAF guarantees these IPC channels exist:

| Channel | ISS use |
|---|---|
| `search:codebase` | FIS α-signal (BM25) |
| `search:codebaseHybrid` | FIS β-signal (BM25+cosine) |
| `search:symbols` | Symbol lookup for structural node promotion |
| `ucg:getImportGraph` | Import graph traversal for Pass A |
| `git:recentlyChanged` | Co-change seed data for Pass B |

RIAF reserves the `iss:*` IPC namespace. ISS registers its 6 PO tool handlers into this namespace by calling `registerIssIpcHandlers(ipcMain, db, workspaceRoot)` — a function ISS provides and RIAF calls after `registerIpcHandlers()` in `index.ts`.

### 17.3 Tool plugin contract

The RIAF agent tool system accepts plugin registration:

```typescript
// packages/main/src/riaf/riafTools.ts (addition for ISS)

export type ToolPlugin = {
  tool:    LLMTool
  execute: (input: Record<string, unknown>,
            db: Database.Database,
            root: string) => Promise<string>
}

const registeredPlugins: ToolPlugin[] = []

export function registerToolPlugin(plugin: ToolPlugin): void {
  registeredPlugins.push(plugin)
}

// Called by buildRiafTools() — ISS tools appear in the RIAF agent's tool list
export function getAllTools(): LLMTool[] {
  return [...buildRiafTools(), ...registeredPlugins.map(p => p.tool)]
}
```

ISS Phase 1 calls `registerToolPlugin({ tool: traceFeatureTool, execute: traceFeatureExecute })` for each of its 6 PO tools.

### 17.4 Indexing pipeline hook

RIAF's `IndexingPipeline.run()` calls a post-indexing hook after all 10 stages:

```typescript
// packages/main/src/indexer/indexingPipeline.ts (addition)
type PostIndexHook = (db: Database.Database, root: string) => Promise<void>
const postIndexHooks: PostIndexHook[] = []

export function registerPostIndexHook(hook: PostIndexHook): void {
  postIndexHooks.push(hook)
}
```

ISS Phase 1 registers its Pass A (static analysis graph construction) and Pass B (git mining) as post-index hooks. They run automatically after every full RIAF index.

### 17.5 Preload extension

ISS does NOT touch `preload.ts`. Instead it imports `ElectronAPI` type from `@riaf-studio/shared` and adds its own renderer-side API in a separate module:

```typescript
// Future: packages/renderer/src/api/issAPI.ts
import type { ElectronAPI } from '../../preload/src/preload'
// Uses window.electronAPI.iss:* channels already declared in shared/ipc.channels.ts
```

---

## 18. Build Order & Milestones

### M0 — Scaffold (Day 1)
Complete §4 scaffold and §5 shared types. Verify `pnpm dev` launches a blank Electron window.
**Gate**: window opens, DevTools console shows no errors.

### M1 — Data Pipeline Core (Days 2–5)
Implement §7 database layer (schema + migrations), §8.1 WorkspaceScanner, §8.2 CodeChunker,
§8.3 SymbolExtractor, §8.4 ImportExtractor, §8.5 NodeClassifier, §8.6 GraphAnalyzer.
**Gate**: On a real TypeScript repo, `pnpm dev` → open workspace → DB has non-empty
`code_chunks`, `symbols`, `ucg_file_nodes` tables. Query them directly in SQLite browser.

### M2 — Full Indexing Pipeline (Days 6–8)
Add §8.7 CommandDetector, §8.8 GitIndexer, §8.9 EmbeddingService (stub fallback first),
§8.10 FileWatcher, §9 ProfileBuilder, §10 SettingsStore, §13 IPC handlers.
**Gate**: Full pipeline runs end-to-end, pushes progress events, completes within 60s on a
5,000-file TypeScript monorepo.

### M3 — IPC Surface + React Shell (Days 9–12)
Implement §6 preload, §14 stores + App shell, §15.1–15.5 (Workspace/Indexing/UCG/Search/Symbol panels).
**Gate**: Open repo → indexing progress shown → UCG graph renders → search returns results.

### M4 — LLM Layer + RIAF Agent (Days 13–16)
Implement §11 LLM providers (Anthropic + OpenAI-compat), §12 RIAF tools + agent + controller.
**Gate**: Run RIAF analysis on a real repo → `repo_context.md` written with all 12 sections populated.

### M5 — RIAF Panel + Settings + Polish (Days 17–20)
Implement §15.6 RiafPanel (live streaming), §15.7 SettingsPanel.
Add keyboard shortcuts (Cmd/Ctrl+O to open workspace, Cmd/Ctrl+R to re-index).
**Gate**: Full end-to-end user flow with settings persisted across restarts.

### M6 — Packaging (Days 21–22)
Build macOS `.dmg` and Windows `.exe` installers. Verify native module rebuild on both platforms.
**Gate**: Installer installs, app launches, full flow works on a clean machine.

### M7 — ISS Extensibility Hooks (Days 23–24)
Add §17 plugin contracts (tool plugin registration, post-index hook, IPC stubs).
**Gate**: All ISS IPC channels return `{ error: 'ISS not yet implemented' }` gracefully.
A toy ISS plugin (single `trace_feature_to_code` stub) registers without touching RIAF core code.

---

## 19. Testing Strategy

### 19.1 Unit tests (Vitest)

```
packages/main/src/indexer/__tests__/
  codeChunker.test.ts          ← chunk a 200-line TS file; assert chunk count + boundaries
  symbolExtractor.test.ts      ← extract symbols from fixture TS/Python/Java files
  importExtractor.test.ts      ← extract edges from ESM, CJS, dynamic import fixtures
  nodeClassifier.test.ts       ← classify 20 filenames; assert archLayer/nodeType
  graphAnalyzer.test.ts        ← build a 6-node graph with 1 cycle; assert Tarjan output
  commandDetector.test.ts      ← parse fixture package.json/Makefile/Cargo.toml
  gitIndexer.test.ts           ← mock execFile; assert change stats parsing
  embeddingService.test.ts     ← mock fetch; assert serialization roundtrip
```

Key fixture pattern — create small in-memory SQLite databases for each test:

```typescript
import Database from 'better-sqlite3'
import { applyMigrations } from '../db/migrations'

function makeTestDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}
```

### 19.2 Integration test

A single `indexer.integration.test.ts` that:
1. Creates a temporary directory
2. Writes 10 TypeScript fixture files with known import relationships and symbols
3. Runs the full `IndexingPipeline` against it (with a mock BrowserWindow that collects events)
4. Asserts: correct chunk count, correct symbol names, correct import edges, correct UCG metrics (cycle count = 1), correct command detection

### 19.3 E2E test (optional, Playwright + @playwright/test)

Use `@playwright/test` with the Electron app:
1. Launch app
2. Open the fixture directory
3. Wait for indexer:complete event
4. Assert the search panel returns results for a known symbol name
5. Assert the UCG panel renders nodes

### 19.4 Test commands

```bash
# Unit tests (fast, no Electron)
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage

# Integration test only
pnpm test indexer.integration
```

---

## Appendix A — Complete File Manifest

```
riaf-studio/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .npmrc
├── forge.config.ts
├── electron.vite.config.ts
├── .gitignore                  ← include: out/, node_modules/, .riaf/, *.node
├── resources/
│   ├── icon.icns
│   ├── icon.ico
│   └── icon.png
│
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ipc.channels.ts
│   │       ├── db.types.ts
│   │       ├── riaf.types.ts
│   │       └── indexer.types.ts
│   │
│   ├── main/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ipcHandlers.ts
│   │       ├── settingsStore.ts
│   │       ├── db/
│   │       │   ├── db.ts
│   │       │   ├── schema.ts
│   │       │   └── migrations.ts
│   │       ├── indexer/
│   │       │   ├── indexingPipeline.ts
│   │       │   ├── workspaceScanner.ts
│   │       │   ├── codeChunker.ts
│   │       │   ├── symbolExtractor.ts
│   │       │   ├── importExtractor.ts
│   │       │   ├── nodeClassifier.ts
│   │       │   ├── graphAnalyzer.ts
│   │       │   ├── commandDetector.ts
│   │       │   ├── gitIndexer.ts
│   │       │   ├── embeddingService.ts
│   │       │   ├── fileWatcher.ts
│   │       │   └── profileBuilder.ts
│   │       ├── llm/
│   │       │   ├── llmProvider.interface.ts
│   │       │   ├── anthropicProvider.ts
│   │       │   ├── openAICompatProvider.ts
│   │       │   ├── toolRunner.ts
│   │       │   └── contextAssembler.ts
│   │       └── riaf/
│   │           ├── riafTools.ts
│   │           ├── riafPrompts.ts
│   │           └── riafController.ts
│   │
│   ├── preload/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── preload.ts
│   │
│   └── renderer/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── styles/
│           │   └── globals.css
│           ├── store/
│           │   ├── workspace.store.ts
│           │   ├── indexing.store.ts
│           │   └── riaf.store.ts
│           ├── hooks/
│           │   └── useIpcEvent.ts
│           └── panels/
│               ├── WorkspacePanel/
│               │   └── index.tsx
│               ├── IndexingPanel/
│               │   └── index.tsx
│               ├── UCGGraphPanel/
│               │   └── index.tsx
│               ├── SearchPanel/
│               │   └── index.tsx
│               ├── SymbolBrowserPanel/
│               │   └── index.tsx
│               ├── RiafPanel/
│               │   └── index.tsx
│               └── SettingsPanel/
│                   └── index.tsx
│
└── packages/main/src/__tests__/
    ├── codeChunker.test.ts
    ├── symbolExtractor.test.ts
    ├── importExtractor.test.ts
    ├── nodeClassifier.test.ts
    ├── graphAnalyzer.test.ts
    ├── commandDetector.test.ts
    ├── gitIndexer.test.ts
    ├── embeddingService.test.ts
    └── indexer.integration.test.ts
```

---

## Appendix B — Critical `better-sqlite3` Cross-Platform Checklist

Run this checklist before every release build:

```bash
# 1. Verify Electron ABI version
node -e "console.log(process.versions.modules)"  # Electron 31 = 127

# 2. Rebuild for current Electron ABI
npx @electron/rebuild -f -w better-sqlite3 -v $(cat node_modules/electron/package.json | jq -r .version)

# 3. Smoke-test the rebuilt module
node -e "require('better-sqlite3')(':memory:').prepare('SELECT 1').get()"

# 4. Verify WAL mode + recursive CTE work (critical for ISS Phase 2)
node -e "
  const db = require('better-sqlite3')(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, parent_id INTEGER, val TEXT)')
  db.exec(\"INSERT INTO t VALUES (1,NULL,'root'),(2,1,'child'),(3,2,'grandchild')\")
  const rows = db.prepare(\`
    WITH RECURSIVE tree(id, val, depth) AS (
      SELECT id, val, 0 FROM t WHERE parent_id IS NULL
      UNION ALL
      SELECT t.id, t.val, tree.depth+1 FROM t JOIN tree ON t.parent_id = tree.id
    ) SELECT * FROM tree
  \`).all()
  console.assert(rows.length === 3, 'CTE failed')
  console.log('✓ better-sqlite3 + WAL + recursive CTE OK')
"

# 5. Verify FTS5 (required for search)
node -e "
  const db = require('better-sqlite3')(':memory:')
  db.exec('CREATE VIRTUAL TABLE ft USING fts5(content)')
  db.prepare('INSERT INTO ft VALUES (?)').run('hello world')
  const r = db.prepare(\"SELECT * FROM ft WHERE ft MATCH 'hello*'\").all()
  console.assert(r.length === 1, 'FTS5 failed')
  console.log('✓ FTS5 OK')
"
```

---

*End of Part 2. Together, Parts 1 and 2 form a complete, self-contained implementation plan for RIAF Studio — 30+ TypeScript files specified, 19 SQLite tables, 10-stage indexing pipeline, dual LLM providers, a 9-tool RIAF agent, 7 UI panels, and a forward-compatible ISS extensibility contract.*
