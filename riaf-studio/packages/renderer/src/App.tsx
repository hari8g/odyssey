import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '@/shell/AppShell'
import { CommandPalette, ShortcutHelp } from '@/shell/CommandPalette'
import { PeekProvider, ToastProvider } from '@/design/primitives'
import { PersonaHome } from '@/screens/home/PersonaHome'
import { JourneyCanvas } from '@/screens/journey/JourneyCanvas'
import { FeatureStory } from '@/screens/story/FeatureStory'
import { ActionsInbox } from '@/screens/actions/ActionsInbox'
import { DecideRoom } from '@/screens/gates/DecideRoom'
import { LearnHub } from '@/screens/learn/LearnHub'
import { WorkspacePanel } from '@/panels/WorkspacePanel'
import { IndexingPanel } from '@/panels/IndexingPanel'
import { UCGGraphPanel } from '@/panels/UCGGraphPanel'
import { SearchPanel } from '@/panels/SearchPanel'
import { SymbolBrowserPanel } from '@/panels/SymbolBrowserPanel'
import { RiafPanel } from '@/panels/RiafPanel'
import { SettingsPanel } from '@/panels/SettingsPanel'
import { FeaturePanel } from '@/panels/iss/FeaturePanel'
import { ISSGraphPanel } from '@/panels/iss/ISSGraphPanel'
import { POWorkbenchPanel } from '@/panels/iss/POWorkbenchPanel'
import { ImpactPanel } from '@/panels/iss/ImpactPanel'
import { DomainBrowserPanel } from '@/panels/aep/DomainBrowserPanel'
import { ValueStreamPanel } from '@/panels/aep/ValueStreamPanel'
import { CustomerSignalPanel } from '@/panels/aep/CustomerSignalPanel'
import { BusinessValuePanel } from '@/panels/aep/BusinessValuePanel'
import { ConsolidationPanel } from '@/panels/aep/ConsolidationPanel'
import { OutcomeDashboardPanel } from '@/panels/aep/OutcomeDashboardPanel'
import { CycleRunnerPanel } from '@/panels/aep/CycleRunnerPanel'
import { useWorkspaceStore } from '@/store/workspace.store'
import { useIndexingStore } from '@/store/indexing.store'
import { useRiafStore } from '@/store/riaf.store'
import { useISSStore } from '@/store/iss.store'
import { useAepStore } from '@/store/aep.store'
import { useCycleStore } from '@/store/cycle.store'
import { invalidateUxCaches, useUXStore } from '@/store/ux/ux.store'
import { applyBackgroundTheme } from '@/theme/backgroundThemes'

async function refreshRecentWorkspaces(
  setRecentWorkspaces: (ws: string[]) => void,
): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  if (settings && typeof settings === 'object' && 'recentWorkspaces' in settings) {
    const rw = (settings as { recentWorkspaces: unknown }).recentWorkspaces
    if (Array.isArray(rw)) setRecentWorkspaces(rw as string[])
  }
}

async function applyStoredBackgroundTheme(): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  if (settings && typeof settings === 'object' && 'backgroundTheme' in settings) {
    applyBackgroundTheme((settings as { backgroundTheme: string }).backgroundTheme)
  }
}

function Room({ children }: { children: ReactNode }) {
  return <div className="h-full min-w-0 overflow-hidden bg-surface-2">{children}</div>
}

