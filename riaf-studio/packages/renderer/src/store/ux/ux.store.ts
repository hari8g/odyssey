import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { VerbKey } from '@/design/tokens'

export type Role = 'executive' | 'product' | 'engineering' | 'compliance' | 'gtm' | 'support'

export type BoardItem = {
  id: number
  featureId?: number | null
  title: string
  verb: VerbKey | string
  statusLine: string
  status: string
  needsHuman: boolean
  daysInStage: number
  betCount: number
  contextLabel?: string
  requiredRoles?: string[]
  signedRoles?: string[]
  stage?: string
  mode?: string
}

export type PainPointRow = {
  id: number
  label: string
  signal_count: number
}

export type ActionItem = {
  id: string
  verb: string
  title: string
  sub: string
  age: string
  actionLabel: string
  route: string
}

type UXState = {
  role: Role
  board: BoardItem[]
  painPoints: PainPointRow[]
  contexts: { id: number; label: string }[]
  signalCount: number
  painPointCount: number
  actionCount: number
  actions: ActionItem[]
  bets: { committed: number; pending: number; validated: number }
  learnings: { id: number; label: string; description: string | null }[]
  verdicts: { id: number; label: string; description: string | null }[]
  setRole: (r: Role) => void
  setBoard: (b: BoardItem[]) => void
  setPainPoints: (p: PainPointRow[]) => void
  setContexts: (c: { id: number; label: string }[]) => void
  setSignalCount: (n: number) => void
  setPainPointCount: (n: number) => void
  setActionCount: (n: number) => void
  setActions: (a: ActionItem[]) => void
  setBets: (b: { committed: number; pending: number; validated: number }) => void
  setLearnings: (l: UXState['learnings']) => void
  setVerdicts: (v: UXState['verdicts']) => void
  refreshBoard: () => Promise<void>
  refreshActions: () => Promise<void>
  refreshHome: () => Promise<void>
  reset: () => void
}

const ROLE_KEY = 'riaf.journey.role'

function loadRole(): Role {
  try {
    const v = localStorage.getItem(ROLE_KEY)
    if (
      v &&
      ['executive', 'product', 'engineering', 'compliance', 'gtm', 'support'].includes(v)
    ) {
      return v as Role
    }
  } catch {
    /* ignore */
  }
  return 'product'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

let boardCacheAt = 0
let actionsCacheAt = 0
let homeCacheAt = 0
const CACHE_MS = 5_000

export const useUXStore = create<UXState>()(
  immer((set, get) => ({
    role: loadRole(),
    board: [],
    painPoints: [],
    contexts: [],
    signalCount: 0,
    painPointCount: 0,
    actionCount: 0,
    actions: [],
    bets: { committed: 0, pending: 0, validated: 0 },
    learnings: [],
    verdicts: [],
    setRole: (r) =>
      set((s) => {
        s.role = r
        try {
          localStorage.setItem(ROLE_KEY, r)
        } catch {
          /* ignore */
        }
      }),
    setBoard: (b) =>
      set((s) => {
        s.board = b
      }),
    setPainPoints: (p) =>
      set((s) => {
        s.painPoints = p
      }),
    setContexts: (c) =>
      set((s) => {
        s.contexts = c
      }),
    setSignalCount: (n) =>
      set((s) => {
        s.signalCount = n
      }),
    setPainPointCount: (n) =>
      set((s) => {
        s.painPointCount = n
      }),
    setActionCount: (n) =>
      set((s) => {
        s.actionCount = n
      }),
    setActions: (a) =>
      set((s) => {
        s.actions = a
        s.actionCount = a.length
      }),
    setBets: (b) =>
      set((s) => {
        s.bets = b
      }),
    setLearnings: (l) =>
      set((s) => {
        s.learnings = l
      }),
    setVerdicts: (v) =>
      set((s) => {
        s.verdicts = v
      }),
    refreshBoard: async () => {
      if (Date.now() - boardCacheAt < CACHE_MS && get().board.length > 0) return
      const res = await eAPI().uxGetJourneyBoard?.()
      if (Array.isArray(res)) {
        set((s) => {
          s.board = res
        })
        boardCacheAt = Date.now()
      }
    },
    refreshActions: async () => {
      if (Date.now() - actionsCacheAt < CACHE_MS && get().actions.length >= 0) {
        /* still refresh lightly */
      }
      const res = await eAPI().uxGetActions?.({ role: get().role })
      if (Array.isArray(res)) {
        set((s) => {
          s.actions = res
          s.actionCount = res.length
        })
        actionsCacheAt = Date.now()
      }
    },
    refreshHome: async () => {
      if (Date.now() - homeCacheAt < CACHE_MS && get().signalCount > 0) {
        /* ok */
      }
      const res = await eAPI().uxGetHomeStats?.()
      if (res && !res.error) {
        set((s) => {
          s.signalCount = res.signalCount ?? 0
          s.painPointCount = res.painPointCount ?? 0
          s.painPoints = res.painPoints ?? []
          s.contexts = res.contexts ?? []
          s.learnings = res.learnings ?? []
          s.verdicts = res.verdicts ?? []
          s.bets = res.bets ?? { committed: 0, pending: 0, validated: 0 }
        })
        homeCacheAt = Date.now()
      }
      await get().refreshBoard()
      await get().refreshActions()
    },
    reset: () =>
      set((s) => {
        s.board = []
        s.painPoints = []
        s.contexts = []
        s.signalCount = 0
        s.painPointCount = 0
        s.actionCount = 0
        s.actions = []
        s.bets = { committed: 0, pending: 0, validated: 0 }
        s.learnings = []
        s.verdicts = []
        boardCacheAt = 0
        actionsCacheAt = 0
        homeCacheAt = 0
      }),
  })),
)

/** Invalidate caches on cycle/aep pushes. */
export function invalidateUxCaches(): void {
  boardCacheAt = 0
  actionsCacheAt = 0
  homeCacheAt = 0
}
