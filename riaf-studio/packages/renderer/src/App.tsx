import { useEffect, useCallback, useState, useRef } from 'react'
import { Sidebar, type PanelId } from '@/components/Sidebar'
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
import { useWorkspaceStore } from '@/store/workspace.store'
import { useIndexingStore } from '@/store/indexing.store'
import { useRiafStore } from '@/store/riaf.store'
import { useISSStore } from '@/store/iss.store'
import { useAepStore } from '@/store/aep.store'
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

export function App() {
  const [activePanel, setActivePanel] = useState<PanelId>('workspace')
  const workspaceSessionRef = useRef(0)

  const { root, setRoot, setProfile, setRecentWorkspaces } = useWorkspaceStore()
  const { applyProgress, setRunning, reset: resetIndexing } = useIndexingStore()
  const { setRunState, appendChunk, clearBuffer, reset: resetRiaf } = useRiafStore()
  const {
    setPassProgress,
    setPassRunning,
    setNeedsFeatures,
    setCoChangeWarning,
    reset: resetIss,
  } = useISSStore()

  const { setPassProgress: setAepProgress, setPassRunning: setAepRunning, reset: resetAep } = useAepStore()

  const hasWorkspace = root !== null

  const resetForNewWorkspace = useCallback(() => {
    resetIndexing()
    resetRiaf()
    resetIss()
    resetAep()
  }, [resetIndexing, resetRiaf, resetIss, resetAep])

  // Load recent workspaces + background theme on mount
  useEffect(() => {
    void refreshRecentWorkspaces(setRecentWorkspaces)
    void applyStoredBackgroundTheme()
  }, [setRecentWorkspaces])

  // Wire IPC event listeners
  useEffect(() => {
    const unsubs = [
      window.electronAPI.onWorkspaceChanged(({ root: dir, sessionId }) => {
        workspaceSessionRef.current = sessionId
        resetForNewWorkspace()
        setRoot(dir)
        setProfile(null)
        void refreshRecentWorkspaces(setRecentWorkspaces)
        setActivePanel('indexing')
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

      // AEP events
      (window.electronAPI as unknown as Record<string, (h: (d: unknown) => void) => () => void>)
        .onAepPassProgress?.((p) => {
          setAepProgress(p as Parameters<typeof setAepProgress>[0])
          setAepRunning(true)
        }) ?? (() => undefined),
      (window.electronAPI as unknown as Record<string, (h: (d: unknown) => void) => () => void>)
        .onAepPassComplete?.(() => {
          setAepRunning(false)
          setAepProgress(null)
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
  ])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'o') {
        e.preventDefault()
        setActivePanel('workspace')
      } else if (mod && e.key === 'r') {
        e.preventDefault()
        if (hasWorkspace) {
          useIndexingStore.getState().reset()
          window.electronAPI.startIndexer()
          setActivePanel('indexing')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasWorkspace])

  const handleWorkspaceOpened = useCallback(
    (_dir: string) => {
      // workspace:changed (sent from main before indexing) owns reset + navigation
      setActivePanel('indexing')
    },
    [],
  )

  const renderPanel = () => {
    switch (activePanel) {
      case 'workspace':
        return <WorkspacePanel onWorkspaceOpened={handleWorkspaceOpened} />
      case 'indexing':
        return <IndexingPanel onRunRiaf={() => setActivePanel('riaf')} />
      case 'ucg':
        return <UCGGraphPanel />
      case 'iss':
        return <ISSGraphPanel />
      case 'features':
        return <FeaturePanel />
      case 'po':
        return <POWorkbenchPanel />
      case 'impact':
        return <ImpactPanel />
      case 'search':
        return <SearchPanel />
      case 'symbols':
        return <SymbolBrowserPanel />
      case 'riaf':
        return <RiafPanel />
      case 'settings':
        return <SettingsPanel />
      // AEP panels
      case 'domain':
        return <DomainBrowserPanel />
      case 'valueStream':
        return <ValueStreamPanel />
      case 'signals':
        return <CustomerSignalPanel />
      case 'businessValue':
        return <BusinessValuePanel />
      case 'consolidation':
        return <ConsolidationPanel />
      case 'outcomes':
        return <OutcomeDashboardPanel />
    }
  }

  return (
    <div className="flex h-screen w-screen max-w-full bg-surface overflow-hidden min-w-0">
      <Sidebar active={activePanel} hasWorkspace={hasWorkspace} onChange={setActivePanel} />
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col bg-surface-2">
        <div className="h-full min-w-0 overflow-hidden">{renderPanel()}</div>
      </div>
    </div>
  )
}
