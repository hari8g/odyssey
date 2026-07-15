import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useISSStore } from '@/store/iss.store'
import { useUXStore } from '@/store/ux/ux.store'
import { useAepStore } from '@/store/aep.store'

type PaletteItem = {
  id: string
  label: string
  group: string
  route: string
}

const ROOMS: PaletteItem[] = [
  { id: 'home', label: 'Home', group: 'Rooms', route: '/' },
  { id: 'journey', label: 'Journey Canvas', group: 'Rooms', route: '/journey' },
  { id: 'actions', label: 'Actions Inbox', group: 'Rooms', route: '/actions' },
  { id: 'signals', label: 'Customer Signals', group: 'Rooms', route: '/room/signals' },
  { id: 'cycle', label: 'Cycle Runner', group: 'Rooms', route: '/room/cycle' },
  { id: 'features', label: 'Features', group: 'Rooms', route: '/room/features' },
  { id: 'domain', label: 'Domain Browser', group: 'Rooms', route: '/room/domain' },
  { id: 'learn', label: 'Learn Hub', group: 'Rooms', route: '/room/learn' },
  { id: 'impact', label: 'Impact Analysis', group: 'Rooms', route: '/room/impact' },
  { id: 'settings', label: 'Settings', group: 'Rooms', route: '/settings' },
]

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const features = useISSStore((s) => s.features)
  const painPoints = useUXStore((s) => s.painPoints)
  const kpis = useAepStore((s) => s.kpis)

  const items = useMemo(() => {
    const list: PaletteItem[] = [
      ...ROOMS,
      ...features.slice(0, 40).map((f) => ({
        id: `f-${f.id}`,
        label: f.label,
        group: 'Features',
        route: `/feature/${f.id}`,
      })),
      ...painPoints.slice(0, 40).map((p) => ({
        id: `pp-${p.id}`,
        label: p.label,
        group: 'Pain points',
        route: `/journey/new?ppId=${p.id}`,
      })),
      ...kpis.slice(0, 40).map((k) => ({
        id: `kpi-${k.id}`,
        label: k.label,
        group: 'KPIs',
        route: '/room/domain',
      })),
    ]
    const needle = q.trim().toLowerCase()
    if (!needle) return list.slice(0, 24)
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle),
    ).slice(0, 24)
  }, [features, painPoints, kpis, q])

  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] px-4">
      <button
        type="button"
        className="fixed inset-0 bg-black/60"
        aria-label="Close command palette"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg bg-surface-2 border border-line rounded-[12px] shadow-pop overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
          <Search size={14} className="text-ink-3 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rooms, features, pain points, KPIs…"
            className="flex-1 bg-transparent text-[13px] text-ink-1 outline-none placeholder:text-ink-3"
          />
          <kbd className="text-[10px] text-ink-3 border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-3 py-4 text-[12px] text-ink-3 text-center">No matches</li>
          )}
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-3 transition-colors"
                onClick={() => {
                  navigate(item.route)
                  onClose()
                }}
              >
                <span className="text-[10px] uppercase tracking-wide text-ink-3 w-20 shrink-0">
                  {item.group}
                </span>
                <span className="text-[13px] text-ink-1 truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const rows = [
    ['⌘/Ctrl + K', 'Command palette'],
    ['⌘/Ctrl + J', 'Journey Canvas'],
    ['⌘/Ctrl + I', 'Actions Inbox'],
    ['⌘/Ctrl + O', 'Open workspace'],
    ['⌘/Ctrl + R', 'Re-index workspace'],
    ['⌘/Ctrl + /', 'This shortcut list'],
  ]
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <button type="button" className="fixed inset-0 bg-black/60" aria-label="Close" onClick={onClose} />
      <div className="relative bg-surface-2 border border-line rounded-[12px] shadow-pop p-5 w-full max-w-sm">
        <h3 className="text-[15px] font-[600] text-ink-1 mb-3">Keyboard shortcuts</h3>
        <ul className="space-y-2">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-4 text-[13px]">
              <span className="text-ink-2">{v}</span>
              <kbd className="text-[11px] font-mono text-ink-3 border border-line rounded px-1.5 py-0.5 whitespace-nowrap">
                {k}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
