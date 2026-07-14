import { CheckCircle2, Circle, XCircle, Loader2, Play, StopCircle, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { useIndexingStore, ALL_STAGES, type StageStatus } from '@/store/indexing.store'
import type { IndexingStage } from '@shared'

const STAGE_LABELS: Record<IndexingStage, string> = {
  scan: 'Scan files',
  chunk: 'Chunk code',
  symbols: 'Extract symbols',
  fts: 'Full-text index',
  imports: 'Resolve imports',
  graph: 'Build UCG graph',
  commands: 'Detect commands',
  git: 'Index git log',
  embeddings: 'Generate embeddings',
  profile: 'Build profile',
}

function StageIcon({ status }: { status: StageStatus | undefined }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={12} className="text-accent-2 shrink-0" />
    case 'running':
      return <Loader2 size={12} className="text-accent animate-spin shrink-0" />
    case 'error':
      return <XCircle size={12} className="text-danger shrink-0" />
    default:
      return <Circle size={12} className="text-gray-700 shrink-0" />
  }
}

type Props = {
  onRunRiaf?: () => void
}

export function IndexingPanel({ onRunRiaf }: Props) {
  const { isRunning, stages, pct, detail, error, completedAt, totalMs } = useIndexingStore()

  const handleStart = async () => {
    await window.electronAPI.startIndexer()
  }

  const handleAbort = async () => {
    await window.electronAPI.abortIndexer()
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Indexing
        </span>
        <div className="flex gap-2">
          {isRunning ? (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors font-mono"
            >
              <StopCircle size={11} />
              Abort
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors font-mono"
            >
              <Play size={11} />
              Run
            </button>
          )}
        </div>
      </div>

      {isRunning && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="font-mono text-gray-400 truncate">{detail || 'Processing…'}</span>
            <span className="font-mono text-gray-500 shrink-0 ml-2">{pct}%</span>
          </div>
          <div className="h-1 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {ALL_STAGES.map((stage) => (
          <div key={stage} className="flex items-center gap-2 py-1">
            <StageIcon status={stages[stage]} />
            <span
              className={clsx(
                'text-xs font-mono',
                stages[stage] === 'running'
                  ? 'text-gray-200'
                  : stages[stage] === 'done'
                    ? 'text-gray-400'
                    : 'text-gray-600',
              )}
            >
              {STAGE_LABELS[stage]}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-md p-3">
          <p className="text-xs text-danger font-mono">{error}</p>
        </div>
      )}

      {completedAt && !isRunning && (
        <div className="flex flex-col gap-2 bg-surface-2 border border-border rounded-md p-3">
          <div className="flex items-center gap-1.5 text-accent-2 text-xs font-mono">
            <CheckCircle2 size={12} />
            <span>Indexing complete</span>
            {totalMs !== null && (
              <span className="text-gray-600">— {(totalMs / 1000).toFixed(1)}s</span>
            )}
          </div>
          {onRunRiaf && (
            <button
              onClick={onRunRiaf}
              className="flex items-center gap-2 mt-1 px-3 py-1.5 bg-accent/10 border border-accent/30 text-accent text-xs rounded hover:bg-accent/20 transition-colors font-mono w-fit"
            >
              <Zap size={11} />
              Run RIAF Analysis →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
