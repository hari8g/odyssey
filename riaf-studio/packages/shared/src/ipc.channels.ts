// packages/shared/src/ipc.channels.ts

export const IPC = {
  // Workspace
  WORKSPACE_OPEN: 'workspace:open',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_GET_PROFILE: 'workspace:getProfile',
  WORKSPACE_GET_ROOT: 'workspace:getRoot',
  WORKSPACE_CHANGED: 'workspace:changed',
  WORKSPACE_CLEAR_RECENT: 'workspace:clearRecent',
  WORKSPACE_REMOVE_RECENT: 'workspace:removeRecent',
  WORKSPACE_REOPEN: 'workspace:reopen',

  // Indexing pipeline
  INDEXER_START: 'indexer:start',
  INDEXER_ABORT: 'indexer:abort',
  INDEXER_GET_STATUS: 'indexer:getStatus',
  INDEXER_PROGRESS: 'indexer:progress',
  INDEXER_COMPLETE: 'indexer:complete',
  INDEXER_ERROR: 'indexer:error',

  // Search
  SEARCH_CODEBASE: 'search:codebase',
  SEARCH_CODEBASE_HYBRID: 'search:codebaseHybrid',
  SEARCH_SYMBOLS: 'search:symbols',

  // UCG graph
  UCG_GET_GRAPH: 'ucg:getGraph',
  UCG_GET_METRICS: 'ucg:getMetrics',
  UCG_GET_IMPORT_GRAPH: 'ucg:getImportGraph',

  // Git
  GIT_DIFF_STAT: 'git:diffStat',
  GIT_RECENTLY_CHANGED: 'git:recentlyChanged',

  // RIAF agent
  RIAF_START: 'riaf:start',
  RIAF_ABORT: 'riaf:abort',
  RIAF_GET_STATE: 'riaf:getState',
  RIAF_STREAM_CHUNK: 'riaf:streamChunk',
  RIAF_STATE_CHANGE: 'riaf:stateChange',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // ISS: Pass triggers
  ISS_RUN_PASS_A: 'iss:runPassA',
  ISS_RUN_PASS_B: 'iss:runPassB',
  ISS_RUN_PASS_C: 'iss:runPassC',
  ISS_PASS_PROGRESS: 'iss:passProgress',
  ISS_PASS_COMPLETE: 'iss:passComplete',
  ISS_PASS_ERROR: 'iss:passError',
  ISS_NEEDS_FEATURES: 'iss:needsFeatures',

  // ISS: Graph queries
  ISS_GET_FEATURES: 'iss:getFeatures',
  ISS_GET_FEATURE_DETAIL: 'iss:getFeatureDetail',
  ISS_GET_GRAPH_NODES: 'iss:getGraphNodes',
  ISS_GET_GRAPH_EDGES: 'iss:getGraphEdges',
  ISS_GET_COCHANGE: 'iss:getCoChangePartners',
  ISS_GET_FEATURE_COUNT: 'iss:getFeatureCount',

  // ISS: Manual feature management
  ISS_FEATURE_CREATE: 'iss:featureCreate',
  ISS_FEATURE_UPDATE: 'iss:featureUpdate',
  ISS_FEATURE_DELETE: 'iss:featureDelete',
  ISS_FEATURE_IMPORT: 'iss:featureImport',
  ISS_FEATURE_IMPORT_PREVIEW: 'iss:featureImportPreview',
  ISS_FEATURE_GET_AUDIT: 'iss:featureGetAudit',

  // ISS: Auto-discovery (C3.5)
  ISS_DISCOVER_FEATURES: 'iss:discoverFeatures',
  ISS_GET_SUGGESTIONS: 'iss:getSuggestions',
  ISS_APPROVE_SUGGESTION: 'iss:approveSuggestion',
  ISS_REJECT_SUGGESTION: 'iss:rejectSuggestion',
  ISS_APPROVE_ALL_SUGGESTIONS: 'iss:approveAllSuggestions',

  // ISS: Alignment
  ISS_RUN_ALIGNMENT: 'iss:runAlignment',
  ISS_ALIGNMENT_MODE: 'iss:getAlignmentMode',

  // ISS: PO Tools
  ISS_TRACE_FEATURE: 'iss:traceFeature',
  ISS_IMPACT_ANALYSIS: 'iss:impactAnalysis',
  ISS_FEATURE_STATUS: 'iss:featureStatus',
  ISS_FIND_SIMILAR: 'iss:findSimilar',
  ISS_GEN_CRITERIA: 'iss:genCriteria',
  ISS_SUGGEST_ARCH: 'iss:suggestArch',

  // ISS: SDLC Router
  ISS_GET_SDLC_MODE: 'iss:getSdlcMode',
  ISS_SET_SDLC_MODE: 'iss:setSdlcMode',

  // ISS: Write gate
  ISS_COCHANGE_WARNING: 'iss:coChangeWarning',

  // Domain (L0)
  DOMAIN_LIST_PACKS: 'domain:listPacks',
  DOMAIN_LOAD_PACK: 'domain:loadPack',
  DOMAIN_GET_KPIS: 'domain:getKpis',
  DOMAIN_GET_CONTEXTS: 'domain:getContexts',
  DOMAIN_GET_REGULATIONS: 'domain:getRegulations',
  DOMAIN_GET_CONCEPTS: 'domain:getConcepts',
  DOMAIN_RUN_PASS_D: 'domain:runPassD',

  // AEP: Pass progress
  AEP_PASS_PROGRESS: 'aep:passProgress',
  AEP_PASS_COMPLETE: 'aep:passComplete',
  AEP_PASS_ERROR: 'aep:passError',
  AEP_READY_TO_QUALIFY: 'aep:readyToQualify',
  AEP_STATE_CHANGED: 'aep:stateChanged',

  // AEP: Upstream
  AEP_INGEST_SIGNALS: 'aep:ingestSignals',
  AEP_CLUSTER_PAIN_POINTS: 'aep:clusterPainPoints',
  AEP_GET_PAIN_POINTS: 'aep:getPainPoints',
  AEP_LOAD_ORG_PACKS: 'aep:loadOrgPacks',
  AEP_RUN_A1: 'aep:runA1',
  AEP_RUN_A2: 'aep:runA2',
  AEP_RUN_A3: 'aep:runA3',
  AEP_RUN_A4: 'aep:runA4',
  AEP_RUN_A5: 'aep:runA5',
  AEP_PORTFOLIO_GATE: 'aep:portfolioGate',
  AEP_GET_HYPOTHESES: 'aep:getHypotheses',
  AEP_GET_VALUE_STREAM: 'aep:getValueStream',

  // AEP: Downstream
  AEP_GET_BLAST_RADIUS: 'aep:getBlastRadius',
  AEP_RUN_A10: 'aep:runA10',
  AEP_RUN_A11: 'aep:runA11',
  AEP_RUN_A12: 'aep:runA12',
  AEP_RUN_A13: 'aep:runA13',
  AEP_RUN_A14: 'aep:runA14',
  AEP_INGEST_BUILD: 'aep:ingestBuildEvent',
  AEP_INGEST_TEST_RUN: 'aep:ingestTestRun',
  AEP_INGEST_DEPLOYMENT: 'aep:ingestDeployment',
  AEP_SNAPSHOT_KPIS: 'aep:snapshotKPIs',
  AEP_RECORD_KPI_MANUAL: 'aep:recordKpiManual',
  AEP_RUN_PASS_G: 'aep:runPassG',

  // AEP: Governance
  AEP_TICK_ORCHESTRATOR: 'aep:tickOrchestrator',
  AEP_FORCE_ADVANCE: 'aep:forceAdvance',
  AEP_GET_PENDING_GATES: 'aep:getPendingGates',
  AEP_APPROVE_GATE: 'aep:approveGate',
  AEP_GET_APPROVAL_SET: 'aep:getApprovalSet',
  AEP_GET_CALIBRATION: 'aep:getCalibration',
  AEP_GET_GOLDEN_THREAD: 'aep:getGoldenThread',
  AEP_DOMAIN_FIS: 'aep:domainFIS',

  // Cycle Runner
  CYCLE_START: 'cycle:start',
  CYCLE_LIST: 'cycle:list',
  CYCLE_GET: 'cycle:get',
  CYCLE_TIMELINE: 'cycle:timeline',
  CYCLE_ADVANCE: 'cycle:advance',
  CYCLE_ABORT: 'cycle:abort',
  CYCLE_PORTFOLIO_GATE: 'cycle:portfolioGate',
  CYCLE_SIGN_RELEASE: 'cycle:signRelease',
  CYCLE_SIMULATE_SIGNALS: 'cycle:simulateSignals',
  CYCLE_SIMULATE_CI: 'cycle:simulateCI',
  CYCLE_SIMULATE_KPI: 'cycle:simulateKpi',
  CYCLE_UPDATE: 'cycle:update',
  CYCLE_PROGRESS: 'cycle:progress',

  // Journey UX read-models
  UX_GET_JOURNEY_BOARD: 'ux:getJourneyBoard',
  UX_GET_FEATURE_STORY: 'ux:getFeatureStory',
  UX_GET_ACTIONS: 'ux:getActions',
  UX_GET_GRAPH_NODE: 'ux:getGraphNode',
  UX_GET_HOME_STATS: 'ux:getHomeStats',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
