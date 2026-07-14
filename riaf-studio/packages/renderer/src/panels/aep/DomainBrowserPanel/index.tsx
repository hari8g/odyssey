import { useCallback, useEffect, useState } from 'react'
import { BookOpen, RefreshCw, Loader2, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

type Tab = 'packs' | 'contexts' | 'concepts' | 'kpis'

export function DomainBrowserPanel() {
  const [tab, setTab] = useState<Tab>('packs')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const { domainPacks, kpis, contexts, concepts, setDomainPacks, setKpis, setContexts, setConcepts } = useAepStore()

  const refresh = useCallback(async () => {
    const [packs, kpisData, ctxData, conceptsData] = await Promise.all([
      eAPI.domainListPacks?.() ?? [],
      eAPI.domainGetKpis?.() ?? [],
      eAPI.domainGetContexts?.() ?? [],
      eAPI.domainGetConcepts?.() ?? [],
    ])
    setDomainPacks(packs ?? [])
    setKpis(kpisData ?? [])
    setContexts(ctxData ?? [])
    setConcepts(conceptsData ?? [])
  }, [setDomainPacks, setKpis, setContexts, setConcepts])

  useEffect(() => { void refresh() }, [refresh])

  const runPassD = async () => {
    setLoading(true)
    setStatus('Running Pass D…')
    try {
      const result = await eAPI.domainRunPassD?.()
      if (result?.error) setStatus(`Error: ${result.error}`)
      else setStatus(`Pass D complete — ${result?.packsLoaded ?? 0} pack(s) loaded`)
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'packs', label: 'Packs', count: domainPacks.length },
    { id: 'contexts', label: 'Contexts', count: contexts.length },
    { id: 'concepts', label: 'Concepts', count: concepts.length },
    { id: 'kpis', label: 'KPIs', count: kpis.length },
  ]

  return (
    <div className="flex flex-col h-full text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <BookOpen size={14} />
          <span>Domain Browser</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => void refresh()}
            className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => void runPassD()}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded transition-colors disabled:opacity-50"
            title="Run Pass D to index domain packs"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            Run Pass D
          </button>
        </div>
      </div>

      {status && (
        <div className="px-4 py-1 text-xs text-gray-400 border-b border-border bg-surface shrink-0">
          {status}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-3 py-2 text-xs font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1 rounded bg-surface-3 text-gray-400">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'packs' && (
          <div className="p-2 space-y-1">
            {domainPacks.length === 0 ? (
              <p className="text-gray-600 text-xs px-2 py-4 text-center">
                No domain packs loaded. Click "Run Pass D" to discover packs in{' '}
                <code className="font-mono">.riaf/domain_packs/</code>.
              </p>
            ) : (
              domainPacks.map((pack) => (
                <div
                  key={pack.name}
                  className="px-3 py-2 rounded bg-surface-2 border border-border/50 hover:border-border transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-accent">{pack.name}</span>
                    <span className="text-xs text-gray-600">v{pack.version}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{pack.node_count} nodes</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'contexts' && (
          <div className="p-2 space-y-1">
            {contexts.length === 0 ? (
              <p className="text-gray-600 text-xs px-2 py-4 text-center">No bounded contexts indexed.</p>
            ) : (
              contexts.map((ctx) => (
                <div key={ctx.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="text-xs font-medium text-gray-200">{ctx.label}</div>
                  {ctx.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ctx.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'concepts' && (
          <div className="p-2 space-y-1">
            {concepts.length === 0 ? (
              <p className="text-gray-600 text-xs px-2 py-4 text-center">No domain concepts indexed.</p>
            ) : (
              concepts.map((c) => (
                <div key={c.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-200">{c.label}</span>
                    <span className="px-1 rounded text-xs bg-surface-3 text-gray-500">{c.kind === 'GLOSSARY_TERM' ? 'term' : 'concept'}</span>
                  </div>
                  {c.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'kpis' && (
          <div className="p-2 space-y-1">
            {kpis.length === 0 ? (
              <p className="text-gray-600 text-xs px-2 py-4 text-center">No KPIs indexed.</p>
            ) : (
              kpis.map((kpi) => (
                <div key={kpi.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="text-xs font-medium text-gray-200">{kpi.label}</div>
                  <div className="flex gap-3 mt-1 text-xs text-gray-500">
                    {kpi.baseline_value != null && <span>baseline: {kpi.baseline_value}</span>}
                    {kpi.target_value != null && <span>target: {kpi.target_value}</span>}
                    {kpi.measurement_unit && <span>{kpi.measurement_unit}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
