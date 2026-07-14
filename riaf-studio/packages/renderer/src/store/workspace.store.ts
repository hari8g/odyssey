import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { WorkspaceProfile } from '@shared'

type WorkspaceState = {
  root: string | null
  profile: WorkspaceProfile | null
  recentWorkspaces: string[]
  setRoot: (root: string | null) => void
  setProfile: (profile: WorkspaceProfile | null) => void
  setRecentWorkspaces: (ws: string[]) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set) => ({
    root: null,
    profile: null,
    recentWorkspaces: [],
    setRoot: (root) =>
      set((s) => {
        s.root = root
      }),
    setProfile: (profile) =>
      set((s) => {
        s.profile = profile
      }),
    setRecentWorkspaces: (ws) =>
      set((s) => {
        s.recentWorkspaces = ws
      }),
  })),
)
