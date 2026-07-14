// packages/shared/src/db.types.ts

export type FileMetadataRow = {
  id: number
  workspaceRoot: string
  filePath: string
  language: string | null
  sizeBytes: number
  lastModified: number
  contentHash: string
}

export type ChunkType = 'function' | 'class' | 'block' | 'file'

export type CodeChunkRow = {
  id: string
  fileId: number
  filePath: string
  chunkText: string
  startLine: number
  endLine: number
  chunkType: ChunkType
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const'

export type ExtractedSymbol = {
  id: number
  fileId: number
  filePath: string
  name: string
  kind: SymbolKind
  startLine: number
  endLine: number
  signature: string
  docstring: string
  isExported: boolean
  contentHash: string
}

export type UCGFileNode = {
  id: number
  filePath: string
  language: string
  nodeType: string
  archLayer: string
  isEntryPoint: boolean
  importCount: number
  importedByCount: number
}

export type UCGImportEdge = {
  id: number
  fromFile: string
  toModule: string
  resolvedFile: string | null
  isExternal: boolean
  edgeType: string
}

export type UCGGraphMetrics = {
  totalNodes: number
  totalEdges: number
  entryCount: number
  cycleCount: number
  cycles: string[][]
  hotFiles: string[]
  externalDeps: Record<string, number>
  computedAt: number
}

export type UCGGraphData = {
  nodes: UCGFileNode[]
  edges: UCGImportEdge[]
  metrics: UCGGraphMetrics | null
}

export type FrameworkEntry = {
  name: string
  version: string | null
  confidence: 'high' | 'medium' | 'low'
}

export type CommandEntry = {
  command: string
  purpose: 'build' | 'test' | 'lint' | 'typecheck' | 'start' | 'format'
  confidence: 'high' | 'medium' | 'low'
  source: string
}

export type WorkspaceProfile = {
  workspaceRoot: string
  lastScannedAt: number
  languageStack: string[]
  frameworks: FrameworkEntry[]
  packageManagers: string[]
  buildCommands: CommandEntry[]
  testCommands: CommandEntry[]
  lintCommands: CommandEntry[]
  fileCount: number
  totalLoc: number
  projectPurpose: string | null
  architectureSummary: string | null
  isStale: boolean
}

export type GitFileStats = {
  file: string
  changeCount: number
  lastChanged: string
}

export type CodebaseSearchResult = {
  filePath: string
  startLine: number
  endLine: number
  snippet: string
  score: number
}

export type GraphNodeKind =
  | 'EPIC'
  | 'FEATURE'
  | 'USER_STORY'
  | 'ACCEPTANCE_CRITERION'
  | 'API_CONTRACT'
  | 'DOMAIN_SERVICE'
  | 'MODULE'
  | 'DATA_FLOW'
  | 'EXTERNAL_DEPENDENCY'
  | 'CLASS'
  | 'FUNCTION'
  | 'INTERFACE'
  | 'TYPE'
  | 'ENUM'
  | 'TEST_SUITE'
  | 'TEST_CASE'
  | 'MIGRATION'
  | 'CONFIG'
  | 'DEPLOYMENT_UNIT'
  // L0 Domain
  | 'DOMAIN_CONCEPT'
  | 'BUSINESS_RULE'
  | 'KPI'
  | 'BOUNDED_CONTEXT'
  | 'DOMAIN_EVENT'
  | 'REGULATION'
  | 'GLOSSARY_TERM'
  // L−2 Customer
  | 'CUSTOMER'
  | 'SEGMENT'
  | 'CUSTOMER_SIGNAL'
  | 'PAIN_POINT'
  | 'JOB_TO_BE_DONE'
  | 'MARKET_SIGNAL'
  | 'COMPETITOR_CAPABILITY'
  // L−1 Business
  | 'BUSINESS_OBJECTIVE'
  | 'BUSINESS_CASE'
  | 'VALUE_HYPOTHESIS'
  | 'COST_ESTIMATE'
  | 'RISK'
  | 'ORG_UNIT'
  | 'STAKEHOLDER_ROLE'
  | 'INVESTMENT'
  | 'PRICING_IMPACT'
  // L+4 Delivery
  | 'BUILD'
  | 'RELEASE_CANDIDATE'
  | 'QUALITY_GATE'
  | 'TEST_RUN'
  | 'ENVIRONMENT'
  | 'DEPLOYMENT'
  | 'FEATURE_FLAG'
  | 'INCIDENT'
  | 'TELEMETRY_STREAM'
  | 'KPI_OBSERVATION'
  // L+5 Outcome
  | 'OUTCOME'
  | 'IMPACT_ASSESSMENT'
  | 'HYPOTHESIS_VERDICT'
  | 'LEARNING'
  // Artifacts
  | 'BRIEF'
  | 'BUSINESS_IMPACT_ASSESSMENT'
  | 'DEV_IMPACT_ASSESSMENT'
  | 'GTM_NOTES'
  | 'PORTFOLIO_PACKET'
  | 'RELEASE_READINESS_REPORT'
  | 'OUTCOME_REPORT'
  | 'DECISION_RECORD'

export type SDLCPhase =
  | 'requirements'
  | 'design'
  | 'implementation'
  | 'testing'
  | 'deployment'
  | 'maintenance'

export type GraphNode = {
  id: number
  kind: GraphNodeKind
  label: string
  description: string | null
  sdlcPhase: SDLCPhase | null
  sdlcConfidence: number | null
  sourceType: 'symbol' | 'issue' | 'gherkin' | 'git' | 'llm' | 'manual'
  sourceRef: string | null
  filePath: string | null
  startLine: number | null
  endLine: number | null
  importanceScore: number
  symbolId: number | null
  fileId: number | null
}

export type GraphEdgeKind =
  | 'IMPLEMENTS'
  | 'TRACES_TO'
  | 'SPECIFIES'
  | 'VALIDATES'
  | 'SATISFIES'
  | 'CALLS'
  | 'IMPORTS'
  | 'INHERITS'
  | 'IMPLEMENTS_INTERFACE'
  | 'TESTS'
  | 'MIGRATES'
  | 'DEPENDS_ON'
  | 'PRECEDED_BY'
  | 'EVOLVED_FROM'
  | 'CO_CHANGES_WITH'
  // L0 Domain
  | 'BELONGS_TO_CONTEXT'
  | 'GOVERNED_BY'
  | 'ENFORCES'
  | 'INSTRUMENTS'
  | 'DERIVES_FROM'
  | 'CONSTRAINED_BY'
  | 'ABOUT'
  | 'EMITS'
  | 'CONSUMES'
  // L−2
  | 'EXPRESSES'
  | 'BELONGS_TO_SEGMENT'
  | 'HIRES_FOR'
  | 'THREATENS'
  | 'OPENS'
  // L−1
  | 'ADVANCES'
  | 'JUSTIFIED_BY'
  | 'PREDICTS'
  | 'MOTIVATES'
  | 'TARGETS'
  | 'ESTIMATED_BY'
  | 'EXPOSED_TO'
  | 'OWNED_BY'
  | 'CONSULTED_BY'
  | 'INFORMED_BY'
  | 'FUNDED_BY'
  | 'MEASURED_BY'
  // L+4
  | 'PACKAGED_IN'
  | 'GATED_BY'
  | 'EVIDENCED_BY'
  | 'DEPLOYED_TO'
  | 'EXPOSES_FLAG'
  | 'CAUSED'
  | 'SUSPECTED'
  // L+5 + loop
  | 'OBSERVED_AS'
  | 'ATTRIBUTED_TO'
  | 'ASSESSED_FOR'
  | 'VALIDATES_HYPOTHESIS'
  | 'REFUTES_HYPOTHESIS'
  | 'INFORMS'

export type GraphEdge = {
  id: number
  fromNodeId: number
  toNodeId: number
  kind: GraphEdgeKind
  weight: number
  confidence: number
  source: 'static_analysis' | 'git_log' | 'llm' | 'manual'
  metadataJson: string | null
}
