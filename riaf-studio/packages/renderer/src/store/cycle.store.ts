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
    title: 'Write the case for action',
    narrative: 'Pain points become a classified, deduplicated brief.',
  },
  QUALIFY: {
    title: 'Size value and effort',
    narrative: 'Business value and engineering cost in parallel; GTM follows.',
  },
  PACKET: {
    title: 'Assemble the decision packet',
    narrative: 'Evidence assembled for the human forum.',
  },
  PORTFOLIO_GATE: {
    title: '★ Portfolio admission',
    narrative: 'Admit / defer / reject. Hypotheses lock before code.',
  },
  BUILD: {
    title: 'Define → build',
    narrative: 'Teams work; CI results flow in automatically.',
  },
  CONSOLIDATE: {
    title: 'Check release readiness',
    narrative: '4-scope blast radius and approval set.',
  },
  RELEASE_GATE: {
    title: '★ Release approval',
    narrative: 'Every role in the approval set signs.',
  },
  ROLLOUT: {
    title: 'Staged rollout',
    narrative: 'Canary → gradual → full; may halt, never widen.',
  },
  OBSERVE: {
    title: 'Observe',
    narrative: 'KPI observations accumulate over the timeframe.',
  },
  LEARN: {
    title: 'Judge the bet, keep the lesson',
    narrative: 'Verdicts, org impact, and learnings wired upstream.',
  },
  DONE: {
    title: '↺ Cycle complete',
    narrative: 'Start the next bet with better priors.',
  },
}

/** Plain-English agent names — never show A-codes in the UI. */
export const AGENT_NAMES: Record<string, string> = {
  a1_intake: 'Signal Analyst',
  A1: 'Signal Analyst',
  a2_business_impact: 'Value Estimator',
  A2: 'Value Estimator',
  a3_gtm: 'GTM Advisor',
  A3: 'GTM Advisor',
  a4_dev_impact: 'Engineering Estimator',
  A4: 'Engineering Estimator',
  a5_portfolio: 'Portfolio Advisor',
  A5: 'Portfolio Advisor',
  a10_consolidation: 'Release Checker',
  A10: 'Release Checker',
  a11_deployment: 'Rollout Controller',
  A11: 'Rollout Controller',
  a12_attribution: 'Verdict Analyst',
  A12: 'Verdict Analyst',
  a13_cross_functional: 'Impact Reporter',
  A13: 'Impact Reporter',
  a14_learning: 'Lesson Distiller',
  A14: 'Lesson Distiller',
  clusterer: 'Problem Clusterer',
  'A2‖A4': 'Value + Engineering Estimators',
  'A12→A13→A14': 'Verdict → Impact → Lessons',
}

export function agentName(id: string | null | undefined): string {
  if (!id) return 'Agent'
  return AGENT_NAMES[id] ?? id.replace(/^a\d+_/, '').replace(/_/g, ' ')
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