function WorkspaceListener() {
  const navigate = useNavigate()
  const workspaceSessionRef = useRef(0)

  const { setRoot, setProfile, setRecentWorkspaces } = useWorkspaceStore()
  const { applyProgress, setRunning, reset: resetIndexing } = useIndexingStore()
  const { setRunState, appendChunk, clearBuffer, reset: resetRiaf } = useRiafStore()
  const {
    setPassProgress,
    setPassRunning,
    setNeedsFeatures,
    setCoChangeWarning,
    reset: resetIss,
  } = useISSStore()
  const { setPassProgress: setAepProgress, setPassRunning: setAepRunning, reset: resetAep } =
    useAepStore()
  const { upsertRun: upsertCycleRun, setProgress: setCycleProgress, reset: resetCycle } =
    useCycleStore()
  const { refreshHome, reset: resetUx } = useUXStore()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutHelp, setShortcutHelp] = useState(false)

  const resetForNewWorkspace = useCallback(() => {
    resetIndexing()
    resetRiaf()
    resetIss()
    resetAep()
    resetCycle()
    resetUx()
    invalidateUxCaches()
  }, [resetIndexing, resetRiaf, resetIss, resetAep, resetCycle, resetUx])

  useEffect(() => {
    void refreshRecentWorkspaces(setRecentWorkspaces)
    void applyStoredBackgroundTheme()
  }, [setRecentWorkspaces])

  useEffect(() => {
    const api = window.electronAPI as unknown as Record<
      string,
      ((h: (d: unknown) => void) => () => void) | undefined
    >

    const unsubs = [
      window.electronAPI.onWorkspaceChanged(({ root: dir, sessionId }) => {
        workspaceSessionRef.current = sessionId
        resetForNewWorkspace()
        setRoot(dir)
        setProfile(null)
        void refreshRecentWorkspaces(setRecentWorkspaces)
        navigate('/room/indexing')
      }),

      window.electronAPI.onIndexerProgress((status) => {
        setRunning(true)
        applyProgress(status)
      }),

      window.electronAPI.onIndexerComplete((status) => {
        applyProgress(status)
        window.electronAPI.startWatcher()
        const sessionAtComplete = workspaceSessionRef.current
        window.electronAPI.getProfile().then((profile) => {
          if (sessionAtComplete === workspaceSessionRef.current) {
            setProfile(profile)
          }
        })
      }),

      window.electronAPI.onIndexerError((err) => {
        applyProgress({ stage: 'error', message: err.message })
      }),

      window.electronAPI.onRiafStream((chunk) => {
        appendChunk(chunk)
      }),

      window.electronAPI.onRiafStateChange((state) => {
        setRunState(state)
        if (state.status === 'running') {
          clearBuffer()
        }
      }),

      window.electronAPI.onISSPassProgress((p) => {
        setPassProgress(p as Parameters<typeof setPassProgress>[0])
        setPassRunning(true)
      }),
      window.electronAPI.onISSPassComplete(() => {
        setPassRunning(false)
        setPassProgress(null)
      }),
      window.electronAPI.onISSPassError(() => {
        setPassRunning(false)
      }),
      window.electronAPI.onISSNeedsFeatures(() => {
        setNeedsFeatures(true)
      }),
      window.electronAPI.onISSCoChangeWarning((w) => {
        setCoChangeWarning(
          w as { editedFile: string; partners: { filePath: string; weight: number }[] },
        )
      }),

      api.onAepPassProgress?.((p) => {
        setAepProgress(p as Parameters<typeof setAepProgress>[0])
        setAepRunning(true)
      }) ?? (() => undefined),
      api.onAepPassComplete?.(() => {
        setAepRunning(false)
        setAepProgress(null)
      }) ?? (() => undefined),
      api.onAepStateChanged?.(() => {
        invalidateUxCaches()
        void refreshHome()
      }) ?? (() => undefined),

      api.onCycleUpdate?.((r) => {
        if (r && typeof r === 'object' && 'id' in (r as object)) {
          upsertCycleRun(r as Parameters<typeof upsertCycleRun>[0])
        }
        invalidateUxCaches()
        void refreshHome()
      }) ?? (() => undefined),
      api.onCycleProgress?.((p) => {
        setCycleProgress(p as Parameters<typeof setCycleProgress>[0])
      }) ?? (() => undefined),
    ]

    return () => unsubs.forEach((fn) => fn())
  }, [
    applyProgress,
    setRunning,
    setProfile,
    appendChunk,
    clearBuffer,
    setRunState,
    setRoot,
    setRecentWorkspaces,
    resetForNewWorkspace,
    setPassProgress,
    setPassRunning,
    setNeedsFeatures,
    setCoChangeWarning,
    setAepProgress,
    setAepRunning,
    upsertCycleRun,
    setCycleProgress,
    navigate,
    refreshHome,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'o') {
        e.preventDefault()
        navigate('/room/workspace')
      } else if (mod && e.key === 'r') {
        e.preventDefault()
        if (useWorkspaceStore.getState().root) {
          useIndexingStore.getState().reset()
          window.electronAPI.startIndexer()
          navigate('/room/indexing')
        }
      } else if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        navigate('/journey')
      } else if (mod && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        navigate('/actions')
      } else if (mod && e.key === '/') {
        e.preventDefault()
        setShortcutHelp(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelp open={shortcutHelp} onClose={() => setShortcutHelp(false)} />
    </>
  )
}

