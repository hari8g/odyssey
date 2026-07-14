import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, ChevronRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore, type ValueStreamState } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

const STATE_ORDER: ValueStreamState[] = [
  'INTAKE', 'QUALIFY', 'PRIORITIZE', 'DEFINE',
  'BUILD', 'CONSOLIDATE', 'RELEASE', 'OBSERVE', 'LEARN',
]

const STATE_COLORS: Record<ValueStreamState, string> = {
  INTAKE: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  QUALIFY: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  PRIORITIZE: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  DEFINE: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
  BUILD: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  CONSOLIDATE: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  RELEASE: 'text-green-400 bg-green-400/10 border-green-400/30',
  OBSERVE: 'text-teal-400 bg-teal-400/10 border-teal-400/30',
  LEARN: 'text-accent bg-accent/10 border-accent/30',
}

export function ValueStreamPanel() {
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const { valueStream, pendingGates, setValueStream, setPendingGates } = useAepStore()

  const refresh = useCallback(async () => {
    const [vs, gates] = await Promise.all([
      eAPI.aepGetValueStream?.() ?? [],
      eAPI.aepGetPendingGates?.() ?? [],
    ])
    setValueStream(vs ?? [])
    setPendingGates(Array.isArray(gates) ? gates : [])
  }, [setValueStream, setPendingGates])

  useEffect(() => { void refresh() }, [refresh])

  const tick = async () => {
    setLoading(true)
    try {
      await eAPI.aepTickOrchestrator?.()
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const selectedFeature = valueStream.find((f) => f.id === selected)
  const selectedGates = pendingGates.filter((g) => g.featureId === selected)

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <GitBranch size={14} />
          <span>Value Stream</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => void refresh()}
            className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded transition-colors"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => void tick()}
            disabled={loading}
            className="px-2 py-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded transition-colors disabled:opacity-50"
          >
            Tick
          </button>
        </div>
      </div>

      {/* Pipeline bar */}
      <div className="flex items-center gap-0 px-3 py-2 border-b border-border shrink-0 overflow-x-auto">
        {STATE_ORDER.map((state, i) => {
          const count = valueStream.filter((f) => f.stream_state === state).length
          return (
            <div key={state} className="flex items-center shrink-0">
              {i > 0 && <ChevronRight size={12} className="text-gray-700 mx-0.5" />}
              <div
                className={clsx(
                  'px-2 py-0.5 rounded border text-xs font-mono whitespace-nowrap',
                  STATE_COLORS[state],
                )}
              >
                {state}
                {count > 0 && <span className="ml-1 font-bold">{count}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Feature list */}
        <div className="w-1/2 border-r border-border overflow-y-auto">
          {valueStream.length === 0 ? (
            <p className="text-gray-600 text-xs px-3 py-4 text-center">
              No features in value stream yet. Run A1 to create features from pain points.
            </p>
          ) : (
            <div className="p-2 space-y-1">
              {valueStream.map((f) => {
                const isBlocked = f.blocked_on_json != null
                const hasGate = pendingGates.some((g) => g.featureId === f.id)
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelected(f.id === selected ? null : f.id)}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded border transition-colors',
                      selected === f.id
                        ? 'bg-accent/10 border-accent/40'
                        : 'bg-surface-2 border-border/50 hover:border-border',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {isBlocked || hasGate ? (
                        <AlertCircle size={11} className="text-orange-400 shrink-0" />
                      ) : (
                        <CheckCircle2 size={11} className="text-gray-600 shrink-0" />
                      )}
                      <span className="text-xs text-gray-200 truncate flex-1">{f.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className={clsx(
                          'px-1.5 py-0.5 rounded border text-xs font-mono',
                          STATE_COLORS[f.stream_state] ?? 'text-gray-400',
                        )}
                      >
                        {f.stream_state}
                      </span>
                      {(isBlocked || hasGate) && (
                        <span className="text-xs text-orange-400">gate pending</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail pane */}
        <div className="w-1/2 overflow-y-auto p-3">
          {selectedFeature ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Feature</div>
                <div className="text-sm text-gray-200">{selectedFeature.label}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">State</div>
                <span className={clsx('px-2 py-1 rounded border text-xs font-mono', STATE_COLORS[selectedFeature.stream_state] ?? '')}>
                  {selectedFeature.stream_state}
                </span>
              </div>
              {selectedGates.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Pending Gates</div>
                  <div className="space-y-1">
                    {selectedGates.map((gate, i) => (
                      <div key={i} className="px-2 py-1.5 rounded bg-orange-400/10 border border-orange-400/30 text-xs">
                        <div className="text-orange-400">{gate.streamState}</div>
                        {gate.blockedReasons.map((r, j) => (
                          <div key={j} className="text-gray-400 mt-0.5">• {r}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <Clock size={11} />
                {selectedFeature.entered_state_at
                  ? new Date(selectedFeature.entered_state_at).toLocaleDateString()
                  : 'unknown'}
              </div>
            </div>
          ) : (
            <p className="text-gray-600 text-xs">Select a feature to view details.</p>
          )}
        </div>
      </div>
    </div>
  )
}
