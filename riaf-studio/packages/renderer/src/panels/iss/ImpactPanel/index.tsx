import { useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, Search } from 'lucide-react'
import type { SDLCMode, FISResult } from '@shared'

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

const INPUT =
  'bg-surface-3 border border-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors'

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0
  return (
    <div className="h-1 w-20 bg-surface-3 rounded-full overflow-hidden shrink-0">
      <div
        className="h-full bg-accent/70 rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function ImpactPanel() {
  const [query, setQuery] = useState('')
  const [sdlcMode, setSdlcMode] = useState<SDLCMode>('auto')
  const [results, setResults] = useState<FISResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranAt, setRanAt] = useState<number | null>(null)

  const handleRun = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await eAPI.impactAnalysis({ query: query.trim(), sdlcMode })
      if (Array.isArray(res)) {
        setResults(res as FISResult[])
      } else if (res && typeof res === 'object' && 'error' in res) {
        setError(String((res as { error: unknown }).error))
      } else if (res && typeof res === 'object' && 'data' in res) {
        const d = (res as { data: unknown }).data
        setResults(Array.isArray(d) ? (d as FISResult[]) : [])
      }
      setRanAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const maxScore = results.reduce((m, r) => Math.max(m, r.score), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Impact Analysis
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRun()
            }}
            placeholder="File path, symbol, or description…"
            className={clsx(INPUT, 'flex-1')}
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sdlcMode}
            onChange={(e) => setSdlcMode(e.target.value as SDLCMode)}
            className={clsx(INPUT, 'w-auto')}
          >
            {SDLC_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={() => void handleRun()}
            disabled={loading || !query.trim()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors',
              loading || !query.trim()
                ? 'bg-surface-3 border-border text-gray-600'
                : 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20',
            )}
          >
            {loading ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Search size={11} />
            )}
            Analyze
          </button>
          {ranAt && !loading && (
            <span className="text-xs text-gray-700 font-mono ml-auto">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-1.5 text-gray-600 text-xs font-mono">
            <Loader2 size={11} className="animate-spin" />
            Analyzing…
          </div>
        ) : error ? (
          <p className="text-xs text-danger font-mono">{error}</p>
        ) : results.length === 0 && ranAt ? (
          <div className="text-xs text-gray-600 font-mono">No results.</div>
        ) : results.length === 0 ? (
          <div className="text-xs text-gray-700 font-mono">
            Enter a query and press Analyze.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {results.map((r, i) => (
              <div
                key={r.filePath + i}
                className="flex items-start gap-2 bg-surface-3 border border-border rounded px-2 py-1.5"
              >
                <span className="text-xs font-mono text-gray-600 shrink-0 w-5 text-right">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-200 truncate">{r.filePath}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.sdlcPhase && (
                      <span className="text-xs font-mono text-gray-600">{r.sdlcPhase}</span>
                    )}
                    {r.nodeKind && (
                      <span className="text-xs font-mono text-gray-700">{r.nodeKind}</span>
                    )}
                    <span className="text-xs font-mono text-gray-600 ml-auto">
                      ×{r.importedByCount}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <ScoreBar score={r.score} max={maxScore} />
                  <span className="text-xs font-mono text-gray-600">
                    {r.score.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
