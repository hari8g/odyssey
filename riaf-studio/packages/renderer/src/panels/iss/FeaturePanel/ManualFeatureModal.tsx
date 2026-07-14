import { useState } from 'react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'
import type { FeatureSummary } from '@shared'
import type { SDLCPhase } from '@shared/db.types'

const INPUT =
  'bg-surface-3 border border-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors w-full'

const SDLC_PHASES: SDLCPhase[] = [
  'requirements',
  'design',
  'implementation',
  'testing',
  'deployment',
  'maintenance',
]

type Props = {
  open: boolean
  feature?: FeatureSummary | null
  onClose: () => void
  onSaved: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

export function ManualFeatureModal({ open, feature, onClose, onSaved }: Props) {
  const [label, setLabel] = useState(feature?.label ?? '')
  const [description, setDescription] = useState(feature?.description ?? '')
  const [sdlcPhase, setSdlcPhase] = useState<SDLCPhase>(
    (feature?.sdlcPhase as SDLCPhase) ?? 'requirements',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const isEdit = feature != null

  const handleSave = async () => {
    if (!label.trim()) {
      setError('Label is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        await eAPI.featureUpdate({ id: feature.id, label: label.trim(), description, sdlcPhase })
      } else {
        await eAPI.featureCreate({ label: label.trim(), description, sdlcPhase })
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-2 border border-border rounded-lg p-4 w-96 flex flex-col gap-3 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            {isEdit ? 'Edit Feature' : 'Add Feature'}
          </span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={INPUT}
            placeholder="Feature label…"
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={clsx(INPUT, 'resize-none h-20')}
            placeholder="Optional description…"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">SDLC Phase</label>
          <select
            value={sdlcPhase}
            onChange={(e) => setSdlcPhase(e.target.value as SDLCPhase)}
            className={INPUT}
          >
            {SDLC_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-danger font-mono">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={clsx(
              'px-3 py-1.5 text-xs font-mono rounded border transition-colors',
              saving
                ? 'bg-surface-3 border-border text-gray-600'
                : 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20',
            )}
          >
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
