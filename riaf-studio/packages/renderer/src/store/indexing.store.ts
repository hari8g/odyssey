import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { IndexingStage, IndexingStatus } from '@shared'

export type StageStatus = 'pending' | 'running' | 'done' | 'error'

type IndexingState = {
  isRunning: boolean
  stages: Partial<Record<IndexingStage, StageStatus>>
  currentStage: IndexingStage | null
  pct: number
  detail: string
  error: string | null
  completedAt: number | null
  totalMs: number | null
  setRunning: (v: boolean) => void
  applyProgress: (status: IndexingStatus) => void
  reset: () => void
}

const ALL_STAGES: IndexingStage[] = [
  'scan',
  'chunk',
  'symbols',
  'fts',
  'imports',
  'graph',
  'commands',
  'git',
  'embeddings',
  'profile',
]

function defaultStages(): Partial<Record<IndexingStage, StageStatus>> {
  return Object.fromEntries(ALL_STAGES.map((s) => [s, 'pending' as StageStatus]))
}

export const useIndexingStore = create<IndexingState>()(
  immer((set) => ({
    isRunning: false,
    stages: defaultStages(),
    currentStage: null,
    pct: 0,
    detail: '',
    error: null,
    completedAt: null,
    totalMs: null,

    setRunning: (v) =>
      set((s) => {
        s.isRunning = v
      }),

    applyProgress: (status) =>
      set((s) => {
        if (status.stage === 'done') {
          s.isRunning = false
          s.completedAt = Date.now()
          s.totalMs = status.totalMs
          s.pct = 100
          for (const stage of ALL_STAGES) {
            if (s.stages[stage] !== 'error') s.stages[stage] = 'done'
          }
        } else if (status.stage === 'error') {
          s.isRunning = false
          s.error = status.message
          const cur = s.currentStage
          if (cur) s.stages[cur] = 'error'
        } else {
          s.isRunning = true
          s.currentStage = status.stage
          s.pct = status.pct
          s.detail = status.detail
          s.stages[status.stage] = 'running'
          const idx = ALL_STAGES.indexOf(status.stage)
          for (let i = 0; i < idx; i++) {
            const st = ALL_STAGES[i]
            if (st && s.stages[st] !== 'error') s.stages[st] = 'done'
          }
        }
      }),

    reset: () =>
      set((s) => {
        s.isRunning = false
        s.stages = defaultStages()
        s.currentStage = null
        s.pct = 0
        s.detail = ''
        s.error = null
        s.completedAt = null
        s.totalMs = null
      }),
  })),
)

export { ALL_STAGES }
