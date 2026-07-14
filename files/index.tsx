/**
 * primitives/index.tsx
 * Every design primitive in one barrel export.
 * These are the only building blocks the UI screens should import.
 */
import { useState, useRef, useEffect, createContext, useContext } from 'react'
import type { ReactNode, HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { VERB_COLOR, STATUS_COLOR, type VerbKey, type StatusKey } from '../tokens'
import { DICT, t, hint } from '../dictionary'

// ── shared util ───────────────────────────────────────────────────────────────
const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ')

// ═════════════════════════════════════════════════════════════════════════════
// BUTTON
// ═════════════════════════════════════════════════════════════════════════════
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type BtnProps = {
  variant?: BtnVariant; loading?: boolean; icon?: ReactNode
  children: ReactNode; className?: string; disabled?: boolean
  onClick?: () => void; type?: 'button' | 'submit'
}
const BTN_BASE = 'inline-flex items-center gap-2 rounded-[8px] text-[13px] font-[500] transition-colors duration-150 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_V: Record<BtnVariant, string> = {
  primary:   'bg-accent hover:bg-accent-hover text-white px-4 py-2',
  secondary: 'bg-surface-3 hover:bg-surface-2 text-ink-1 border border-line px-4 py-2',
  ghost:     'text-ink-2 hover:text-ink-1 hover:bg-surface-2 px-3 py-1.5',
  danger:    'bg-danger/10 hover:bg-danger/20 text-danger border border-danger/40 px-4 py-2',
}
export function Button({ variant = 'primary', loading, icon, children, className, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={cx(BTN_BASE, BTN_V[variant], className)}>
      {loading ? <span className="animate-spin text-sm">⟳</span> : icon}
      {children}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// CARD
// ═════════════════════════════════════════════════════════════════════════════
type CardProps = { verb?: VerbKey; status?: StatusKey; children: ReactNode; className?: string; onClick?: () => void }
export function Card({ verb, status, children, className, onClick }: CardProps) {
  const topColor = verb ? VERB_COLOR[verb].full
                 : status && status !== 'neutral' ? STATUS_COLOR[status].border
                 : undefined
  return (
    <div onClick={onClick}
      className={cx(
        'bg-surface-2 rounded-[12px] border border-line',
        onClick && 'cursor-pointer hover:border-line-strong transition-colors duration-150',
        className,
      )}
      style={topColor ? { borderTop: `3px solid ${topColor}` } : undefined}
    >
      {children}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// STAT TILE  (always a button — E3)
// ═════════════════════════════════════════════════════════════════════════════
type StatTileProps = {
  label: string; value: string | number; delta?: { dir: 'up' | 'down' | 'neutral'; label: string }
  sub?: string; onClick?: () => void; className?: string; accent?: string
}
export function StatTile({ label, value, delta, sub, onClick, className, accent }: StatTileProps) {
  const deltaColor = !delta ? '' : delta.dir === 'up' ? 'text-ok' : delta.dir === 'down' ? 'text-danger' : 'text-ink-3'
  const deltaIcon  = !delta ? '' : delta.dir === 'up' ? '↑' : delta.dir === 'down' ? '↓' : '→'
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cx('flex flex-col gap-1 p-4 bg-surface-2 rounded-[12px] border border-line text-left w-full transition-colors duration-150', onClick && 'hover:border-line-strong', className)}
    >
      <span className="text-[11px] font-[500] text-ink-3 uppercase tracking-wide">{label}</span>
      <span className="text-[22px] font-[600] text-ink-1" style={accent ? { color: accent } : undefined}>{value}</span>
      {delta && <span className={cx('text-[11px] font-[500]', deltaColor)}>{deltaIcon} {delta.label}</span>}
      {sub && <span className="text-[11px] text-ink-3">{sub}</span>}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// BADGE
// ═════════════════════════════════════════════════════════════════════════════
type BadgeProps = { variant?: StatusKey | 'verb'; verb?: VerbKey; dot?: boolean; children: ReactNode; className?: string }
export function Badge({ variant = 'neutral', verb, dot, children, className }: BadgeProps) {
  const col = verb ? { bg: VERB_COLOR[verb].soft, border: VERB_COLOR[verb].full + '60', text: VERB_COLOR[verb].text }
                   : STATUS_COLOR[variant as StatusKey] ?? STATUS_COLOR.neutral
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[11px] font-[500] px-2 py-0.5 rounded-[999px] border', className)}
      style={{ background: col.bg, borderColor: col.border, color: col.text }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.text }} />}
      {children}
    </span>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TERM  (plain-language wrapper — E2, enforced by eslint rule)
// ═════════════════════════════════════════════════════════════════════════════
type TermProps = { kind: string; className?: string }
export function Term({ kind, className }: TermProps) {
  const human = t(kind)
  const hintText = hint(kind)
  return (
    <span title={hintText} className={cx('border-b border-dashed border-ink-3/40 cursor-help', className)}>{human}</span>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EVIDENCE CHIP  (entity chip — always opens Peek or routes)
// ═════════════════════════════════════════════════════════════════════════════
type EvidenceChipProps = { kind: string; label: string; count?: number; onClick: () => void }
export function EvidenceChip({ kind, label, count, onClick }: EvidenceChipProps) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-[500] px-2.5 py-1 rounded-[6px] bg-surface-3 border border-line hover:border-line-strong text-ink-2 hover:text-ink-1 transition-colors duration-150"
    >
      <span className="text-ink-3 text-[10px]">{t(kind)}</span>
      <span className="text-ink-1">{label}</span>
      {count !== undefined && <span className="text-ink-3">·{count}</span>}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// PEEK  (right-side drawer, 420 px)
// ═════════════════════════════════════════════════════════════════════════════
type PeekCtx = { open: (content: ReactNode, title: string) => void; close: () => void }
const PeekContext = createContext<PeekCtx>({ open: () => {}, close: () => {} })
export function usePeek() { return useContext(PeekContext) }

export function PeekProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; title: string; content: ReactNode }>
    ({ open: false, title: '', content: null })
  const open = (content: ReactNode, title: string) => setState({ open: true, title, content })
  const close = () => setState(s => ({ ...s, open: false }))
  return (
    <PeekContext.Provider value={{ open, close }}>
      {children}
      {/* Drawer */}
      <div className={cx(
        'fixed top-0 right-0 h-full w-[420px] bg-surface-1 border-l border-line shadow-pop z-50 flex flex-col transition-transform duration-200',
        state.open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <span className="text-[15px] font-[600] text-ink-1">{state.title}</span>
          <button onClick={close} className="text-ink-3 hover:text-ink-1 text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{state.content}</div>
      </div>
      {state.open && <div className="fixed inset-0 z-40" onClick={close} />}
    </PeekContext.Provider>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// DATA TABLE
// ═════════════════════════════════════════════════════════════════════════════
type Col<T> = { key: keyof T; header: string; width?: string; render?: (v: T) => ReactNode }
type DataTableProps<T> = { cols: Col<T>[]; rows: T[]; onRow?: (row: T) => void; emptyText?: string }
export function DataTable<T extends { id: number | string }>({ cols, rows, onRow, emptyText }: DataTableProps<T>) {
  return (
    <div className="overflow-auto rounded-[8px] border border-line">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-3">
            {cols.map(c => (
              <th key={String(c.key)} style={{ width: c.width }}
                className="text-left px-3 py-2.5 text-[11px] font-[600] text-ink-3 uppercase tracking-wide whitespace-nowrap">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-ink-3">{emptyText ?? 'No items'}</td></tr>
          ) : rows.map(row => (
            <tr key={row.id} onClick={onRow ? () => onRow(row) : undefined}
              className={cx('border-b border-line/60 last:border-0', onRow && 'cursor-pointer hover:bg-surface-3 transition-colors duration-150')}>
              {cols.map(c => (
                <td key={String(c.key)} className="px-3 py-2.5 text-ink-2">
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TIMELINE
// ═════════════════════════════════════════════════════════════════════════════
type TlItem = { id: number | string; icon?: string; title: string; detail?: string; ts: number; status?: StatusKey }
export function Timeline({ items }: { items: TlItem[] }) {
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-line" />
      <div className="flex flex-col gap-5">
        {items.map(item => (
          <div key={item.id} className="relative">
            <div className={cx(
              'absolute -left-6 top-0 w-4 h-4 rounded-full border flex items-center justify-center text-[9px]',
              item.status ? `bg-${item.status === 'ok' ? 'ok' : item.status === 'warn' ? 'warn' : 'danger'}-dark border-${item.status}` : 'bg-surface-3 border-line',
            )}>
              {item.icon ?? (item.status === 'ok' ? '✓' : '•')}
            </div>
            <div>
              <p className="text-[13px] font-[500] text-ink-1">{item.title}</p>
              {item.detail && <p className="text-[11px] text-ink-3 mt-0.5">{item.detail}</p>}
              <p className="text-[11px] text-ink-3 mt-1">{new Date(item.ts).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// PROGRESS RIBBON
// ═════════════════════════════════════════════════════════════════════════════
export function ProgressRibbon({ label, pct, verb }: { label: string; pct: number | null; verb?: VerbKey }) {
  const color = verb ? VERB_COLOR[verb].full : '#6E5BFF'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[11px] text-ink-3">
        <span>{label}</span>
        {pct !== null && <span>{pct}%</span>}
      </div>
      <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
        {pct === null
          ? <div className="h-full w-full animate-pulse" style={{ background: color + '60' }} />
          : <div className="h-full rounded-full transition-all duration-[250ms]" style={{ width: `${pct}%`, background: color }} />
        }
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// GATE SEAL
// ═════════════════════════════════════════════════════════════════════════════
export function GateSeal({ required, signed }: { required: string[]; signed: string[] }) {
  const all = required.length > 0 && required.every(r => signed.includes(r))
  return (
    <div className={cx(
      'inline-flex items-center gap-3 px-4 py-3 rounded-[10px] border',
      all ? 'border-ok/40 bg-ok/10' : 'border-warn/40 bg-warn/10',
    )} style={all ? {} : { boxShadow: '0 0 0 3px #E8A13C22' }}>
      <span className="text-lg">{all ? '★' : '★'}</span>
      <div className="flex flex-col gap-1">
        {required.map(role => (
          <div key={role} className="flex items-center gap-2 text-[12px]">
            <span className={cx('w-3 h-3 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px]',
              signed.includes(role) ? 'bg-ok border-ok text-white' : 'border-warn bg-warn/10 text-warn')}>
              {signed.includes(role) ? '✓' : ''}
            </span>
            <span className={signed.includes(role) ? 'text-ink-3 line-through' : 'text-warn font-[500]'}>{role}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// VERB PILL  (Journey Bar unit)
// ═════════════════════════════════════════════════════════════════════════════
export function VerbPill({
  verb, count, needsAttention, active, onClick,
}: { verb: VerbKey; count: number; needsAttention: boolean; active: boolean; onClick: () => void }) {
  const col = VERB_COLOR[verb]
  const label = verb[0] + verb.slice(1).toLowerCase()
  return (
    <button onClick={onClick}
      className={cx(
        'relative inline-flex items-center gap-2 px-3 py-1.5 rounded-[999px] text-[12px] font-[500] transition-all duration-150 border',
        active ? 'border-current' : 'border-transparent hover:bg-surface-3',
      )}
      style={active ? { color: col.text, background: col.soft } : { color: col.text }}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.full }} />
      {label}
      <span className="text-[11px] opacity-70">{count}</span>
      {needsAttention && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-warn border-2 border-canvas" />
      )}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ═════════════════════════════════════════════════════════════════════════════
type EmptyStateProps = { verb?: VerbKey; title: string; body: string; action?: { label: string; onClick: () => void } }
export function EmptyState({ verb, title, body, action }: EmptyStateProps) {
  const col = verb ? VERB_COLOR[verb] : undefined
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center gap-4">
      {verb && (
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl"
          style={{ background: col!.soft }}>
          {{ LISTEN:'👂', DECIDE:'⚖', DEFINE:'📖', BUILD:'🔨', SHIP:'🚀', LEARN:'↺' }[verb]}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-[600] text-ink-1">{title}</p>
        <p className="text-[13px] text-ink-3 max-w-xs">{body}</p>
      </div>
      {action && <Button variant="secondary" onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// SPARKLINE  (90-day inline trend, SVG, no chart lib)
// ═════════════════════════════════════════════════════════════════════════════
export function Sparkline({ values, color = '#6E5BFF', width = 80, height = 24 }: {
  values: number[]; color?: string; width?: number; height?: number
}) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"
        strokeLinejoin="round" points={pts} />
      <circle cx={pts.split(' ').at(-1)!.split(',')[0]} cy={pts.split(' ').at(-1)!.split(',')[1]}
        r="2.5" fill={color} />
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIRM DIALOG  (destructive + gate actions)
// ═════════════════════════════════════════════════════════════════════════════
type ConfirmProps = {
  open: boolean; title: string; body: string; confirmLabel: string
  requireTyped?: string; onConfirm: (reason?: string) => void; onCancel: () => void
  variant?: 'danger' | 'warn'
}
export function ConfirmDialog({ open, title, body, confirmLabel, requireTyped, onConfirm, onCancel, variant = 'danger' }: ConfirmProps) {
  const [typed, setTyped] = useState('')
  const ready = !requireTyped || typed.trim().length >= 10
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-surface-2 rounded-[12px] border border-line shadow-pop w-full max-w-sm p-6 flex flex-col gap-4">
        <p className="text-[15px] font-[600] text-ink-1">{title}</p>
        <p className="text-[13px] text-ink-2">{body}</p>
        {requireTyped && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-ink-3 uppercase tracking-wide">Reason (required, recorded)</label>
            <textarea value={typed} onChange={e => setTyped(e.target.value)} rows={3}
              className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none" />
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} disabled={!ready}
            onClick={() => onConfirm(typed || undefined)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TOAST  (transient notification)
// ═════════════════════════════════════════════════════════════════════════════
type ToastItem = { id: string; message: string; status?: StatusKey }
const ToastCtx = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void }>({ push: () => {} })
export function useToast() { return useContext(ToastCtx) }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = (t: Omit<ToastItem, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setItems(prev => [...prev, { ...t, id }])
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), 4000)
  }
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 min-w-[260px]">
        {items.map(item => {
          const col = STATUS_COLOR[item.status ?? 'info']
          return (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-[10px] border shadow-raise text-[13px] animate-in fade-in slide-in-from-bottom-2"
              style={{ background: col.bg, borderColor: col.border, color: col.text }}>
              <span>{col.icon}</span>
              <span className="flex-1">{item.message}</span>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}
