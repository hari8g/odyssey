import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CycleRunRow, CycleTimelineRow, CycleProgress, CycleStage } from '@shared/index'

export type CycleRun = CycleRunRow
export type TimelineRow = CycleTimelineRow
export type StageProgress = CycleProgress

type CycleState = {
  runs: CycleRun[]
  activeRunId: number | null
  timeline: TimelineRow[]
  progress: StageProgress | null
  setRuns: (r: CycleRun[]) => void
  upsertRun: (r: CycleRun) => void
  setActive: (id: number | null) => void
  setTimeline: (t: TimelineRow[]) => void
  setProgress: (p: StageProgress | null) => void
  activeRun: () => CycleRun | undefined
  reset: () => void
}

export const STAGE_ORDER: CycleStage[] = [
  'SIGNALS',
  'CLUSTER',
  'INTAKE',
  'QUALIFY',
  'PACKET',
  'PORTFOLIO_GATE',
  'BUILD',
  'CONSOLIDATE',
  'RELEASE_GATE',
  'ROLLOUT',
  'OBSERVE',
  'LEARN',
  'DONE',
]

export const STAGE_META: Record<CycleStage, { title: string; narrative: string }> = {
  SIGNALS: {
    title: 'Ingest customer signals',
    narrative: 'Raw customer voice enters the graph as immutable evidence.',
  },
  CLUSTER: {
    title: 'Cluster into pain points',
    narrative: 'Signals are deduplicated into named, countable problems.',
  },
  INTAKE: {
    title: 'A1 — intake brief',
    narrative: 'Pain points become a classified, deduplicated brief.',
  },
  QUALIFY: {
    title: 'A2 ∥ A4 → A3 — assessments',
    narrative: 'Business value and engineering cost in parallel; GTM follows.',
  },
  PACKET: {
    title: 'A5 — portfolio packet',
    narrative: 'Evidence assembled for the human forum.',
  },
  PORTFOLIO_GATE: {
    title: '★ Portfolio admission',
    narrative: 'Admit / defer / reject. Hypotheses lock before code.',
  },
  BUILD: {
    title: 'Define → build',
    narrative: 'ISS plane work; CI results flow in via Pass F.',
  },
  CONSOLIDATE: {
    title: 'A10 — readiness',
    narrative: '4-scope blast radius and approval set.',
  },
  RELEASE_GATE: {
    title: '★ Release approval',
    narrative: 'Every role in the approval set signs.',
  },
  ROLLOUT: {
    title: 'A11 — staged rollout',
    narrative: 'Canary → gradual → full; A11 may halt, never widen.',
  },
  OBSERVE: {
    title: 'Observe',
    narrative: 'KPI observations accumulate over the timeframe.',
  },
  LEARN: {
    title: 'Pass G — learn',
    narrative: 'Verdicts, org impact, and learnings wired upstream.',
  },
  DONE: {
    title: '↺ Cycle complete',
    narrative: 'Start the next bet with better priors.',
  },
}

export const useCycleStore = create<CycleState>()(
  immer((set, get) => ({
    runs: [],
    activeRunId: null,
    timeline: [],
    progress: null,
    setRuns: (r) =>
      set((s) => {
        s.runs = r
      }),
    upsertRun: (r) =>
      set((s) => {
        const i = s.runs.findIndex((x) => x.id === r.id)
        if (i >= 0) s.runs[i] = r
        else s.runs.unshift(r)
      }),
    setActive: (id) =>
      set((s) => {
        s.activeRunId = id
      }),
    setTimeline: (t) =>
      set((s) => {
        s.timeline = t
      }),
    setProgress: (p) =>
      set((s) => {
        s.progress = p
      }),
    activeRun: () => get().runs.find((r) => r.id === get().activeRunId),
    reset: () =>
      set((s) => {
        s.runs = []
        s.activeRunId = null
        s.timeline = []
        s.progress = null
      }),
  })),
)
