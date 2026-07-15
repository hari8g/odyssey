import { useState } from 'react'
import { clsx } from 'clsx'
import { Loader2, Search } from 'lucide-react'
import type { SDLCMode, DomainAwareFISResult } from '@shared'
import { EmptyState, useToast } from '@/design/primitives'

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

type ImpactRow = DomainAwareFISResult & { regulations?: string[] }

export function ImpactPanel() {
  const { push } = useToast()
  const [query, setQuery] = useState('')
  const [sdlcMode, setSdlcMode] = useState<SDLCMode>('auto')
  const [results, setResults] = useState<ImpactRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranAt, setRanAt] = useState<number | null>(null)

  const handleRun = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      // Prefer domain-aware FIS so governed files carry regulation badges
      const res =
        (await eAPI.aepDomainFIS?.(query.trim(), sdlcMode)) ??
        (await eAPI.impactAnalysis?.(query.trim(), sdlcMode))
      if (res && typeof res === 'object' && 'error' in res) {
        const msg = String((res as { error: unknown }).error)
        setError(msg)
        push({ message: msg, status: 'danger' })
      } else if (Array.isArray(res)) {
        setResults(res as ImpactRow[])
      } else if (res && typeof res === 'object' && 'data' in res) {
        const d = (res as { data: unknown }).data
        setResults(Array.isArray(d) ? (d as ImpactRow[]) : [])
      }
      setRanAt(Date.now())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      push({ message: msg, status: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  const maxScore = results.reduce((m, r) => Math.max(m, r.score), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Impact Analysis
        </span>
      </div>

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
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
            Analyze
          </button>
          {ranAt && !loading && (
            <span className="text-xs text-gray-700 font-mono ml-auto">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center gap-1.5 text-gray-600 text-xs font-mono">
            <Loader2 size={11} className="animate-spin" />
            Analyzing…
          </div>
        ) : error ? (
          <div className="space-y-2">
            <p className="text-xs text-danger font-mono">{error}</p>
            <button
              type="button"
              onClick={() => void handleRun()}
              className="text-xs text-accent underline"
            >
              Retry
            </button>
          </div>
        ) : results.length === 0 && ranAt ? (
          <EmptyState
            verb="BUILD"
            title="No impacted files"
            body="Try a broader query or a feature label that appears in the codebase."
          />
        ) : results.length === 0 ? (
          <EmptyState
            verb="BUILD"
            title="What else changes?"
            body="Enter a file path, symbol, or feature description and press Analyze."
          />
        ) : (
          <div className="flex flex-col gap-1">
            {results.map((r, i) => {
              const regs = r.regulations?.length
                ? r.regulations
                : r.isGoverned
                  ? ['Governed']
                  : []
              return (
                <div
                  key={r.filePath + i}
                  className="flex items-start gap-2 bg-surface-3 border border-border rounded px-2 py-1.5"
                >
                  <span className="text-xs font-mono text-gray-600 shrink-0 w-5 text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-gray-200 truncate">{r.filePath}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {r.sdlcPhase && (
                        <span className="text-xs font-mono text-gray-600">{r.sdlcPhase}</span>
                      )}
                      {r.nodeKind && (
                        <span className="text-xs font-mono text-gray-700">{r.nodeKind}</span>
                      )}
                      {regs.map((reg) => (
                        <span
                          key={reg}
                          title={`This file is subject to ${reg} — include Compliance in the release approval.`}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-warn/40 bg-warn/10 text-warn font-mono cursor-help"
                        >
                          {reg}
                        </span>
                      ))}
                      <span className="text-xs font-mono text-gray-600 ml-auto">
                        ×{r.importedByCount}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <ScoreBar score={r.score} max={maxScore} />
                    <span className="text-xs font-mono text-gray-600">{r.score.toFixed(3)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
