import { useState, useCallback, useRef } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { CodebaseSearchResult } from '@shared'

type SearchMode = 'bm25' | 'hybrid'

export function SearchPanel() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('bm25')
  const [results, setResults] = useState<CodebaseSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string, m: SearchMode) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const raw =
        m === 'hybrid'
          ? await window.electronAPI.searchCodebaseHybrid(q, 30)
          : await window.electronAPI.searchCodebase(q, 30)
      if (Array.isArray(raw)) {
        setResults(raw)
      } else {
        setError('error' in raw ? raw.error : 'Search failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q, mode), 400)
  }

  const handleModeChange = (m: SearchMode) => {
    setMode(m)
    if (query.trim()) doSearch(query, m)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-1.5 focus-within:border-accent/50 transition-colors">
          <Search size={12} className="text-gray-600" />
          <input
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search codebase…"
            className="flex-1 bg-transparent text-xs font-mono text-gray-200 placeholder:text-gray-600 outline-none"
          />
          {loading && <Loader2 size={11} className="text-accent animate-spin" />}
        </div>

        <div className="flex items-center gap-2 mt-2">
          {(['bm25', 'hybrid'] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded font-mono transition-colors',
                mode === m
                  ? 'bg-accent text-white'
                  : 'bg-surface-3 text-gray-500 hover:text-gray-200',
              )}
            >
              {m === 'bm25' ? 'BM25' : 'Hybrid'}
            </button>
          ))}
          {results.length > 0 && (
            <span className="ml-auto text-xs text-gray-600 font-mono">
              {results.length} results
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && <div className="p-3 text-xs text-danger font-mono">{error}</div>}

        {results.map((r, i) => (
          <div
            key={i}
            className="border-b border-border px-3 py-2.5 hover:bg-surface-2 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-accent truncate">{r.filePath}</span>
              <span className="text-xs text-gray-600 font-mono shrink-0 ml-2">
                :{r.startLine}
              </span>
            </div>
            <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all leading-relaxed">
              {r.snippet}
            </pre>
            <div className="text-xs text-gray-700 font-mono mt-1">
              score: {r.score.toFixed(3)}
            </div>
          </div>
        ))}

        {!loading && results.length === 0 && query.trim() && (
          <div className="flex items-center justify-center p-8 text-xs text-gray-600 font-mono">
            No results for &quot;{query}&quot;
          </div>
        )}
      </div>
    </div>
  )
}
