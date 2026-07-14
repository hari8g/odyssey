import { useState } from 'react'
import { X, Eye, Upload } from 'lucide-react'
import { clsx } from 'clsx'
import type { ImportFormat, ImportPreviewResult } from '@shared'

const INPUT =
  'bg-surface-3 border border-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors w-full'

const FORMATS: ImportFormat[] = ['text', 'csv', 'json', 'yaml']

type Props = {
  open: boolean
  onClose: () => void
  onImported: () => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

export function ImportFeaturesDialog({ open, onClose, onImported }: Props) {
  const [format, setFormat] = useState<ImportFormat>('text')
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handlePreview = async () => {
    if (!raw.trim()) return
    setPreviewing(true)
    setError(null)
    setPreview(null)
    try {
      const result = await eAPI.featureImportPreview({ raw, format })
      setPreview(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewing(false)
    }
  }

  const handleImport = async () => {
    if (!raw.trim()) return
    setImporting(true)
    setError(null)
    try {
      await eAPI.featureImport({ raw, format })
      onImported()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    setRaw('')
    setPreview(null)
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-2 border border-border rounded-lg p-4 w-[520px] flex flex-col gap-3 shadow-xl max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Import Features
          </span>
          <button onClick={handleClose} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-1 shrink-0">
          {FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFormat(f)
                setPreview(null)
              }}
              className={clsx(
                'px-2.5 py-1 text-xs font-mono rounded border transition-colors',
                format === f
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-surface-3 border-border text-gray-500 hover:text-gray-200',
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <textarea
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value)
            setPreview(null)
          }}
          className={clsx(INPUT, 'resize-none h-32')}
          placeholder={
            format === 'text'
              ? 'One feature per line…'
              : format === 'csv'
                ? 'label,description,sdlc_phase\n…'
                : format === 'json'
                  ? '[{"label":"…","description":"…","sdlcPhase":"requirements"}]'
                  : '- label: …\n  description: …\n  sdlcPhase: requirements'
          }
        />

        {preview && (
          <div className="flex flex-col gap-1.5 overflow-y-auto max-h-48 shrink">
            <div className="flex items-center gap-3 text-xs shrink-0">
              <span className="text-gray-500">
                Total: <span className="text-gray-300 font-mono">{preview.total}</span>
              </span>
              <span className="text-accent-2">
                Valid: <span className="font-mono">{preview.valid}</span>
              </span>
              {preview.invalid > 0 && (
                <span className="text-danger">
                  Invalid: <span className="font-mono">{preview.invalid}</span>
                </span>
              )}
              {preview.duplicates > 0 && (
                <span className="text-warn">
                  Dupes: <span className="font-mono">{preview.duplicates}</span>
                </span>
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              {preview.items.slice(0, 30).map((item, i) => (
                <div
                  key={i}
                  className={clsx(
                    'flex items-start gap-2 text-xs py-0.5 font-mono',
                    item.valid ? 'text-gray-400' : 'text-danger',
                  )}
                >
                  <span className="shrink-0 w-4">{item.valid ? '✓' : '✗'}</span>
                  <span className="truncate">{item.label}</span>
                  {item.error && <span className="text-danger/70 text-xs shrink-0">{item.error}</span>}
                </div>
              ))}
              {preview.items.length > 30 && (
                <span className="text-xs text-gray-600 font-mono">
                  …and {preview.items.length - 30} more
                </span>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-danger font-mono shrink-0">{error}</p>}

        <div className="flex justify-end gap-2 pt-1 shrink-0">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePreview}
            disabled={previewing || !raw.trim()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors',
              previewing || !raw.trim()
                ? 'bg-surface-3 border-border text-gray-600'
                : 'bg-surface-3 border-border text-gray-400 hover:text-gray-200',
            )}
          >
            <Eye size={11} />
            {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !raw.trim()}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors',
              importing || !raw.trim()
                ? 'bg-surface-3 border-border text-gray-600'
                : 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20',
            )}
          >
            <Upload size={11} />
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
