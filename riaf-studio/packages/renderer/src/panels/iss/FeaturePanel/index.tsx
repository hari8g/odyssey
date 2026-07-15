import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus,
  Upload,
  Sparkles,
  Play,
  AlertTriangle,
  Loader2,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useISSStore } from '@/store/iss.store'
import { ManualFeatureModal } from './ManualFeatureModal'
import { ImportFeaturesDialog } from './ImportFeaturesDialog'
import { FeatureSuggestionsPanel } from './FeatureSuggestionsPanel'
import type { FeatureSummary, SDLCMode } from '@shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

const SDLC_MODES: SDLCMode[] = [
  'auto',
  'requirements',
  'design',
  'implementation',
  'testing',
  'deployment',
  'maintenance',
]

const PHASE_COLOR: Record<string, string> = {
  requirements: '#7c6aff',
  design: '#10b981',
  implementation: '#f59e0b',
  testing: '#3b82f6',
  deployment: '#f97316',
  maintenance: '#6b7280',
}

function CompletionBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-full bg-surface-3 rounded-full overflow-hidden">
      <div
        className="h-full bg-accent transition-all duration-300 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function AlignmentBadge({ mode }: { mode: string }) {
  const meta =
    mode === 'embedding'
      ? {
          label: 'Embeddings',
          title: 'Feature↔code alignment uses semantic embeddings.',
          colors: 'bg-accent-2/10 border-accent-2/30 text-accent-2',
        }
      : mode === 'bm25_fallback'
        ? {
            label: 'Keyword match',
            title:
              'Not an error. Embeddings are off or unreachable, so Pass C linked features to code with keyword search (BM25). Enable Embeddings in Settings for better matches.',
            colors: 'bg-warn/10 border-warn/30 text-warn',
          }
        : {
            label: 'Alignment n/a',
            title: 'Alignment mode is not available yet. Open a workspace and run Pass C.',
            colors: 'bg-surface-3 border-border text-gray-600',
          }

  return (
    <span
      title={meta.title}
      className={clsx('px-1.5 py-0.5 rounded border text-xs font-mono cursor-help', meta.colors)}
    >
      {meta.label}
    </span>
  )
}

function FeatureRow({
  feature,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onViewStory,
}: {
  feature: FeatureSummary
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onViewStory: () => void
}) {
  const phaseColor = feature.sdlcPhase ? (PHASE_COLOR[feature.sdlcPhase] ?? '#4b5563') : '#4b5563'
  return (
    <div
      onClick={onSelect}
      className={clsx(
        'flex flex-col gap-1 px-2 py-1.5 rounded cursor-pointer transition-colors group',
        selected
          ? 'bg-accent/10 border border-accent/30'
          : 'bg-surface-3 border border-border hover:border-accent/20',
      )}
    >
      <div className="flex items-center gap-1.5">
        {feature.sdlcPhase && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: phaseColor }}
          />
        )}
        <span className="flex-1 text-xs font-mono text-gray-200 truncate">{feature.label}</span>
        <span className="text-xs font-mono text-gray-600 shrink-0">
          {feature.completionPct}%
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-300 transition-all"
          title="Edit"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-danger transition-all"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {feature.domainConcept && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent-2/40 bg-accent-2/10 text-accent-2 font-mono truncate max-w-[140px]">
            {feature.domainConcept}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onViewStory()
          }}
          className="text-[10px] text-accent hover:underline ml-auto"
        >
          View story →
        </button>
      </div>
      <CompletionBar pct={feature.completionPct} />
      {feature.description && (
        <p className="text-xs text-gray-600 truncate font-mono">{feature.description}</p>
      )}
    </div>
  )
}

