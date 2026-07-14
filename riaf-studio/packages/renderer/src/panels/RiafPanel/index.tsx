import { useState, useRef, useEffect } from 'react'
import { Zap, Square, FolderOpen } from 'lucide-react'
import { clsx } from 'clsx'
import { useRiafStore } from '@/store/riaf.store'
import { useWorkspaceStore } from '@/store/workspace.store'
import type { RiafConfig } from '@shared'
import { DEFAULT_RIAF_CONFIG } from '@shared'

export function RiafPanel() {
  const { root } = useWorkspaceStore()
  const { runState, streamBuffer } = useRiafStore()
  const [config, setConfig] = useState<RiafConfig>(DEFAULT_RIAF_CONFIG)
  const streamRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [streamBuffer.length])

  const isRunning = runState.status === 'running'
  const isDone = runState.status === 'done'
  const isError = runState.status === 'error'

  const handleRun = async () => {
    if (!root) return
    await window.electronAPI.startRiaf(config)
  }

  const handleAbort = async () => {
    await window.electronAPI.abortRiaf()
  }

  const handleOpenOutput = async () => {
    if ('outputPath' in runState && runState.outputPath) {
      await window.electronAPI.openPath(runState.outputPath)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            RIAF Analysis
          </span>
          {isRunning ? (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-danger border border-danger/30 rounded hover:bg-danger/10 transition-colors font-mono"
            >
              <Square size={10} />
              Abort
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!root}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors font-mono disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap size={10} />
              Run
            </button>
          )}
        </div>

        {root ? (
          <p className="text-xs font-mono text-gray-500 mb-3 truncate" title={root}>
            Workspace: {root}
          </p>
        ) : (
          <p className="text-xs text-warn/80 mb-3">Open a workspace before running RIAF.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600">Output file</label>
            <input
              value={config.outputFileName}
              onChange={(e) => setConfig((c) => ({ ...c, outputFileName: e.target.value }))}
              className="bg-surface-3 border border-border rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-600">Max files</label>
            <input
              type="number"
              value={config.maxFiles}
              onChange={(e) => setConfig((c) => ({ ...c, maxFiles: Number(e.target.value) }))}
              className="bg-surface-3 border border-border rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-xs text-gray-600">Model</label>
            <input
              value={config.model}
              onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              className="bg-surface-3 border border-border rounded px-2 py-1 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="includeTests"
              checked={config.includeTests}
              onChange={(e) => setConfig((c) => ({ ...c, includeTests: e.target.checked }))}
              className="accent-accent"
            />
            <label htmlFor="includeTests" className="text-xs text-gray-500 cursor-pointer">
              Include test files
            </label>
          </div>
        </div>
      </div>

      {(isDone || isError) && (
        <div
          className={clsx(
            'mx-3 mt-2 px-3 py-2 rounded-md text-xs font-mono flex items-center justify-between shrink-0',
            isDone
              ? 'bg-accent-2/10 border border-accent-2/30 text-accent-2'
              : 'bg-danger/10 border border-danger/30 text-danger',
          )}
        >
          <span className="truncate">
            {isDone && 'outputPath' in runState && runState.outputPath}
            {isError && 'message' in runState && runState.message}
          </span>
          {isDone && (
            <button
              onClick={handleOpenOutput}
              className="ml-2 shrink-0 hover:opacity-70 transition-opacity"
              title="Open output file"
            >
              <FolderOpen size={12} />
            </button>
          )}
        </div>
      )}

      <div ref={streamRef} className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
        {streamBuffer.map((chunk, i) => {
          if (chunk.type === 'tool_use_start') {
            return (
              <div key={i} className="text-warn/70 my-1 font-mono">
                ▸ {chunk.toolName ?? chunk.content}
              </div>
            )
          }
          if (chunk.type === 'tool_result') {
            return (
              <div key={i} className="text-gray-600 my-0.5 font-mono">
                ◂ {chunk.content.length > 120 ? chunk.content.slice(0, 120) + '…' : chunk.content}
              </div>
            )
          }
          if (chunk.type === 'error') {
            return (
              <div key={i} className="text-danger">
                {chunk.content}
              </div>
            )
          }
          if (chunk.type === 'done') {
            return (
              <div key={i} className="text-accent-2 mt-2">
                ✓ Generation complete
              </div>
            )
          }
          return (
            <span key={i} className="text-gray-300">
              {chunk.content}
            </span>
          )
        })}

        {isRunning && streamBuffer.length === 0 && (
          <span className="text-gray-700 animate-pulse">Waiting for stream…</span>
        )}
      </div>
    </div>
  )
}
