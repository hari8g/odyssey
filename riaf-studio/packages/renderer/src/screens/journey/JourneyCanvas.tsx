/**
 * screens/journey/JourneyCanvas.tsx
 * The org-wide living map — six verb columns, initiative cards flowing left→right.
 * Cards animate between columns on cycle:update push.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState, Button, useToast } from '@/design/primitives'
import { VERB_COLOR, type VerbKey } from '@/design/tokens'
import { DICT } from '@/design/dictionary'
import { STAGE_META } from '@/store/cycle.store'
import type { CycleStage } from '@shared/index'
import { useUXStore, type BoardItem, type PainPointRow } from '@/store/ux/ux.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

const VERBS: VerbKey[] = ['LISTEN', 'DECIDE', 'DEFINE', 'BUILD', 'SHIP', 'LEARN']

const VERB_ICON: Record<VerbKey, string> = {
  LISTEN: '👂', DECIDE: '⚖', DEFINE: '📖', BUILD: '🔨', SHIP: '🚀', LEARN: '↺',
}

type RichPainPoint = PainPointRow & { importance_score?: number; velocity?: number }

// ── Initiative Card ───────────────────────────────────────────────────────────
function InitiativeCard({ item, onClick }: { item: BoardItem; onClick: () => void }) {
  const isGate = item.status === 'waiting_gate'
  const isBounced = item.status === 'bounced' || item.status === 'halted'
  const isBetPaidOff = item.verb === 'LEARN' && item.status === 'completed'
  const stageTitle = item.stage ? STAGE_META[item.stage as CycleStage]?.title : undefined

  return (
    <div onClick={onClick}
      className="group cursor-pointer rounded-[10px] border bg-surface-3 hover:bg-surface-2 transition-all duration-300 overflow-hidden"
      style={{
        borderColor: isGate ? '#E8A13C60' : isBounced ? '#E25C5C60' : isBetPaidOff ? '#1D9E7560' : '#2A2D33',
        borderLeftWidth: isBounced || isBetPaidOff ? '3px' : '1px',
        borderLeftColor: isBounced ? '#E25C5C' : isBetPaidOff ? '#1D9E75' : undefined,
        boxShadow: isGate ? '0 0 0 3px #E8A13C22' : undefined,
      }}
    >
      <div className="px-3 py-2.5">
        {/* Title */}
        <p className="text-[12px] font-[500] text-ink-1 leading-snug line-clamp-2 mb-1.5">
          {item.title}
        </p>
        {/* Status line */}
        <p className="text-[11px] text-ink-3 leading-snug mb-1.5">
          {item.statusLine}
        </p>
        {/* Granular current-stage line (plain English, never a raw stage code) */}
        {stageTitle && item.status !== 'completed' && (
          <p className="text-[10px] text-ink-3/80 leading-snug mb-1">{stageTitle}</p>
        )}
        {/* Needs-a-decision line */}
        {item.needsHuman && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-warn text-[10px] font-[500]">⭐ Needs a decision</span>
          </div>
        )}
        {/* Gate seal miniature */}
        {isGate && item.requiredRoles && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-warn font-[500]">
              {item.signedRoles?.length ?? 0}/{item.requiredRoles.length} signed
            </span>
          </div>
        )}
        {/* Bet paid off */}
        {isBetPaidOff && (
          <p className="text-[10px] text-learn font-[500] mt-1">✓ Bet paid off</p>
        )}
        {/* Bets */}
        {item.betCount > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[10px] text-ink-3">{item.betCount} bet{item.betCount > 1 ? 's' : ''}</span>
          </div>
        )}
        {/* Days in stage */}
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-ink-3">{item.daysInStage}d in stage</span>
          {isBounced && <span className="text-[10px] text-danger font-[500]">↩ sent back</span>}
        </div>
      </div>
    </div>
  )
}

