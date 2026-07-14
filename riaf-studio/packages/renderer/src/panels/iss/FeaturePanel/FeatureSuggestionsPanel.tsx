import { useState } from 'react'
import { CheckCircle2, XCircle, CheckCheck } from 'lucide-react'
import { clsx } from 'clsx'
import type { FeatureSuggestion } from '@shared'

type Props = {
  suggestions: FeatureSuggestion[]
  onRefresh: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-16 bg-surface-3 rounded-full overflow-hidden shrink-0">
      <div
        className={clsx(
          'h-full rounded-full transition-all',
          value >= 0.8 ? 'bg-accent-2' : value >= 0.5 ? 'bg-warn' : 'bg-gray-600',
        )}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  )
}

export function FeatureSuggestionsPanel({ suggestions, onRefresh }: Props) {
  const [busy, setBusy] = useState<number | 'all' | null>(null)

  const pending = suggestions.filter((s) => s.status === 'pending')

  if (pending.length === 0) return null

  const approve = async (id: number) => {
    setBusy(id)
    try {
      await eAPI.approveSuggestion(id)
      onRefresh()
    } finally {
      setBusy(null)
    }
  }

  const reject = async (id: number) => {
    setBusy(id)
    try {
      await eAPI.rejectSuggestion(id)
      onRefresh()
    } finally {
      setBusy(null)
    }
  }

  const approveAll = async () => {
    setBusy('all')
    try {
      await eAPI.approveAllSuggestions()
      onRefresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
          Suggestions ({pending.length})
        </span>
        <button
          onClick={approveAll}
          disabled={busy === 'all'}
          className={clsx(
            'flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border transition-colors',
            busy === 'all'
              ? 'border-border text-gray-600'
              : 'border-accent-2/40 text-accent-2 hover:bg-accent-2/10',
          )}
        >
          <CheckCheck size={11} />
          Approve all
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {pending.map((s) => (
          <div
            key={s.id}
            className="flex items-start gap-2 bg-surface-3 border border-border rounded px-2 py-1.5"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-xs font-mono text-gray-200 truncate">{s.label}</span>
                <span className="shrink-0 text-xs font-mono text-gray-600 bg-surface-2 px-1 rounded">
                  {s.sdlcPhase}
                </span>
              </div>
              {s.description && (
                <p className="text-xs text-gray-500 truncate font-mono">{s.description}</p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <ConfidenceBar value={s.confidence} />
                <span className="text-xs text-gray-600 font-mono">
                  {Math.round(s.confidence * 100)}%
                </span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => approve(s.id)}
                disabled={busy === s.id}
                title="Approve"
                className="text-accent-2 hover:text-accent-2/80 transition-colors disabled:opacity-40"
              >
                <CheckCircle2 size={14} />
              </button>
              <button
                onClick={() => reject(s.id)}
                disabled={busy === s.id}
                title="Reject"
                className="text-gray-600 hover:text-danger transition-colors disabled:opacity-40"
              >
                <XCircle size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
