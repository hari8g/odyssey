// packages/shared/src/aep.types.ts

export type ValueStreamState =
  | 'INTAKE'
  | 'QUALIFY'
  | 'PRIORITIZE'
  | 'DEFINE'
  | 'BUILD'
  | 'CONSOLIDATE'
  | 'RELEASE'
  | 'OBSERVE'
  | 'LEARN'

export type AEPPassId =
  | 'D'
  | 'E_signals'
  | 'E_cluster'
  | 'E_org'
  | 'F_cicd'
  | 'F_tests'
  | 'F_deploy'
  | 'F_kpi'
  | 'G_attribute'
  | 'G_verdict'
  | 'G_learn'
  | 'orch'

export type AEPPassProgress = {
  pass: AEPPassId
  stage: string
  pct: number
  detail: string
}

export type DomainConceptDef = {
  name: string
  definition: string
  synonyms?: string[]
  context?: string
}

export type BusinessRuleDef = {
  id: string
  name: string
  statement: string
  context: string
  regulation?: string
  enforcedBy?: string[]
}

export type KPIDef = {
  name: string
  description: string
  unit: string
  measurementWindow: string
  telemetrySource?: string
  baseline?: number
  target?: number
  owner?: string
}

export type BoundedContextDef = {
  name: string
  description: string
  filePaths?: string[]
  team?: string
}

export type DomainEventDef = {
  name: string
  description: string
  producedBy?: string[]
  consumedBy?: string[]
}

export type RegulationDef = {
  id: string
  name: string
  body: string
  applies_to?: string[]
}

export type DomainPackManifest = {
  name: string
  version: string
  domain: string
  concepts?: DomainConceptDef[]
  rules?: BusinessRuleDef[]
  kpis?: KPIDef[]
  contexts?: BoundedContextDef[]
  events?: DomainEventDef[]
  regulations?: RegulationDef[]
}

export type ObjectiveDef = {
  id: string
  label: string
  owner: string
  horizon: string
  kpis?: string[]
}

export type OrgUnitDef = {
  name: string
  concern_kpis?: string[]
  concern_segments?: string[]
}

export type InvestmentDef = {
  id: string
  label: string
  owner: string
  budget: number
  currency: string
  horizon: string
}

export type RoleDef = {
  name: string
  org_unit: string
}

export type OrgPackManifest = {
  name: string
  version: string
  quarter?: string
  objectives?: ObjectiveDef[]
  orgUnits?: OrgUnitDef[]
  investments?: InvestmentDef[]
  roles?: RoleDef[]
}

export type PortfolioDecision = {
  featureId: number
  decision: 'admit' | 'defer' | 'reject'
  reason: string
  approvedByRole?: string
  briefId?: number
  bizAssessmentId?: number
  devAssessmentId?: number
}

export type DomainAwareFISResult = {
  filePath: string
  score: number
  components: {
    alpha: number
    beta: number
    gamma: number
    delta: number
    epsilon: number
    zeta: number
  }
  sdlcPhase: string | null
  nodeKind: string | null
  importedByCount: number
  domainRelevance: number
  isGoverned: boolean
  contexts: string[]
  regulations?: string[]
}

export type BlastRadius = {
  featureId: number
  scope1_code: { filePath: string; changeType: 'direct' | 'cochange' }[]
  scope2_verify: {
    kind: string
    label: string
    isCovered: boolean
    filePath: string | null
  }[]
  scope2_gaps: string[]
  scope3_ops: { kind: string; label: string; detail: string }[]
  scope4_org: {
    kpis: string[]
    segments: string[]
    orgUnits: string[]
    governed: string[]
  }
  approvalSet: string[]
  computedAt: number
}

export type ValueStreamRow = {
  id: number
  label: string
  stream_state: ValueStreamState
  entered_state_at: number
  blocked_on_json: string | null
}

export type HypothesisPortfolioRow = {
  hypothesisNodeId: number
  label: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  priorConfidence: number
  attributionMethod: string
  actualDeltaPct: number | null
  verdict: string | null
}

export type GoldenThread = {
  featureId: number
  featureLabel: string
  streamState: ValueStreamState
  painPoints: { id: number; label: string }[]
  hypotheses: HypothesisPortfolioRow[]
  domainConcepts: { id: number; label: string }[]
  builds: { id: number; label: string }[]
  deployments: { id: number; label: string }[]
  verdicts: { id: number; label: string; kind: string }[]
  learnings: { id: number; label: string }[]
  orgImpacts: { id: number; orgUnitLabel: string; summary: string }[]
}

export type OutcomeRow = {
  id: number
  featureId: number
  featureLabel: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  priorConfidence: number
  attributionMethod: string
  actualDeltaPct: number | null
  verdict: 'validated' | 'refuted' | 'inconclusive'
  rationale: string | null
  createdAt: number
}
