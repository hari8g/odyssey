import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RiafRunState, RiafStreamChunk } from '@shared'

type RiafState = {
  runState: RiafRunState
  streamBuffer: RiafStreamChunk[]
  setRunState: (state: RiafRunState) => void
  appendChunk: (chunk: RiafStreamChunk) => void
  clearBuffer: () => void
  reset: () => void
}

export const useRiafStore = create<RiafState>()(
  immer((set) => ({
    runState: { status: 'idle' },
    streamBuffer: [],

    setRunState: (state) =>
      set((s) => {
        s.runState = state
      }),

    appendChunk: (chunk) =>
      set((s) => {
        s.streamBuffer.push(chunk)
      }),

    clearBuffer: () =>
      set((s) => {
        s.streamBuffer = []
      }),

    reset: () =>
      set((s) => {
        s.runState = { status: 'idle' }
        s.streamBuffer = []
      }),
  })),
)
