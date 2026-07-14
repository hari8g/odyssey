import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  FeatureSuggestion,
  SDLCMode,
  ISSPassProgress,
  AlignmentMode,
  FeatureSummary,
} from '@shared'

type ISSState = {
  sdlcMode: SDLCMode
  alignmentMode: AlignmentMode
  features: FeatureSummary[]
  selectedFeatureId: number | null
  passProgress: ISSPassProgress | null
  passRunning: boolean
  suggestions: FeatureSuggestion[]
  needsFeatures: boolean
  coChangeWarning: { editedFile: string; partners: { filePath: string; weight: number }[] } | null
  setSdlcMode: (m: SDLCMode) => void
  setAlignmentMode: (m: AlignmentMode) => void
  setFeatures: (f: FeatureSummary[]) => void
  setSelectedFeature: (id: number | null) => void
  setPassProgress: (p: ISSPassProgress | null) => void
  setPassRunning: (v: boolean) => void
  setSuggestions: (s: FeatureSuggestion[]) => void
  setNeedsFeatures: (v: boolean) => void
  setCoChangeWarning: (w: ISSState['coChangeWarning']) => void
  reset: () => void
}

export const useISSStore = create<ISSState>()(
  immer((set) => ({
    sdlcMode: 'auto',
    alignmentMode: 'unavailable',
    features: [],
    selectedFeatureId: null,
    passProgress: null,
    passRunning: false,
    suggestions: [],
    needsFeatures: false,
    coChangeWarning: null,

    setSdlcMode: (m) =>
      set((s) => {
        s.sdlcMode = m
      }),
    setAlignmentMode: (m) =>
      set((s) => {
        s.alignmentMode = m
      }),
    setFeatures: (f) =>
      set((s) => {
        s.features = f
      }),
    setSelectedFeature: (id) =>
      set((s) => {
        s.selectedFeatureId = id
      }),
    setPassProgress: (p) =>
      set((s) => {
        s.passProgress = p
      }),
    setPassRunning: (v) =>
      set((s) => {
        s.passRunning = v
      }),
    setSuggestions: (sug) =>
      set((s) => {
        s.suggestions = sug
      }),
    setNeedsFeatures: (v) =>
      set((s) => {
        s.needsFeatures = v
      }),
    setCoChangeWarning: (w) =>
      set((s) => {
        s.coChangeWarning = w
      }),

    reset: () =>
      set((s) => {
        s.features = []
        s.suggestions = []
        s.passProgress = null
        s.needsFeatures = false
        s.coChangeWarning = null
        s.selectedFeatureId = null
        s.passRunning = false
      }),
  })),
)
