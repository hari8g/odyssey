// packages/shared/src/iss.types.ts
import type { SDLCPhase } from './db.types'

export type ISSGraphStats = {
  featureCount: number
  tracesCoverage: number
  topHubs: string[]
}

export type ISSToolResult = {
  error?: string
  data?: unknown
}

export type FeatureCreateInput = {
  label: string
  description: string
  sdlcPhase?: SDLCPhase
  sourceRef?: string
}

export type FeatureUpdateInput = {
  id: number
  label?: string
  description?: string
  sdlcPhase?: SDLCPhase
  sourceRef?: string
}

export type ManualFeatureAuditRow = {
  id: number
  nodeId: number | null
  action: 'create' | 'update' | 'delete' | 'bulk_import'
  label: string
  metaJson: string | null
  createdAt: number
}

export type ImportFormat = 'text' | 'csv' | 'json' | 'yaml'

export type ImportPreviewItem = {
  label: string
  description: string
  sdlcPhase: SDLCPhase
  valid: boolean
  error?: string
}

export type ImportPreviewResult = {
  format: ImportFormat
  total: number
  valid: number
  invalid: number
  duplicates: number
  items: ImportPreviewItem[]
}

export type FeatureSuggestion = {
  id: number
  label: string
  description: string
  sdlcPhase: SDLCPhase
  confidence: number
  source: 'code_structure'
  status: 'pending' | 'approved' | 'rejected'
  nodeId: number | null
  createdAt: number
  reviewedAt: number | null
}

export type AlignmentMode = 'embedding' | 'bm25_fallback' | 'unavailable'

export type AlignmentResult = {
  mode: AlignmentMode
  aligned: number
  skipped: number
  fallback: boolean
}

export type ISSPassId = 'A' | 'B' | 'C1' | 'C2' | 'C3' | 'C3.5' | 'C4' | 'manual'

export type ISSPassProgress = {
  pass: ISSPassId
  stage: string
  pct: number
  detail: string
}

export type SDLCMode =
  | 'requirements'
  | 'design'
  | 'implementation'
  | 'testing'
  | 'deployment'
  | 'maintenance'
  | 'auto'

export type FISWeights = {
  alpha: number
  beta: number
  gamma: number
  delta: number
  epsilon: number
}

export type FISResult = {
  filePath: string
  score: number
  components: { alpha: number; beta: number; gamma: number; delta: number; epsilon: number }
  sdlcPhase: SDLCPhase | null
  nodeKind: string | null
  importedByCount: number
}

export type FeatureSummary = {
  id: number
  label: string
  description: string | null
  sourceType: string
  sdlcPhase: SDLCPhase | null
  completionPct: number
  alignmentSource: string | null
}

export type ISSNeedsFeaturesPayload = {
  message: string
  suggestions: { n: number }
}
