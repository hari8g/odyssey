import Database from 'better-sqlite3'
import type { ScannedFile } from './workspaceScanner'

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

type LayerRule = { regex: RegExp; layer: string }
type NodeTypeRule = { regex: RegExp; type: string }
type EntryPointRule = { regex: RegExp }

const ARCH_LAYER_RULES: LayerRule[] = [
  // Tests
  { regex: /\.(test|spec|e2e|cy)\.[tj]sx?$/i, layer: 'test' },
  { regex: /\/(tests?|__tests?__|spec|e2e|cypress)\//i, layer: 'test' },
  // Presentation / UI
  { regex: /\/(pages|views|screens|components|layouts|ui)\//i, layer: 'presentation' },
  { regex: /\/(app|routes)\/.+\.(page|layout|loading|error|not-found)\.[tj]sx?$/i, layer: 'presentation' },
  { regex: /\.(stories|story)\.[tj]sx?$/i, layer: 'presentation' },
  // Application (use-cases / orchestration)
  { regex: /\/(use-?cases?|application|app)\//i, layer: 'application' },
  { regex: /\/(hooks|composables|stores?|state|context|redux|zustand)\//i, layer: 'application' },
  { regex: /\/(handlers?|controllers?|resolvers?|middleware)\//i, layer: 'application' },
  // Infrastructure
  { regex: /\/(db|database|repositories?|prisma|drizzle|knex|typeorm|mongoose)\//i, layer: 'infrastructure' },
  { regex: /\/(migrations?|seeds?)\//i, layer: 'infrastructure' },
  { regex: /\/(infra|infrastructure|adapters?|gateways?|clients?|api)\//i, layer: 'infrastructure' },
  { regex: /\/(config|configs?|configuration|env|settings?)\//i, layer: 'infrastructure' },
  { regex: /\/(scripts?|deploy|ci|\.github)\//i, layer: 'infrastructure' },
]

const NODE_TYPE_RULES: NodeTypeRule[] = [
  // Tests
  { regex: /\.(test|spec|e2e|cy)\.[tj]sx?$/, type: 'test' },
  { regex: /\/(tests?|__tests?__|spec|e2e|cypress)\//i, type: 'test' },
  // Config / build
  { regex: /\.(config|rc|env)\.[cm]?[tj]s?$/, type: 'config' },
  { regex: /(vite|webpack|rollup|esbuild|babel|eslint|prettier|jest|vitest|tailwind|postcss)\.config\./i, type: 'config' },
  { regex: /\/(config|configs?|configuration|settings?)\//i, type: 'config' },
  // Migration / seeds
  { regex: /\/(migrations?|seeds?)\//i, type: 'migration' },
  { regex: /\d{4,}.*\.(ts|js|sql)$/, type: 'migration' },
  // Types / schemas
  { regex: /\.(types?|interfaces?|schemas?|dtos?|models?|entities?)\.[tj]sx?$/, type: 'model' },
  { regex: /\/(types?|interfaces?|schemas?|models?|entities?|dtos?)\//i, type: 'model' },
  // Controllers / resolvers
  { regex: /\.(controller|resolver|handler)\.[tj]sx?$/, type: 'controller' },
  { regex: /\/(controllers?|resolvers?|handlers?)\//i, type: 'controller' },
  // Services
  { regex: /\.(service|services?)\.[tj]sx?$/, type: 'service' },
  { regex: /\/(services?)\//i, type: 'service' },
  // Hooks / composables
  { regex: /\/use[A-Z]\w+\.[tj]sx?$/, type: 'hook' },
  { regex: /\/(hooks?|composables?)\//i, type: 'hook' },
  // Components
  { regex: /\/[A-Z]\w+\.[tj]sx?$/, type: 'component' },
  { regex: /\/(components?|ui|widgets?)\//i, type: 'component' },
  // Pages / routes
  { regex: /\/(pages?|views?|screens?|routes?)\//i, type: 'page' },
  // Utilities
  { regex: /\.(util|utils?|helper|helpers?|lib|libs?)\.[tj]sx?$/, type: 'util' },
  { regex: /\/(utils?|helpers?|lib|libs?|common|shared|core)\//i, type: 'util' },
]

const ENTRY_POINT_RULES: EntryPointRule[] = [
  { regex: /\/(main|index)\.[tj]sx?$/ },
  { regex: /\/server\.[tj]s$/ },
  { regex: /\/app\.[tj]sx?$/ },
  { regex: /\/bin\/\w+\.[tj]s$/ },
  { regex: /\/(cli|start)\.[tj]s$/ },
  { regex: /__main__\.py$/ },
  { regex: /main\.go$/ },
  { regex: /main\.rs$/ },
  { regex: /main\.(java|kt)$/ },
]

// ---------------------------------------------------------------------------
// NodeClassifier
// ---------------------------------------------------------------------------

export class NodeClassifier {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  classifyAll(files: ScannedFile[], signal?: AbortSignal): void {
    const upsert = this.db.prepare(`
      INSERT INTO ucg_file_nodes (file_path, language, node_type, arch_layer, is_entry_point)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        language      = excluded.language,
        node_type     = excluded.node_type,
        arch_layer    = excluded.arch_layer,
        is_entry_point = excluded.is_entry_point
    `)

    const classifyBatch = this.db.transaction((batch: ScannedFile[]) => {
      for (const f of batch) {
        const { nodeType, archLayer, isEntryPoint } = classify(f.relativePath)
        upsert.run(f.relativePath, f.language, nodeType, archLayer, isEntryPoint ? 1 : 0)
      }
    })

    // Process in chunks to allow signal checking between batches
    const BATCH_SIZE = 200
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      if (signal?.aborted) break
      const batch = files.slice(i, i + BATCH_SIZE)
      classifyBatch(batch)
    }
  }
}

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

function classify(relativePath: string): {
  nodeType: string
  archLayer: string
  isEntryPoint: boolean
} {
  const archLayer = detectArchLayer(relativePath)
  const nodeType = detectNodeType(relativePath)
  const isEntryPoint = ENTRY_POINT_RULES.some((r) => r.regex.test(relativePath))

  return { nodeType, archLayer, isEntryPoint }
}

function detectArchLayer(p: string): string {
  for (const { regex, layer } of ARCH_LAYER_RULES) {
    if (regex.test(p)) return layer
  }
  return 'domain'
}

function detectNodeType(p: string): string {
  for (const { regex, type } of NODE_TYPE_RULES) {
    if (regex.test(p)) return type
  }
  return 'util'
}
