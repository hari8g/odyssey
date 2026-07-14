import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  WorkspaceProfile,
  UCGGraphData,
  UCGGraphMetrics,
  UCGImportEdge,
  GitFileStats,
  CodebaseSearchResult,
  ExtractedSymbol,
  IndexerState,
  IndexingStatus,
  RiafConfig,
  RiafRunState,
  RiafStreamChunk,
} from '@shared/index'

type Handler<T> = (data: T) => void
type Unsubscribe = () => void

function on<T>(channel: string, handler: Handler<T>): Unsubscribe {
  const listener = (_e: IpcRendererEvent, data: T) => handler(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

type OpenDialogOptions = {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >
  message?: string
}

type OpenDialogResult = { canceled: boolean; filePaths: string[] }

const api = {
  // ── Workspace ──────────────────────────────────────────────────────────────
  openWorkspace: (dir?: string) =>
    ipcRenderer.invoke('workspace:open', dir) as Promise<
      { root: string } | { canceled: boolean } | { error: string }
    >,

  closeWorkspace: () =>
    ipcRenderer.invoke('workspace:close') as Promise<{ ok: boolean }>,

  getProfile: () =>
    ipcRenderer.invoke('workspace:getProfile') as Promise<WorkspaceProfile | null>,

  getWorkspaceRoot: () =>
    ipcRenderer.invoke('workspace:getRoot') as Promise<string | null>,

  onWorkspaceChanged: (handler: Handler<{ root: string; sessionId: number }>): Unsubscribe =>
    on<{ root: string; sessionId: number }>('workspace:changed', handler),

  reopenWorkspace: (options?: { dir?: string; replaceIndex?: boolean }) =>
    ipcRenderer.invoke('workspace:reopen', options) as Promise<
      { root: string } | { canceled: boolean } | { error: string }
    >,

  clearRecentWorkspaces: () =>
    ipcRenderer.invoke('workspace:clearRecent') as Promise<{ recentWorkspaces: string[] }>,

  removeRecentWorkspace: (dir: string) =>
    ipcRenderer.invoke('workspace:removeRecent', dir) as Promise<{ recentWorkspaces: string[] }>,

  // ── Indexer ────────────────────────────────────────────────────────────────
  startIndexer: () =>
    ipcRenderer.invoke('indexer:start') as Promise<{ ok: boolean } | { error: string }>,

  abortIndexer: () =>
    ipcRenderer.invoke('indexer:abort') as Promise<{ ok: boolean }>,

  getIndexerState: () =>
    ipcRenderer.invoke('indexer:getStatus') as Promise<IndexerState>,

  startWatcher: () =>
    ipcRenderer.invoke('indexer:startWatcher') as Promise<{ ok: boolean }>,

  onIndexerProgress: (handler: Handler<IndexingStatus>): Unsubscribe =>
    on<IndexingStatus>('indexer:progress', handler),

  onIndexerComplete: (handler: Handler<IndexingStatus>): Unsubscribe =>
    on<IndexingStatus>('indexer:complete', handler),

  onIndexerError: (handler: Handler<{ message: string }>): Unsubscribe =>
    on<{ message: string }>('indexer:error', handler),

  // ── Search ─────────────────────────────────────────────────────────────────
  searchCodebase: (query: string, max = 20) =>
    ipcRenderer.invoke('search:codebase', query, max) as Promise<
      CodebaseSearchResult[] | { error: string }
    >,

  searchCodebaseHybrid: (query: string, max = 20) =>
    ipcRenderer.invoke('search:codebaseHybrid', query, max) as Promise<
      CodebaseSearchResult[] | { error: string }
    >,

  searchSymbols: (query: string, max = 20) =>
    ipcRenderer.invoke('search:symbols', query, max) as Promise<
      ExtractedSymbol[] | { error: string }
    >,

  // ── UCG ────────────────────────────────────────────────────────────────────
  getUCGGraph: () =>
    ipcRenderer.invoke('ucg:getGraph') as Promise<UCGGraphData | { error: string }>,

  getUCGMetrics: () =>
    ipcRenderer.invoke('ucg:getMetrics') as Promise<UCGGraphMetrics | null>,

  getImportGraph: (filePath: string, direction: 'in' | 'out' | 'both') =>
    ipcRenderer.invoke('ucg:getImportGraph', filePath, direction) as Promise<
      UCGImportEdge[] | { error: string }
    >,

  // ── Git ────────────────────────────────────────────────────────────────────
  getGitDiffStat: () =>
    ipcRenderer.invoke('git:diffStat') as Promise<GitFileStats[] | { error: string }>,

  getRecentlyChanged: (limit?: number) =>
    ipcRenderer.invoke('git:recentlyChanged', limit) as Promise<
      GitFileStats[] | { error: string }
    >,

  // ── RIAF ───────────────────────────────────────────────────────────────────
  startRiaf: (config?: Partial<RiafConfig>) =>
    ipcRenderer.invoke('riaf:start', config) as Promise<{ ok: boolean } | { error: string }>,

  abortRiaf: () =>
    ipcRenderer.invoke('riaf:abort') as Promise<{ ok: boolean }>,

  getRiafState: () =>
    ipcRenderer.invoke('riaf:getState') as Promise<RiafRunState>,

  onRiafStream: (handler: Handler<RiafStreamChunk>): Unsubscribe =>
    on<RiafStreamChunk>('riaf:streamChunk', handler),

  onRiafStateChange: (handler: Handler<RiafRunState>): Unsubscribe =>
    on<RiafRunState>('riaf:stateChange', handler),

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: (key?: string) =>
    ipcRenderer.invoke('settings:get', key) as Promise<unknown>,

  setSettings: (key: string, value: unknown) =>
    ipcRenderer.invoke('settings:set', key, value) as Promise<{ ok: boolean }>,

  // ── ISS Graph ──────────────────────────────────────────────────────────────
  runISSPassA: () => ipcRenderer.invoke('iss:runPassA'),
  runISSPassB: () => ipcRenderer.invoke('iss:runPassB'),
  runISSPassC: () => ipcRenderer.invoke('iss:runPassC'),
  runISSAlignment: () => ipcRenderer.invoke('iss:runAlignment'),
  getISSAlignmentMode: () => ipcRenderer.invoke('iss:getAlignmentMode'),

  getISSFeatures: () => ipcRenderer.invoke('iss:getFeatures'),
  getISSFeatureDetail: (id: number) =>
    ipcRenderer.invoke('iss:getFeatureDetail', { id }),
  getISSGraphNodes: (opts?: { kind?: string }) =>
    ipcRenderer.invoke('iss:getGraphNodes', opts),
  getISSGraphEdges: (opts?: { kind?: string }) =>
    ipcRenderer.invoke('iss:getGraphEdges', opts),
  getISSCoChange: (filePath: string) =>
    ipcRenderer.invoke('iss:getCoChangePartners', { filePath }),
  getISSFeatureCount: () => ipcRenderer.invoke('iss:getFeatureCount'),

  featureCreate: (input: unknown) => ipcRenderer.invoke('iss:featureCreate', input),
  featureUpdate: (input: unknown) => ipcRenderer.invoke('iss:featureUpdate', input),
  featureDelete: (id: number) => ipcRenderer.invoke('iss:featureDelete', { id }),
  featureImport: (opts: { content: string; format?: string; sourceName?: string }) =>
    ipcRenderer.invoke('iss:featureImport', opts),
  featureImportPreview: (opts: { content: string; format?: string }) =>
    ipcRenderer.invoke('iss:featureImportPreview', opts),
  featureGetAudit: (opts?: { nodeId?: number }) =>
    ipcRenderer.invoke('iss:featureGetAudit', opts),

  discoverFeatures: () => ipcRenderer.invoke('iss:discoverFeatures'),
  getISSSuggestions: () => ipcRenderer.invoke('iss:getSuggestions'),
  approveSuggestion: (id: number) => ipcRenderer.invoke('iss:approveSuggestion', { id }),
  rejectSuggestion: (id: number) => ipcRenderer.invoke('iss:rejectSuggestion', { id }),
  approveAllSuggestions: () => ipcRenderer.invoke('iss:approveAllSuggestions'),

  traceFeature: (feature: string) => ipcRenderer.invoke('iss:traceFeature', { feature }),
  impactAnalysis: (query: string, mode?: string) =>
    ipcRenderer.invoke('iss:impactAnalysis', { query, mode }),
  featureStatus: (feature?: string) =>
    ipcRenderer.invoke('iss:featureStatus', { feature }),
  findSimilarFeatures: (feature: string) =>
    ipcRenderer.invoke('iss:findSimilar', { feature }),
  genCriteria: (feature: string) => ipcRenderer.invoke('iss:genCriteria', { feature }),
  suggestArch: (feature: string) => ipcRenderer.invoke('iss:suggestArch', { feature }),

  getSdlcMode: () => ipcRenderer.invoke('iss:getSdlcMode'),
  setSdlcMode: (mode: string) => ipcRenderer.invoke('iss:setSdlcMode', { mode }),

  onISSPassProgress: (handler: Handler<unknown>): Unsubscribe =>
    on('iss:passProgress', handler),
  onISSPassComplete: (handler: Handler<unknown>): Unsubscribe =>
    on('iss:passComplete', handler),
  onISSPassError: (handler: Handler<unknown>): Unsubscribe =>
    on('iss:passError', handler),
  onISSNeedsFeatures: (handler: Handler<unknown>): Unsubscribe =>
    on('iss:needsFeatures', handler),
  onISSCoChangeWarning: (handler: Handler<unknown>): Unsubscribe =>
    on('iss:coChangeWarning', handler),

  // ── Domain (Pass D) ────────────────────────────────────────────────────────
  domainListPacks: () => ipcRenderer.invoke('domain:listPacks'),
  domainLoadPack: (filePath: string) => ipcRenderer.invoke('domain:loadPack', { filePath }),
  domainRunPassD: () => ipcRenderer.invoke('domain:runPassD'),
  domainGetKpis: () => ipcRenderer.invoke('domain:getKpis'),
  domainGetContexts: () => ipcRenderer.invoke('domain:getContexts'),
  domainGetRegulations: () => ipcRenderer.invoke('domain:getRegulations'),
  domainGetConcepts: () => ipcRenderer.invoke('domain:getConcepts'),

  // ── AEP: Upstream ──────────────────────────────────────────────────────────
  aepLoadOrgPacks: (packPaths: string[]) =>
    ipcRenderer.invoke('aep:loadOrgPacks', { packPaths }),
  aepIngestSignals: (source: string, content: string) =>
    ipcRenderer.invoke('aep:ingestSignals', { source, content }),
  aepClusterPainPoints: () => ipcRenderer.invoke('aep:clusterPainPoints'),
  aepGetPainPoints: () => ipcRenderer.invoke('aep:getPainPoints'),
  aepRunA1: (painPointIds: number[]) => ipcRenderer.invoke('aep:runA1', { painPointIds }),
  aepRunA2: (briefId: number, featureId: number) =>
    ipcRenderer.invoke('aep:runA2', { briefId, featureId }),
  aepRunA3: (featureId: number, briefId: number) =>
    ipcRenderer.invoke('aep:runA3', { featureId, briefId }),
  aepRunA4: (briefId: number, featureId: number) =>
    ipcRenderer.invoke('aep:runA4', { briefId, featureId }),
  aepRunA5: (featureId: number) => ipcRenderer.invoke('aep:runA5', { featureId }),
  aepPortfolioGate: (input: unknown) => ipcRenderer.invoke('aep:portfolioGate', input),
  aepGetHypotheses: () => ipcRenderer.invoke('aep:getHypotheses'),
  aepGetValueStream: () => ipcRenderer.invoke('aep:getValueStream'),

  // ── AEP: Downstream ────────────────────────────────────────────────────────
  aepGetBlastRadius: (opts: { featureId?: number; releaseCandidateId?: number }) =>
    ipcRenderer.invoke('aep:getBlastRadius', opts),
  aepIngestBuild: (payload: unknown) => ipcRenderer.invoke('aep:ingestBuildEvent', { payload }),
  aepIngestTestRun: (buildId: number, payload: unknown) =>
    ipcRenderer.invoke('aep:ingestTestRun', { buildId, payload }),
  aepIngestDeployment: (opts: {
    buildId: number
    environmentLabel: string
    deployedBy?: string
    version?: string
  }) => ipcRenderer.invoke('aep:ingestDeployment', opts),
  aepSnapshotKpis: () => ipcRenderer.invoke('aep:snapshotKPIs'),
  aepRecordKpiManual: (kpiNodeId: number, value: number, window: string) =>
    ipcRenderer.invoke('aep:recordKpiManual', { kpiNodeId, value, window }),
  aepRunA10: (featureId: number) => ipcRenderer.invoke('aep:runA10', { featureId }),
  aepRunA11: (opts: {
    buildId: number
    environmentLabel: string
    kpiNodeIds?: number[]
    breachThresholdPct?: number
  }) => ipcRenderer.invoke('aep:runA11', opts),
  aepRunA12: (featureId: number, observationWindow?: string) =>
    ipcRenderer.invoke('aep:runA12', { featureId, observationWindow }),
  aepRunA13: (featureId: number, deploymentId: number) =>
    ipcRenderer.invoke('aep:runA13', { featureId, deploymentId }),
  aepRunA14: (featureId: number, opts?: { verdicts?: unknown[]; learningNotes?: string }) =>
    ipcRenderer.invoke('aep:runA14', { featureId, ...opts }),
  aepRunPassG: (opts: {
    deploymentId: number
    featureId: number
    observationWindow?: string
    triggerLearningHook?: boolean
  }) => ipcRenderer.invoke('aep:runPassG', opts),

  // ── AEP: Governance ────────────────────────────────────────────────────────
  aepTickOrchestrator: () => ipcRenderer.invoke('aep:tickOrchestrator'),
  aepForceAdvance: (featureId: number, targetState: string, reason: string) =>
    ipcRenderer.invoke('aep:forceAdvance', { featureId, targetState, reason }),
  aepGetPendingGates: () => ipcRenderer.invoke('aep:getPendingGates'),
  aepApproveGate: (featureId: number, role: string, decision: string, reason: string) =>
    ipcRenderer.invoke('aep:approveGate', { featureId, role, decision, reason }),
  aepGetApprovalSet: (featureId: number) =>
    ipcRenderer.invoke('aep:getApprovalSet', { featureId }),
  aepGetCalibration: (agentId?: string) =>
    ipcRenderer.invoke('aep:getCalibration', { agentId }),
  aepGetGoldenThread: (featureId: number) =>
    ipcRenderer.invoke('aep:getGoldenThread', { featureId }),
  aepDomainFIS: (query: string, mode?: string) =>
    ipcRenderer.invoke('aep:domainFIS', { query, mode }),

  // ── Cycle Runner ───────────────────────────────────────────────────────────
  cycleStart: (input: { label: string; mode: 'live' | 'demo'; painPointIds?: number[] }) =>
    ipcRenderer.invoke('cycle:start', input),
  cycleList: () => ipcRenderer.invoke('cycle:list'),
  cycleGet: (runId: number) => ipcRenderer.invoke('cycle:get', { runId }),
  cycleTimeline: (runId: number) => ipcRenderer.invoke('cycle:timeline', { runId }),
  cycleAdvance: (runId: number) => ipcRenderer.invoke('cycle:advance', { runId }),
  cycleAbort: (runId: number) => ipcRenderer.invoke('cycle:abort', { runId }),
  cyclePortfolioGate: (
    runId: number,
    input: {
      decision: 'admit' | 'defer' | 'reject'
      approvedByRole: string
      rationale: string
      featureNodeId?: number
    },
  ) => ipcRenderer.invoke('cycle:portfolioGate', { runId, input }),
  cycleSignRelease: (runId: number, role: string, rationale: string) =>
    ipcRenderer.invoke('cycle:signRelease', { runId, role, rationale }),
  cycleSimulateSignals: (runId: number) =>
    ipcRenderer.invoke('cycle:simulateSignals', { runId }),
  cycleSimulateCI: (runId: number) => ipcRenderer.invoke('cycle:simulateCI', { runId }),
  cycleSimulateKpi: (runId: number, drift?: number) =>
    ipcRenderer.invoke('cycle:simulateKpi', { runId, drift }),
  onCycleUpdate: (handler: Handler<unknown>): Unsubscribe => on('cycle:update', handler),
  onCycleProgress: (handler: Handler<unknown>): Unsubscribe => on('cycle:progress', handler),

  // ── Journey UI read models ─────────────────────────────────────────────────
  uxGetJourneyBoard: () => ipcRenderer.invoke('ux:getJourneyBoard'),
  uxGetFeatureStory: (featureId: number) =>
    ipcRenderer.invoke('ux:getFeatureStory', { featureId }),
  uxGetActions: (opts?: { role?: string }) => ipcRenderer.invoke('ux:getActions', opts),
  uxGetGraphNode: (nodeId: number) => ipcRenderer.invoke('ux:getGraphNode', { nodeId }),
  uxGetHomeStats: () => ipcRenderer.invoke('ux:getHomeStats'),

  // ── AEP: Events ────────────────────────────────────────────────────────────
  onAepPassProgress: (handler: Handler<unknown>): Unsubscribe =>
    on('aep:passProgress', handler),
  onAepPassComplete: (handler: Handler<unknown>): Unsubscribe =>
    on('aep:passComplete', handler),
  onAepPassError: (handler: Handler<unknown>): Unsubscribe =>
    on('aep:passError', handler),
  onAepStateChanged: (handler: Handler<unknown>): Unsubscribe =>
    on('aep:stateChanged', handler),

  // ── Dialog / Shell ─────────────────────────────────────────────────────────
  showOpenDialog: (opts: OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:showOpen', opts) as Promise<OpenDialogResult>,

  openPath: (path: string) =>
    ipcRenderer.invoke('shell:openPath', path) as Promise<string>,
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
