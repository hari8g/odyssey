import { useState, useCallback, useRef } from 'react'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'
import type { ExtractedSymbol, SymbolKind } from '@shared'

const KINDS: SymbolKind[] = ['function', 'class', 'interface', 'type', 'enum', 'const']

const KIND_COLORS: Record<SymbolKind, string> = {
  function: 'text-accent',
  class: 'text-accent-2',
  interface: 'text-warn',
  type: 'text-blue-400',
  enum: 'text-pink-400',
  const: 'text-gray-400',
}

const KIND_ABBREV: Record<SymbolKind, string> = {
  function: 'fn',
  class: 'cl',
  interface: 'if',
  type: 'ty',
  enum: 'en',
  const: 'co',
}

export function SymbolBrowserPanel() {
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<SymbolKind | null>(null)
  const [symbols, setSymbols] = useState<ExtractedSymbol[]>([])
  const [selected, setSelected] = useState<ExtractedSymbol | null>(null)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSymbols([])
      return
    }
    setLoading(true)
    try {
      const raw = await window.electronAPI.searchSymbols(q, 50)
      if (Array.isArray(raw)) setSymbols(raw)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(q), 350)
  }

  const filtered = kindFilter ? symbols.filter((s) => s.kind === kindFilter) : symbols

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-1.5 focus-within:border-accent/50 transition-colors">
          <Search size={12} className="text-gray-600" />
          <input
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="Search symbols…"
            className="flex-1 bg-transparent text-xs font-mono text-gray-200 placeholder:text-gray-600 outline-none"
          />
        </div>

        <div className="flex gap-1 mt-2 flex-wrap">
          <button
            onClick={() => setKindFilter(null)}
            className={clsx(
              'text-xs px-2 py-0.5 rounded font-mono transition-colors',
              kindFilter === null
                ? 'bg-accent text-white'
                : 'bg-surface-3 text-gray-500 hover:text-gray-200',
            )}
          >
            all
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k === kindFilter ? null : k)}
              className={clsx(
                'text-xs px-2 py-0.5 rounded font-mono transition-colors',
                kindFilter === k
                  ? 'bg-accent text-white'
                  : 'bg-surface-3 text-gray-500 hover:text-gray-200',
              )}
            >
              {k}
            </button>
          ))}
          {filtered.length > 0 && (
            <span className="ml-auto text-xs text-gray-600 font-mono self-center">
              {filtered.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-3 text-xs text-gray-600 font-mono">Searching…</div>
          )}

          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className={clsx(
                'w-full text-left px-3 py-2 border-b border-border hover:bg-surface-2 transition-colors',
                selected?.id === s.id && 'bg-surface-2',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={clsx(
                    'text-xs font-mono font-semibold w-5 shrink-0',
                    KIND_COLORS[s.kind],
                  )}
                >
                  {KIND_ABBREV[s.kind]}
                </span>
                <span className="text-xs font-mono text-gray-200 truncate">{s.name}</span>
                {s.isExported && (
                  <span className="text-xs text-gray-600 font-mono shrink-0">↑</span>
                )}
              </div>
              <div className="text-xs text-gray-600 font-mono truncate mt-0.5 pl-7">
                {s.filePath.split('/').slice(-2).join('/')}:{s.startLine}
              </div>
            </button>
          ))}

          {!loading && filtered.length === 0 && query.trim() && (
            <div className="flex items-center justify-center p-8 text-xs text-gray-600 font-mono">
              No symbols found
            </div>
          )}
        </div>

        {selected && (
          <div className="w-64 border-l border-border bg-surface-2 p-3 overflow-y-auto shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={clsx('text-xs font-semibold font-mono', KIND_COLORS[selected.kind])}>
                {selected.kind}
              </span>
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-gray-600 hover:text-gray-400 font-mono"
              >
                ×
              </button>
            </div>

            <div className="text-sm font-mono text-gray-200 break-all">{selected.name}</div>

            <div className="text-xs text-gray-600 font-mono break-all">
              {selected.filePath}:{selected.startLine}–{selected.endLine}
            </div>

            {selected.signature && (
              <pre className="text-xs font-mono text-gray-300 bg-surface-3 p-2 rounded-md break-all whitespace-pre-wrap">
                {selected.signature}
              </pre>
            )}

            {selected.docstring && (
              <p className="text-xs text-gray-500 leading-relaxed">{selected.docstring}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
