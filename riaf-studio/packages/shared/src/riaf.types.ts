// packages/shared/src/riaf.types.ts

export type RiafConfig = {
  outputFileName: string
  maxFiles: number
  includeTests: boolean
  model: string
}

export const DEFAULT_RIAF_CONFIG: RiafConfig = {
  outputFileName: 'repo_context.md',
  maxFiles: 150,
  includeTests: false,
  model: 'claude-sonnet-4-6',
}

export type RiafIndexSnapshot = {
  languageStack: string[]
  frameworks: string[]
  packageManagers: string[]
  fileCount: number
  totalLoc: number
  chunkCount: number
  symbolCount: number
  projectPurpose: string | null
  architectureSummary: string | null
  buildCommands: string[]
  testCommands: string[]
  hotFiles: string[]
  cycleCount: number
  externalDepCount: number
  gitBranch: string | null
  recentlyChanged: string[]
  issGraphStats?: {
    featureCount: number
    tracesCoverage: number
    topHubs: string[]
  }
}

export type RiafRunState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; outputPath: string }
  | { status: 'done'; startedAt: number; outputPath: string; durationMs: number }
  | { status: 'error'; startedAt: number; message: string }

export type RiafStreamChunk = {
  type: 'text' | 'tool_use_start' | 'tool_result' | 'done' | 'error'
  content: string
  toolName?: string
}