function IndexingRoom() {
  const navigate = useNavigate()
  return (
    <Room>
      <IndexingPanel onRunRiaf={() => navigate('/room/riaf')} />
    </Room>
  )
}

function AppRoutes() {
  const handleWorkspaceOpened = useCallback((_dir: string) => {
    // workspace:changed owns reset + navigation
  }, [])

  return (
    <>
      <WorkspaceListener />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<PersonaHome />} />
          <Route path="actions" element={<ActionsInbox />} />
          <Route path="journey" element={<JourneyCanvas />} />
          <Route
            path="journey/new"
            element={
              <Room>
                <CycleRunnerPanel />
              </Room>
            }
          />
          <Route path="feature/:id" element={<FeatureStory />} />
          <Route path="gate/:runId/:gateType" element={<DecideRoom />} />
          <Route path="room/learn" element={<LearnHub />} />
          <Route
            path="room/workspace"
            element={
              <Room>
                <WorkspacePanel onWorkspaceOpened={handleWorkspaceOpened} />
              </Room>
            }
          />
          <Route path="room/indexing" element={<IndexingRoom />} />
          <Route
            path="room/ucg"
            element={
              <Room>
                <UCGGraphPanel />
              </Room>
            }
          />
          <Route
            path="room/iss"
            element={
              <Room>
                <ISSGraphPanel />
              </Room>
            }
          />
          <Route
            path="room/features"
            element={
              <Room>
                <FeaturePanel />
              </Room>
            }
          />
          <Route
            path="room/po"
            element={
              <Room>
                <POWorkbenchPanel />
              </Room>
            }
          />
          <Route
            path="room/impact"
            element={
              <Room>
                <ImpactPanel />
              </Room>
            }
          />
          <Route
            path="room/search"
            element={
              <Room>
                <SearchPanel />
              </Room>
            }
          />
          <Route
            path="room/symbols"
            element={
              <Room>
                <SymbolBrowserPanel />
              </Room>
            }
          />
          <Route
            path="room/riaf"
            element={
              <Room>
                <RiafPanel />
              </Room>
            }
          />
          <Route
            path="room/cycle"
            element={
              <Room>
                <CycleRunnerPanel />
              </Room>
            }
          />
          <Route
            path="room/domain"
            element={
              <Room>
                <DomainBrowserPanel />
              </Room>
            }
          />
          <Route
            path="room/valueStream"
            element={
              <Room>
                <ValueStreamPanel />
              </Room>
            }
          />
          <Route
            path="room/signals"
            element={
              <Room>
                <CustomerSignalPanel />
              </Room>
            }
          />
          <Route
            path="room/bizvalue"
            element={
              <Room>
                <BusinessValuePanel />
              </Room>
            }
          />
          <Route
            path="room/release"
            element={
              <Room>
                <ConsolidationPanel />
              </Room>
            }
          />
          <Route
            path="room/outcomes"
            element={
              <Room>
                <OutcomeDashboardPanel />
              </Room>
            }
          />
          <Route
            path="settings"
            element={
              <Room>
                <SettingsPanel />
              </Room>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  )
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <PeekProvider>
          <AppRoutes />
        </PeekProvider>
      </ToastProvider>
    </HashRouter>
  )
}
