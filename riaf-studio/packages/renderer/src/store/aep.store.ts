import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

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

export interface PainPoint {
  id: number
  label: string
  description: string | null
  signal_count: number
}

export interface ValueStreamItem {
  id: number
  label: string
  stream_state: ValueStreamState
  entered_state_at: number | null
  blocked_on_json: string | null
}

export interface HypothesisRow {
  hypothesisNodeId: number
  label: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  priorConfidence: number
  status: string
}

export interface DomainPack {
  name: string
  version: string
  loaded_at: number | null
  node_count: number
  file_path: string
}

export interface KpiRow {
  id: number
  label: string
  description: string | null
  measurement_unit: string | null
  baseline_value: number | null
  target_value: number | null
}

export interface PendingGate {
  featureId: number
  featureLabel: string
  streamState: ValueStreamState
  blockedReasons: string[]
}

export interface AepPassProgress {
  pass: string
  stage: string
  pct: number
  detail?: string
}

type AepState = {
  // Domain
  domainPacks: DomainPack[]
  kpis: KpiRow[]
  contexts: { id: number; label: string; description: string | null }[]
  concepts: { id: number; label: string; description: string | null; kind: string }[]

  // Upstream
  painPoints: PainPoint[]
  valueStream: ValueStreamItem[]
  hypotheses: HypothesisRow[]

  // Governance
  pendingGates: PendingGate[]

  // Progress
  passProgress: AepPassProgress | null
  passRunning: boolean

  // Actions
  setDomainPacks: (packs: DomainPack[]) => void
  setKpis: (kpis: KpiRow[]) => void
  setContexts: (ctx: AepState['contexts']) => void
  setConcepts: (concepts: AepState['concepts']) => void
  setPainPoints: (pp: PainPoint[]) => void
  setValueStream: (vs: ValueStreamItem[]) => void
  setHypotheses: (h: HypothesisRow[]) => void
  setPendingGates: (gates: PendingGate[]) => void
  setPassProgress: (p: AepPassProgress | null) => void
  setPassRunning: (v: boolean) => void
  reset: () => void
}

const initialState = {
  domainPacks: [],
  kpis: [],
  contexts: [],
  concepts: [],
  painPoints: [],
  valueStream: [],
  hypotheses: [],
  pendingGates: [],
  passProgress: null,
  passRunning: false,
}

export const useAepStore = create<AepState>()(
  immer((set) => ({
    ...initialState,

    setDomainPacks: (packs) => set((s) => { s.domainPacks = packs }),
    setKpis: (kpis) => set((s) => { s.kpis = kpis }),
    setContexts: (ctx) => set((s) => { s.contexts = ctx }),
    setConcepts: (concepts) => set((s) => { s.concepts = concepts }),
    setPainPoints: (pp) => set((s) => { s.painPoints = pp }),
    setValueStream: (vs) => set((s) => { s.valueStream = vs }),
    setHypotheses: (h) => set((s) => { s.hypotheses = h }),
    setPendingGates: (gates) => set((s) => { s.pendingGates = gates }),
    setPassProgress: (p) => set((s) => { s.passProgress = p }),
    setPassRunning: (v) => set((s) => { s.passRunning = v }),
    reset: () => set((s) => { Object.assign(s, initialState) }),
  })),
)
