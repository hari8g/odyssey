import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, RefreshCw, Loader2, Plus, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

export function CustomerSignalPanel() {
  const [loading, setLoading] = useState(false)
  const [clustering, setClustering] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [ingestSource, setIngestSource] = useState('import')
  const [ingestContent, setIngestContent] = useState('')
  const [showIngest, setShowIngest] = useState(false)

  const { painPoints, setPainPoints } = useAepStore()

  const refresh = useCallback(async () => {
    const pp = await eAPI.aepGetPainPoints?.()
    setPainPoints(pp ?? [])
  }, [setPainPoints])

  useEffect(() => { void refresh() }, [refresh])

  const ingestSignals = async () => {
    if (!ingestContent.trim()) return
    setLoading(true)
    setStatus('Ingesting signals…')
    try {
      const result = await eAPI.aepIngestSignals?.(ingestSource, ingestContent)
      if (result?.error) {
        setStatus(`Error: ${result.error}`)
      } else {
        setStatus(`Ingested: ${result?.inserted ?? 0} new, ${result?.skipped ?? 0} skipped`)
        setIngestContent('')
        setShowIngest(false)
      }
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const clusterPainPoints = async () => {
    setClustering(true)
    setStatus('Clustering pain points…')
    try {
      const result = await eAPI.aepClusterPainPoints?.()
      if (result?.error) setStatus(`Error: ${result.error}`)
      else setStatus(`${result?.clusters?.length ?? 0} pain points, ${result?.expressesEdges ?? 0} EXPRESSES edges`)
      await refresh()
    } finally {
      setClustering(false)
    }
  }

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <MessageSquare size={14} />
          <span>Customer Signals</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => void refresh()}
            className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setShowIngest((v) => !v)}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
              showIngest ? 'bg-surface-3 text-gray-200' : 'bg-accent/20 text-accent hover:bg-accent/30',
            )}
          >
            <Plus size={11} />
            Ingest
          </button>
          <button
            onClick={() => void clusterPainPoints()}
            disabled={clustering}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-400/20 text-purple-400 hover:bg-purple-400/30 rounded transition-colors disabled:opacity-50"
          >
            {clustering ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Cluster
          </button>
        </div>
      </div>

      {status && (
        <div className="px-4 py-1 text-xs text-gray-400 border-b border-border bg-surface shrink-0">
          {status}
        </div>
      )}

      {showIngest && (
        <div className="p-3 border-b border-border bg-surface shrink-0 space-y-2">
          <div className="text-xs text-gray-400">
            Paste a JSON array: <code className="font-mono">[{"{"}"cohort":"..","type":"..","text":".."{"}"}]</code>
          </div>
          <input
            type="text"
            placeholder="Source system (e.g. 'zendesk')"
            value={ingestSource}
            onChange={(e) => setIngestSource(e.target.value)}
            className="w-full bg-surface-3 border border-border rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent"
          />
          <textarea
            rows={4}
            placeholder='[{"cohort":"enterprise","type":"feature_request","text":"Need bulk export..."}]'
            value={ingestContent}
            onChange={(e) => setIngestContent(e.target.value)}
            className="w-full bg-surface-3 border border-border rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent font-mono resize-none"
          />
          <button
            onClick={() => void ingestSignals()}
            disabled={loading || !ingestContent.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded disabled:opacity-50"
          >
            {loading && <Loader2 size={11} className="animate-spin" />}
            Ingest Signals
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {painPoints.length === 0 ? (
          <p className="text-gray-600 text-xs px-3 py-4 text-center">
            No pain points yet. Ingest signals then click "Cluster".
          </p>
        ) : (
          painPoints.map((pp) => (
            <div
              key={pp.id}
              className="px-3 py-2 rounded bg-surface-2 border border-border/50 hover:border-border transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-200">{pp.label}</span>
                <span className="text-xs text-gray-500 font-mono">{pp.signal_count} signals</span>
              </div>
              {pp.description && (
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{pp.description}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