export function FeaturePanel() {
  const navigate = useNavigate()
  const {
    features,
    sdlcMode,
    alignmentMode,
    passProgress,
    passRunning,
    suggestions,
    needsFeatures,
    coChangeWarning,
    selectedFeatureId,
    setFeatures,
    setSdlcMode,
    setAlignmentMode,
    setSuggestions,
    setNeedsFeatures,
    setCoChangeWarning,
    setPassProgress,
    setPassRunning,
    setSelectedFeature,
  } = useISSStore()

  const [addOpen, setAddOpen] = useState(false)
  const [editFeature, setEditFeature] = useState<FeatureSummary | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [runningPassC, setRunningPassC] = useState(false)

  const loadFeatures = useCallback(async () => {
    try {
      const result = await eAPI.getISSFeatures()
      if (Array.isArray(result)) {
        setFeatures(result)
        if (result.length > 0) setNeedsFeatures(false)
      }
    } catch {
      /* ignore */
    }
  }, [setFeatures, setNeedsFeatures])

  const loadSuggestions = useCallback(async () => {
    try {
      const result = await eAPI.getISSSuggestions()
      if (Array.isArray(result)) setSuggestions(result)
    } catch {
      /* ignore */
    }
  }, [setSuggestions])

  const loadAlignmentMode = useCallback(async () => {
    try {
      const mode = await eAPI.getISSAlignmentMode()
      if (mode) setAlignmentMode(mode)
    } catch {
      /* ignore */
    }
  }, [setAlignmentMode])

  const loadSdlcMode = useCallback(async () => {
    try {
      const mode = await eAPI.getSdlcMode()
      if (mode) setSdlcMode(mode)
    } catch {
      /* ignore */
    }
  }, [setSdlcMode])

  useEffect(() => {
    loadFeatures()
    loadSuggestions()
    loadAlignmentMode()
    loadSdlcMode()
  }, [loadFeatures, loadSuggestions, loadAlignmentMode, loadSdlcMode])

  useEffect(() => {
    const unsubProgress = eAPI.onISSPassProgress?.((p: typeof passProgress) => {
      setPassProgress(p)
      setPassRunning(true)
    })
    const unsubComplete = eAPI.onISSPassComplete?.(() => {
      setPassRunning(false)
      setPassProgress(null)
      loadFeatures()
    })
    const unsubError = eAPI.onISSPassError?.(() => {
      setPassRunning(false)
      setPassProgress(null)
    })
    const unsubNeeds = eAPI.onISSNeedsFeatures?.((payload: { message: string }) => {
      setNeedsFeatures(true)
      void payload
    })
    const unsubCoChange = eAPI.onISSCoChangeWarning?.(
      (w: NonNullable<ReturnType<typeof useISSStore.getState>['coChangeWarning']>) => {
        setCoChangeWarning(w)
      },
    )
    return () => {
      unsubProgress?.()
      unsubComplete?.()
      unsubError?.()
      unsubNeeds?.()
      unsubCoChange?.()
    }
  }, [setPassProgress, setPassRunning, setNeedsFeatures, setCoChangeWarning, loadFeatures])

  const handleSdlcModeChange = async (m: SDLCMode) => {
    setSdlcMode(m)
    try {
      await eAPI.setSdlcMode(m)
    } catch {
      /* ignore */
    }
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      await eAPI.discoverFeatures()
      await loadSuggestions()
    } finally {
      setDiscovering(false)
    }
  }

  const handleRunPassC = async () => {
    setRunningPassC(true)
    try {
      await eAPI.runISSPassC()
    } finally {
      setRunningPassC(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await eAPI.featureDelete(id)
      await loadFeatures()
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-auto">
          Features
        </span>
        <AlignmentBadge mode={alignmentMode} />
        <select
          value={sdlcMode}
          onChange={(e) => handleSdlcModeChange(e.target.value as SDLCMode)}
          className="bg-surface-3 border border-border rounded px-1.5 py-0.5 text-xs font-mono text-gray-300 outline-none focus:border-accent transition-colors"
        >
          {SDLC_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Banners */}
      {needsFeatures && features.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warn/10 border-b border-warn/30 shrink-0">
          <AlertTriangle size={12} className="text-warn shrink-0" />
          <span className="text-xs text-warn font-mono flex-1">
            ACTION REQUIRED — no features defined. Add, import, or discover features to begin ISS
            analysis.
          </span>
        </div>
      )}

      {coChangeWarning && (
        <div className="flex items-start gap-2 px-3 py-2 bg-surface-2 border-b border-border shrink-0">
          <AlertTriangle size={12} className="text-warn shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 font-mono truncate">
              Co-change:{' '}
              <span className="text-gray-200">{coChangeWarning.editedFile.split('/').pop()}</span>
            </p>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {coChangeWarning.partners.slice(0, 4).map((p) => (
                <span
                  key={p.filePath}
                  className="text-xs font-mono text-gray-600 bg-surface-3 px-1 rounded"
                >
                  {p.filePath.split('/').pop()} {Math.round(p.weight * 100)}%
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => setCoChangeWarning(null)}
            className="text-gray-600 hover:text-gray-400 shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Pass progress */}
      {passRunning && passProgress && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Loader2 size={11} className="text-accent animate-spin shrink-0" />
            <span className="text-xs font-mono text-gray-400 flex-1 truncate">
              Pass {passProgress.pass} — {passProgress.stage}
            </span>
            <span className="text-xs font-mono text-gray-600">{passProgress.pct}%</span>
          </div>
          <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${passProgress.pct}%` }}
            />
          </div>
          {passProgress.detail && (
            <p className="text-xs text-gray-600 font-mono mt-0.5 truncate">{passProgress.detail}</p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <button
          onClick={() => {
            setEditFeature(null)
            setAddOpen(true)
          }}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded border border-border text-gray-400 hover:text-gray-200 bg-surface-3 transition-colors"
        >
          <Plus size={11} />
          Add
        </button>
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded border border-border text-gray-400 hover:text-gray-200 bg-surface-3 transition-colors"
        >
          <Upload size={11} />
          Import
        </button>
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded border transition-colors',
            discovering
              ? 'border-border text-gray-600 bg-surface-3'
              : 'border-border text-gray-400 hover:text-gray-200 bg-surface-3',
          )}
        >
          {discovering ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Sparkles size={11} />
          )}
          Discover
        </button>
        <button
          onClick={handleRunPassC}
          disabled={runningPassC || passRunning}
          className={clsx(
            'flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded border transition-colors ml-auto',
            runningPassC || passRunning
              ? 'border-border text-gray-600 bg-surface-3'
              : 'border-accent/40 text-accent hover:bg-accent/10 bg-surface-3',
          )}
        >
          {runningPassC ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Play size={11} />
          )}
          Run Pass C
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-3">
        {suggestions.some((s) => s.status === 'pending') && (
          <FeatureSuggestionsPanel
            suggestions={suggestions}
            onRefresh={() => {
              void loadSuggestions()
              void loadFeatures()
            }}
          />
        )}

        {features.length === 0 && !needsFeatures ? (
          <div className="flex items-center justify-center h-24 text-gray-600 text-xs font-mono">
            No features — add, import, or discover.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {features.map((f) => (
              <FeatureRow
                key={f.id}
                feature={f}
                selected={selectedFeatureId === f.id}
                onSelect={() => setSelectedFeature(f.id === selectedFeatureId ? null : f.id)}
                onEdit={() => {
                  setEditFeature(f)
                  setAddOpen(true)
                }}
                onDelete={() => handleDelete(f.id)}
                onViewStory={() => navigate(`/feature/${f.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <ManualFeatureModal
        open={addOpen}
        feature={editFeature}
        onClose={() => {
          setAddOpen(false)
          setEditFeature(null)
        }}
        onSaved={() => void loadFeatures()}
      />
      <ImportFeaturesDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void loadFeatures()}
      />
    </div>
  )
}
