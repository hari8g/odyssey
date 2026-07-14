import { type MouseEvent, useState } from 'react'
import { FolderOpen, Clock, Cpu, FileCode, RefreshCw, X, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace.store'

type Props = {
  onWorkspaceOpened: (dir: string) => void
}

export function WorkspacePanel({ onWorkspaceOpened }: Props) {
  const { root, profile, recentWorkspaces, setRecentWorkspaces } = useWorkspaceStore()
  const [openError, setOpenError] = useState<string | null>(null)

  const handleOpen = async () => {
    setOpenError(null)
    const result = await window.electronAPI.openWorkspace()
    if ('root' in result) {
      onWorkspaceOpened(result.root)
    } else if ('error' in result) {
      setOpenError(result.error)
    }
  }

  const handleReopenReplace = async () => {
    if (!root) return
    setOpenError(null)
    const result = await window.electronAPI.reopenWorkspace({
      dir: root,
      replaceIndex: true,
    })
    if ('root' in result) {
      onWorkspaceOpened(result.root)
    } else if ('error' in result) {
      setOpenError(result.error)
    }
  }

  const handleReopenWithPicker = async () => {
    setOpenError(null)
    const result = await window.electronAPI.reopenWorkspace({ replaceIndex: true })
    if ('root' in result) {
      onWorkspaceOpened(result.root)
    } else if ('error' in result) {
      setOpenError(result.error)
    }
  }

  const handleOpenRecent = async (dir: string) => {
    setOpenError(null)
    const result = await window.electronAPI.openWorkspace(dir)
    if ('root' in result) {
      onWorkspaceOpened(result.root)
    } else if ('error' in result) {
      setOpenError(result.error)
    }
  }

  const handleRemoveRecent = async (dir: string, e: MouseEvent) => {
    e.stopPropagation()
    const { recentWorkspaces: updated } = await window.electronAPI.removeRecentWorkspace(dir)
    setRecentWorkspaces(updated)
  }

  const handleClearRecent = async () => {
    const { recentWorkspaces: updated } = await window.electronAPI.clearRecentWorkspaces()
    setRecentWorkspaces(updated)
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Workspace
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleOpen}
          className="flex items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/30 text-accent text-xs rounded-md hover:bg-accent/20 transition-colors font-mono"
        >
          <FolderOpen size={13} />
          Open Repository
        </button>

        {root && (
          <>
            <button
              onClick={handleReopenReplace}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border text-gray-300 text-xs rounded-md hover:bg-surface-3 hover:text-gray-100 transition-colors font-mono"
              title="Wipe .riaf index and re-scan this repository"
            >
              <RefreshCw size={13} />
              Re-index Current Repository
            </button>
            <button
              onClick={handleReopenWithPicker}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border text-gray-400 text-xs rounded-md hover:bg-surface-3 hover:text-gray-200 transition-colors font-mono"
              title="Pick a folder (defaults to current) and replace its index"
            >
              <RefreshCw size={13} />
              Re-open & Replace Index…
            </button>
          </>
        )}
      </div>

      {openError && (
        <div className="text-xs text-danger font-mono bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
          {openError}
        </div>
      )}

      {root && !profile && (
        <div className="flex flex-col gap-2 bg-surface-2 rounded-lg p-3 border border-border">
          <div className="text-xs font-mono text-gray-300 break-all" title={root}>
            {root}
          </div>
          <p className="text-xs text-gray-500 font-mono">Indexing in progress…</p>
        </div>
      )}

      {root && profile && (
        <div className="flex flex-col gap-3 bg-surface-2 rounded-lg p-3 border border-border">
          <div className="text-xs font-mono text-gray-300 break-all" title={root}>
            {root}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {profile.languageStack.slice(0, 6).map((lang) => (
              <span
                key={lang}
                className="px-1.5 py-0.5 bg-surface-3 text-accent-2 text-xs font-mono rounded"
              >
                {lang}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <FileCode size={10} />
              Files
            </span>
            <span className="text-xs font-mono text-gray-300">
              {profile.fileCount.toLocaleString()}
            </span>
            <span className="text-xs text-gray-600 flex items-center gap-1">
              <Cpu size={10} />
              Lines
            </span>
            <span className="text-xs font-mono text-gray-300">
              {profile.totalLoc.toLocaleString()}
            </span>
          </div>

          {profile.frameworks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profile.frameworks.slice(0, 4).map((fw) => (
                <span
                  key={fw.name}
                  className="px-1.5 py-0.5 bg-surface-3 text-warn/80 text-xs font-mono rounded"
                >
                  {fw.name}
                </span>
              ))}
            </div>
          )}

          {profile.projectPurpose && (
            <p className="text-xs text-gray-500 leading-relaxed">{profile.projectPurpose}</p>
          )}

          {profile.architectureSummary && (
            <p className="text-xs text-gray-500 leading-relaxed border-t border-border pt-2">
              {profile.architectureSummary}
            </p>
          )}
        </div>
      )}

      {recentWorkspaces.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <Clock size={11} />
              <span>Recent Repositories</span>
            </div>
            <button
              onClick={handleClearRecent}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-danger transition-colors font-mono"
              title="Clear recent list"
            >
              <Trash2 size={10} />
              Clear all
            </button>
          </div>
          {recentWorkspaces.map((ws) => (
            <div key={ws} className="flex items-center gap-1 group">
              <button
                onClick={() => handleOpenRecent(ws)}
                className="flex-1 text-left text-xs font-mono text-gray-500 hover:text-gray-200 truncate px-2 py-1 rounded hover:bg-surface-3 transition-colors min-w-0"
                title={ws}
              >
                {ws.split('/').pop() ?? ws}
                <span className="text-gray-700 ml-1 text-xs">{ws.split('/').slice(-2, -1)[0]}</span>
              </button>
              <button
                onClick={(e) => handleRemoveRecent(ws, e)}
                className="shrink-0 p-1 text-gray-700 hover:text-danger opacity-0 group-hover:opacity-100 transition-all rounded"
                title="Remove from recent"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
