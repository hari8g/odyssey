import { useCallback, useEffect, useState } from 'react'
import { BarChart2, RefreshCw, Loader2, Activity } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

interface GoldenThread {
  featureId: number
  featureLabel: string
  streamState: string
  painPoints: { id: number; label: string }[]
  hypotheses: { hypothesisNodeId: number; label: string }[]
  domainConcepts: { id: number; label: string }[]
  builds: { id: number; label: string }[]
  deployments: { id: number; label: string }[]
  verdicts: { id: number; label: string; kind: string }[]
  learnings: { id: number; label: string }[]
}

interface FeatureItem {
  id: number
  label: string
  stream_state: string
}

export function OutcomeDashboardPanel() {
  const [features, setFeatures] = useState<FeatureItem[]>([])
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null)
  const [goldenThread, setGoldenThread] = useState<GoldenThread | null>(null)
  const [loading, setLoading] = useState(false)
  const [passGLoading, setPassGLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [deploymentId, setDeploymentId] = useState('')

  const refresh = useCallback(async () => {
    const vs = await eAPI.aepGetValueStream?.()
    setFeatures(vs ?? [])
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const loadGoldenThread = async (featureId: number) => {
    setLoading(true)
    try {
      const result = await eAPI.aepGetGoldenThread?.(featureId)
      if ((result as { error?: string })?.error) {
        setStatus(`Error: ${(result as { error: string }).error}`)
        setGoldenThread(null)
      } else {
        setGoldenThread(result as GoldenThread)
      }
    } finally {
      setLoading(false)
    }
  }

  const runPassG = async () => {
    if (!selectedFeatureId) return
    const depId = parseInt(deploymentId, 10)
    if (isNaN(depId)) { setStatus('Enter a valid deployment ID'); return }

    setPassGLoading(true)
    setStatus('Running Pass G (A12 + A13)…')
    try {
      const result = await eAPI.aepRunPassG?.({
        deploymentId: depId,
        featureId: selectedFeatureId,
        triggerLearningHook: true,
      })
      if ((result as { error?: string })?.error) setStatus(`Error: ${(result as { error: string }).error}`)
      else setStatus(`Pass G complete — ${(result as { verdicts?: unknown[] })?.verdicts?.length ?? 0} verdicts`)
      if (selectedFeatureId) await loadGoldenThread(selectedFeatureId)
    } finally {
      setPassGLoading(false)
    }
  }

  const selectedFeature = features.find((f) => f.id === selectedFeatureId)

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <BarChart2 size={14} />
          <span>Outcomes</span>
        </div>
        <button onClick={() => void refresh()} className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded">
          <RefreshCw size={13} />
        </button>
      </div>

      {status && (
        <div className="px-4 py-1 text-xs text-gray-400 border-b border-border bg-surface shrink-0">
          {status}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Feature list */}
        <div className="w-2/5 border-r border-border overflow-y-auto">
          <div className="p-2 space-y-1">
            {features.length === 0 ? (
              <p className="text-gray-600 text-xs p-3 text-center">No features.</p>
            ) : (
              features.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setSelectedFeatureId(f.id === selectedFeatureId ? null : f.id)
                    setGoldenThread(null)
                    if (f.id !== selectedFeatureId) void loadGoldenThread(f.id)
                  }}
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

        {/* Golden thread + Pass G */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!selectedFeatureId ? (
            <p className="text-gray-600 text-xs">Select a feature to view its golden thread.</p>
          ) : (
            <>
              <div className="text-xs text-gray-300 font-medium truncate">{selectedFeature?.label}</div>

              {/* Pass G runner */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Deployment ID"
                  value={deploymentId}
                  onChange={(e) => setDeploymentId(e.target.value)}
                  className="flex-1 bg-surface-3 border border-border rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => void runPassG()}
                  disabled={passGLoading}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-400/20 hover:bg-purple-400/30 text-purple-400 rounded disabled:opacity-50"
                >
                  {passGLoading ? <Loader2 size={11} className="animate-spin" /> : <Activity size={11} />}
                  Pass G
                </button>
              </div>

              {loading && (
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Loading…
                </div>
              )}

              {goldenThread && (
                <div className="space-y-2">
                  <ThreadSection label="Pain Points" items={goldenThread.painPoints} color="text-orange-400" />
                  <ThreadSection label="Domain Concepts" items={goldenThread.domainConcepts} color="text-blue-400" />
                  <ThreadSection label="Hypotheses" items={goldenThread.hypotheses.map((h) => ({ id: h.hypothesisNodeId, label: h.label }))} color="text-purple-400" />
                  <ThreadSection label="Builds" items={goldenThread.builds} color="text-yellow-400" />
                  <ThreadSection label="Deployments" items={goldenThread.deployments} color="text-green-400" />
                  <ThreadSection
                    label="Verdicts"
                    items={goldenThread.verdicts.map((v) => ({
                      id: v.id,
                      label: v.label,
                      badge: v.kind === 'VALIDATES_HYPOTHESIS' ? 'validated' : 'refuted',
                    }))}
                    color="text-teal-400"
                  />
                  <ThreadSection label="Learnings" items={goldenThread.learnings} color="text-accent" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadSection({
  label,
  items,
  color,
}: {
  label: string
  items: { id: number; label: string; badge?: string }[]
  color: string
}) {
  if (!items.length) return null
  return (
    <div>
      <div className={clsx('text-xs font-medium mb-1', color)}>{label} ({items.length})</div>
      <div className="space-y-0.5">
        {items.slice(0, 5).map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-xs text-gray-400">
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span className={clsx('px-1 rounded text-xs shrink-0', item.badge === 'validated' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10')}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
        {items.length > 5 && <div className="text-xs text-gray-600">+{items.length - 5} more</div>}
      </div>
    </div>
  )
}