// ── Listen Column (special: shows problems, not initiative cards) ─────────────
function ListenColumn({ onStartInitiative }: { onStartInitiative: (pp?: RichPainPoint) => void }) {
  const { painPoints: storePainPoints, signalCount } = useUXStore()
  const [richPainPoints, setRichPainPoints] = useState<RichPainPoint[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void eAPI().aepGetPainPoints?.()?.then((res: unknown) => {
      if (!cancelled && Array.isArray(res)) setRichPainPoints(res as RichPainPoint[])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const painPoints: RichPainPoint[] = richPainPoints ?? storePainPoints
  void signalCount

  return (
    <div className="flex flex-col gap-2 h-full">
      {painPoints.length === 0 ? (
        <EmptyState verb="LISTEN"
          title="No customer voices yet"
          body="Ingest signals from Zendesk, NPS, or a CSV — problems will appear here."
          action={{ label: 'Ingest signals', onClick: () => onStartInitiative() }}
        />
      ) : painPoints.slice(0, 8).map(pp => (
        <div key={pp.id}
          className="group rounded-[10px] border border-line/60 bg-surface-3 hover:bg-surface-2 cursor-pointer transition-all duration-300 px-3 py-2.5"
          onClick={() => onStartInitiative(pp)}
        >
          <p className="text-[12px] font-[500] text-ink-1 line-clamp-2 mb-1">{pp.label}</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3">
              {pp.signal_count} voice{pp.signal_count === 1 ? '' : 's'}
              {typeof pp.velocity === 'number' && pp.velocity !== 0 && (
                <span className="ml-1.5 text-listen">
                  {pp.velocity > 0 ? '↑' : '↓'} {Math.abs(pp.velocity)} this week
                </span>
              )}
            </span>
            <span className="text-[10px] text-listen font-[500] opacity-0 group-hover:opacity-100 transition-opacity">
              Start initiative →
            </span>
          </div>
        </div>
      ))}
      <button onClick={() => onStartInitiative()}
        className="mt-2 w-full text-[11px] text-ink-3 hover:text-listen border border-dashed border-line hover:border-listen/40 rounded-[8px] py-2 transition-colors">
        + Start from scratch
      </button>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY CANVAS
// ═════════════════════════════════════════════════════════════════════════════
function cardRoute(item: BoardItem): string {
  if (item.status === 'waiting_gate' && item.stage) {
    return `/gate/${item.id}/${item.stage}`
  }
  return `/feature/${item.featureId ?? item.id}`
}

export function JourneyCanvas() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { push } = useToast()
  const [presentationMode, setPresentationMode] = useState(false)
  const [filterContext, setFilterContext] = useState<string>('all')
  const [fallbackContexts, setFallbackContexts] = useState<{ id: number; label: string }[]>([])
  const [starting, setStarting] = useState(false)
  const { board, contexts, painPoints, signalCount, refreshHome } = useUXStore()
  const activeVerb = params.get('verb') as VerbKey | null

  useEffect(() => {
    void refreshHome()
  }, [refreshHome])

  useEffect(() => {
    if (contexts.length > 0) return
    void eAPI().domainGetContexts?.()?.then((res: unknown) => {
      if (Array.isArray(res)) setFallbackContexts(res)
    })
  }, [contexts.length])

  const allContexts = contexts.length > 0 ? contexts : fallbackContexts

  const byVerb = (verb: VerbKey) => board.filter(i => i.verb === verb &&
    (filterContext === 'all' || i.contextLabel === filterContext))

  const boardIsEmpty = useMemo(() => board.length === 0 && painPoints.length === 0, [board, painPoints])

  async function onStartInitiative(pp?: RichPainPoint) {
    if (!pp) {
      navigate('/room/cycle')
      return
    }
    setStarting(true)
    try {
      const res = await eAPI().cycleStart?.({
        label: pp.label,
        mode: 'demo',
        painPointIds: [pp.id],
      })
      if (res?.error) throw new Error(res.error)
      navigate('/room/cycle')
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Could not start the cycle', status: 'danger' })
    } finally {
      setStarting(false)
    }
  }

  if (boardIsEmpty) {
    return (
      <div className="flex items-center justify-center h-full">
        <EmptyState verb="LISTEN"
          title="Nothing in flight yet"
          body="Start a value cycle to see initiatives flow through the journey."
          action={{ label: 'Start a cycle →', onClick: () => navigate('/room/cycle') }}
        />
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${presentationMode ? 'bg-canvas' : ''}`}
      style={presentationMode ? ({ zoom: 1.7 } as unknown as React.CSSProperties) : undefined}>
      {/* Controls bar */}
      {!presentationMode && (
        <div className="flex items-center gap-3 px-5 py-3 border-b border-line flex-shrink-0">
          <p className="text-[15px] font-[600] text-ink-1">Journey</p>
          <div className="flex-1" />
          {/* Context filter */}
          <select value={filterContext} onChange={e => setFilterContext(e.target.value)}
            className="bg-surface-3 border border-line rounded-[8px] px-3 py-1.5 text-[12px] text-ink-2 outline-none">
            <option value="all">All areas</option>
            {allContexts.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
          </select>
          <button onClick={() => setPresentationMode(true)}
            className="text-[12px] text-ink-3 hover:text-ink-1 px-3 py-1.5 rounded-[8px] hover:bg-surface-3 transition-colors">
            📺 Present
          </button>
          <Button variant="primary" loading={starting} onClick={() => navigate('/room/cycle')}
            className="text-[12px]">
            + New cycle
          </Button>
        </div>
      )}

      {/* Presentation mode exit */}
      {presentationMode && (
        <div className="fixed top-3 right-4 z-50">
          <button onClick={() => setPresentationMode(false)}
            className="text-[11px] text-ink-3 bg-surface-2 border border-line px-3 py-1 rounded-[999px]">
            Exit presentation
          </button>
        </div>
      )}

      {/* Canvas — horizontal scroll on narrow screens */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full min-w-[900px]">
          {VERBS.map((verb, vi) => {
            const col = VERB_COLOR[verb]
            const items = byVerb(verb)
            const needsHuman = items.some(i => i.needsHuman)
            const isActive = activeVerb === verb

            return (
              <div key={verb}
                className="flex flex-col flex-1 border-r border-line last:border-r-0 overflow-hidden transition-all duration-300"
                style={isActive ? { background: col.soft } : undefined}
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b border-line flex-shrink-0"
                  style={{ borderTop: `3px solid ${col.full}` }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{VERB_ICON[verb]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-[600]" style={{ color: col.text }}>
                        {DICT.stage[verb].title}
                      </p>
                      <p className="text-[10px] text-ink-3 truncate">{DICT.stage[verb].tag}</p>
                    </div>
                    {needsHuman && (
                      <span className="w-2 h-2 rounded-full bg-warn flex-shrink-0" />
                    )}
                  </div>
                  {/* Aggregate stat (live count) */}
                  <div className="mt-2 text-[11px] text-ink-3">
                    {verb === 'LISTEN'
                      ? `${signalCount} voices · ${painPoints.length} problems`
                      : `${items.length} initiative${items.length !== 1 ? 's' : ''}`}
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                  {verb === 'LISTEN'
                    ? <ListenColumn onStartInitiative={onStartInitiative} />
                    : items.length === 0
                    ? <div className="flex-1 flex items-center justify-center">
                        <p className="text-[11px] text-ink-3 text-center">
                          {vi === 0 ? 'Waiting for problems' : 'Nothing here yet'}
                        </p>
                      </div>
                    : items.map(item => (
                        <InitiativeCard key={item.id} item={item}
                          onClick={() => navigate(cardRoute(item))} />
                      ))
                  }
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
