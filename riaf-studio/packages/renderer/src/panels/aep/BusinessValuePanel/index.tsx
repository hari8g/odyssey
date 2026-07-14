import { useCallback, useEffect, useState } from 'react'
import { TrendingUp, RefreshCw, Loader2, Play } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

interface ValueStreamItem {
  id: number
  label: string
  stream_state: string
}

interface HypothesisRow {
  hypothesisNodeId: number
  label: string
  kpiLabel?: string
  direction?: string
  status?: string
}

export function BusinessValuePanel() {
  const [loading, setLoading] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null)
  const [features, setFeatures] = useState<ValueStreamItem[]>([])

  const { hypotheses, setHypotheses } = useAepStore()

  const refresh = useCallback(async () => {
    const [vs, hyps] = await Promise.all([
      eAPI.aepGetValueStream?.() ?? [],
      eAPI.aepGetHypotheses?.() ?? [],
    ])
    setFeatures(vs ?? [])
    setHypotheses(hyps ?? [])
  }, [setHypotheses])

  useEffect(() => { void refresh() }, [refresh])

  const runAgents = async (stage: 'a2' | 'a3' | 'a4' | 'a5') => {
    if (!selectedFeatureId) return
    setLoading(stage)
    setStatus(`Running ${stage.toUpperCase()}…`)
    try {
      let result: unknown
      const feature = features.find((f) => f.id === selectedFeatureId)
      if (!feature) { setStatus('Feature not found'); return }

      // For simplicity we look up briefId from the feature
      const detail = await eAPI.getISSFeatureDetail?.(selectedFeatureId)
      const briefId = (detail as { briefId?: number } | null)?.briefId ?? selectedFeatureId

      if (stage === 'a2') result = await eAPI.aepRunA2?.(briefId, selectedFeatureId)
      else if (stage === 'a3') result = await eAPI.aepRunA3?.(selectedFeatureId, briefId)
      else if (stage === 'a4') result = await eAPI.aepRunA4?.(briefId, selectedFeatureId)
      else result = await eAPI.aepRunA5?.(selectedFeatureId)

      const r = result as { error?: string } | null
      if (r?.error) setStatus(`Error: ${r.error}`)
      else setStatus(`${stage.toUpperCase()} complete`)
      await refresh()
    } finally {
      setLoading(null)
    }
  }

  const selectedFeature = features.find((f) => f.id === selectedFeatureId)
  const featureHypotheses = hypotheses.filter((h) =>
    h.label?.toLowerCase().includes(selectedFeature?.label?.toLowerCase().slice(0, 20) ?? '__'),
  )

  const DIRECTION_COLOR: Record<string, string> = {
    increase: 'text-green-400',
    decrease: 'text-red-400',
    stabilize: 'text-blue-400',
  }

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <TrendingUp size={14} />
          <span>Business Value</span>
        </div>
        <button
          onClick={() => void refresh()}
          className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {status && (
        <div className="px-4 py-1 text-xs text-gray-400 border-b border-border bg-surface shrink-0">
          {status}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Feature selector */}
        <div className="w-2/5 border-r border-border overflow-y-auto">
          <div className="p-2 space-y-1">
            {features.length === 0 ? (
              <p className="text-gray-600 text-xs p-3 text-center">No features. Run A1 first.</p>
            ) : (
              features.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFeatureId(f.id === selectedFeatureId ? null : f.id)}
                  className={clsx(
                    'w-full text-left px-2 py-2 rounded border text-xs transition-colors',
                    selectedFeatureId === f.id
                      ? 'bg-accent/10 border-accent/40 text-gray-200'
                      : 'bg-surface-2 border-border/50 hover:border-border text-gray-300',
                  )}
                >
                  <div className="truncate">{f.label}</div>
                  <div className="text-gray-500 mt-0.5 font-mono">{f.stream_state}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Agent runner + hypotheses */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!selectedFeatureId ? (
            <p className="text-gray-600 text-xs">Select a feature to run agents.</p>
          ) : (
            <>
              <div>
                <div className="text-xs text-gray-500 mb-2">Run agents for: <span className="text-gray-300">{selectedFeature?.label}</span></div>
                <div className="grid grid-cols-2 gap-1">
                  {(['a2', 'a3', 'a4', 'a5'] as const).map((stage) => (
                    <button
                      key={stage}
                      onClick={() => void runAgents(stage)}
                      disabled={loading !== null}
                      className="flex items-center gap-1.5 px-2 py-1.5 text-xs bg-surface-3 hover:bg-surface border border-border hover:border-accent/40 rounded transition-colors disabled:opacity-50"
                    >
                      {loading === stage ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Play size={11} />
                      )}
                      {stage.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {hypotheses.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-2">All Hypotheses ({hypotheses.length})</div>
                  <div className="space-y-1">
                    {hypotheses.slice(0, 20).map((h) => (
                      <div
                        key={h.hypothesisNodeId}
                        className="px-2 py-1.5 rounded bg-surface-2 border border-border/50 text-xs"
                      >
                        <div className="text-gray-200 line-clamp-2">{h.label}</div>
                        {h.direction && (
                          <span className={clsx('mt-0.5', DIRECTION_COLOR[h.direction] ?? 'text-gray-400')}>
                            {h.direction}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
