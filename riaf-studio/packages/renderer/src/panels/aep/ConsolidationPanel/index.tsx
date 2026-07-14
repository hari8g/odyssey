import { useCallback, useEffect, useState } from 'react'
import { Package, RefreshCw, Loader2, ShieldCheck } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

interface BlastRadiusData {
  featureId: number
  scope1_code: { filePath: string; changeType: string }[]
  scope2_gaps: { filePath: string }[]
  scope3_ops: { kind: string; label: string }[]
  scope4_org: { kpis: string[]; governed: string[]; approvalRoles: string[] }
  approvalSet: string[]
}

interface FeatureItem {
  id: number
  label: string
  stream_state: string
}

export function ConsolidationPanel() {
  const [features, setFeatures] = useState<FeatureItem[]>([])
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null)
  const [blast, setBlast] = useState<BlastRadiusData | null>(null)
  const [loading, setLoading] = useState(false)
  const [a10Loading, setA10Loading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const { pendingGates, setPendingGates } = useAepStore()

  const refresh = useCallback(async () => {
    const [vs, gates] = await Promise.all([
      eAPI.aepGetValueStream?.() ?? [],
      eAPI.aepGetPendingGates?.() ?? [],
    ])
    setFeatures(vs ?? [])
    setPendingGates(Array.isArray(gates) ? gates : [])
  }, [setPendingGates])

  useEffect(() => { void refresh() }, [refresh])

  const loadBlastRadius = async (featureId: number) => {
    setLoading(true)
    try {
      const result = await eAPI.aepGetBlastRadius?.({ featureId })
      if (result?.error) setStatus(`Error: ${result.error}`)
      else setBlast(result as BlastRadiusData)
    } finally {
      setLoading(false)
    }
  }

  const runA10 = async () => {
    if (!selectedFeatureId) return
    setA10Loading(true)
    setStatus('Running A10 Consolidation…')
    try {
      const result = await eAPI.aepRunA10?.(selectedFeatureId)
      if ((result as { error?: string })?.error) setStatus(`Error: ${(result as { error: string }).error}`)
      else setStatus('A10 complete — release readiness report created')
      await refresh()
    } finally {
      setA10Loading(false)
    }
  }

  const approveGate = async (featureId: number) => {
    setStatus('Approving gate…')
    await eAPI.aepApproveGate?.(featureId, 'product', 'approve', 'Manually approved via UI')
    setStatus('Gate approved')
    await refresh()
  }

  const selectedFeature = features.find((f) => f.id === selectedFeatureId)
  const featureGates = pendingGates.filter((g) => g.featureId === selectedFeatureId)

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <Package size={14} />
          <span>Consolidation</span>
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
                    setBlast(null)
                    if (f.id !== selectedFeatureId) void loadBlastRadius(f.id)
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

        {/* Detail */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {!selectedFeatureId ? (
            <p className="text-gray-600 text-xs">Select a feature to view blast radius.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-300 flex-1 truncate">{selectedFeature?.label}</span>
                <button
                  onClick={() => void runA10()}
                  disabled={a10Loading}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded disabled:opacity-50"
                >
                  {a10Loading ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
                  A10
                </button>
              </div>

              {loading && <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Loading blast radius…</div>}

              {blast && (
                <div className="space-y-2">
                  <Section label="Scope 1: Code" count={blast.scope1_code.length}>
                    {blast.scope1_code.slice(0, 8).map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={clsx('px-1 rounded text-xs', f.changeType === 'direct' ? 'bg-accent/20 text-accent' : 'bg-surface-3 text-gray-500')}>
                          {f.changeType}
                        </span>
                        <span className="text-gray-400 truncate font-mono">{f.filePath}</span>
                      </div>
                    ))}
                  </Section>

                  <Section label="Scope 2: Coverage Gaps" count={blast.scope2_gaps.length}>
                    {blast.scope2_gaps.slice(0, 5).map((f, i) => (
                      <div key={i} className="text-xs text-red-400 font-mono truncate">{f.filePath}</div>
                    ))}
                  </Section>

                  {blast.scope4_org.governed.length > 0 && (
                    <Section label="Governed by" count={blast.scope4_org.governed.length}>
                      {blast.scope4_org.governed.map((g, i) => (
                        <div key={i} className="text-xs text-orange-400">{g}</div>
                      ))}
                    </Section>
                  )}

                  {blast.approvalSet.length > 0 && (
                    <Section label="Approvals Required" count={blast.approvalSet.length}>
                      {blast.approvalSet.map((r, i) => <div key={i} className="text-xs text-yellow-400">{r}</div>)}
                    </Section>
                  )}
                </div>
              )}

              {featureGates.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Pending Gates</div>
                  {featureGates.map((gate, i) => (
                    <div key={i} className="px-2 py-2 rounded bg-orange-400/10 border border-orange-400/30 text-xs mb-1">
                      <div className="text-orange-400 font-medium">{gate.streamState}</div>
                      {gate.blockedReasons.map((r, j) => <div key={j} className="text-gray-400">• {r}</div>)}
                      <button
                        onClick={() => void approveGate(gate.featureId)}
                        className="mt-1.5 px-2 py-0.5 bg-orange-400/20 hover:bg-orange-400/30 text-orange-400 rounded"
                      >
                        Approve
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label} <span className="text-gray-600">({count})</span></div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
