/**
 * screens/journey/JourneyCanvas.tsx
 * The org-wide living map — six verb columns, initiative cards flowing left→right.
 * Cards animate between columns on cycle:update push.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/design/primitives'
import { VERB_COLOR, type VerbKey } from '@/design/tokens'
import { DICT } from '@/design/dictionary'
import { useUXStore, type BoardItem } from '@/store/ux/ux.store'

const VERBS: VerbKey[] = ['LISTEN', 'DECIDE', 'DEFINE', 'BUILD', 'SHIP', 'LEARN']

const VERB_META: Record<VerbKey, { tag: string; icon: string }> = {
  LISTEN: { tag: 'Hear the customer', icon: '👂' },
  DECIDE: { tag: 'Place the bet',      icon: '⚖' },
  DEFINE: { tag: 'Agree what it means',icon: '📖' },
  BUILD:  { tag: 'Make it real',        icon: '🔨' },
  SHIP:   { tag: 'Release with eyes open', icon: '🚀' },
  LEARN:  { tag: 'Judge the bet',       icon: '↺' },
}

// ── Initiative Card ───────────────────────────────────────────────────────────
function InitiativeCard({ item, onClick }: { item: BoardItem; onClick: () => void }) {
  const col = VERB_COLOR[item.verb as VerbKey]
  const isGate = item.status === 'waiting_gate'
  const isBounced = item.status === 'bounced' || item.status === 'halted'

  return (
    <div onClick={onClick}
      className="group cursor-pointer rounded-[10px] border bg-surface-3 hover:bg-surface-2 transition-all duration-200 overflow-hidden"
      style={{
        borderColor: isGate ? '#E8A13C60' : isBounced ? '#E25C5C60' : '#2A2D33',
        borderLeftWidth: isBounced ? '3px' : '1px',
        borderLeftColor: isBounced ? '#E25C5C' : undefined,
        boxShadow: isGate ? '0 0 0 3px #E8A13C22' : undefined,
      }}
    >
      <div className="px-3 py-2.5">
        {/* Title */}
        <p className="text-[12px] font-[500] text-ink-1 leading-snug line-clamp-2 mb-1.5">
          {item.title}
        </p>
        {/* Status line */}
        <p className="text-[11px] text-ink-3 leading-snug mb-2">
          {item.statusLine}
        </p>
        {/* Gate seal miniature */}
        {isGate && item.requiredRoles && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-warn text-[10px]">★</span>
            <span className="text-[10px] text-warn font-[500]">
              {item.signedRoles?.length ?? 0}/{item.requiredRoles.length} signed
            </span>
          </div>
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
function ListenColumn({ onStartInitiative }: { onStartInitiative: (ppId?: number) => void }) {
  const { painPoints, signalCount } = useUXStore()
  const col = VERB_COLOR.LISTEN

  return (
    <div className="flex flex-col gap-2 h-full">
      {painPoints.length === 0 ? (
        <EmptyState verb="LISTEN"
          title="No customer voices yet"
          body="Ingest signals from Zendesk, NPS, or a CSV — problems will appear here."
          action={{ label: 'Ingest signals', onClick: () => onStartInitiative() }}
        />
      ) : painPoints.slice(0, 6).map(pp => (
        <div key={pp.id}
          className="rounded-[10px] border border-line/60 bg-surface-3 hover:bg-surface-2 cursor-pointer transition-colors px-3 py-2.5"
          onClick={() => onStartInitiative(pp.id)}
        >
          <p className="text-[12px] font-[500] text-ink-1 line-clamp-2 mb-1">{pp.label}</p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-3">{pp.signal_count} voices</span>
            <span className="text-[10px] text-listen font-[500] opacity-0 group-hover:opacity-100 transition-opacity">
              Start initiative →
            </span>
          </div>
        </div>
      ))}
      <button onClick={() => onStartInitiative()}
        className="mt-2 w-full text-[11px] text-ink-3 hover:text-listen border border-dashed border-line hover:border-listen/40 rounded-[8px] py-2 transition-colors">
        + Start from a problem
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
  if (item.featureId) return `/feature/${item.featureId}`
  return `/room/cycle`
}

export function JourneyCanvas() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [presentationMode, setPresentationMode] = useState(false)
  const [filterContext, setFilterContext] = useState<string>('all')
  const { board, contexts, painPoints, signalCount, refreshHome } = useUXStore()
  const activeVerb = params.get('verb') as VerbKey | null

  useEffect(() => {
    void refreshHome()
  }, [refreshHome])

  const byVerb = (verb: VerbKey) => board.filter(i => i.verb === verb &&
    (filterContext === 'all' || i.contextLabel === filterContext))

  function onStartInitiative(ppId?: number) {
    navigate(`/journey/new${ppId ? `?ppId=${ppId}` : ''}`)
  }

  return (
    <div className={`flex flex-col h-full ${presentationMode ? 'bg-canvas' : ''}`}>
      {/* Controls bar */}
      {!presentationMode && (
        <div className="flex items-center gap-3 px-5 py-3 border-b border-line flex-shrink-0">
          <p className="text-[15px] font-[600] text-ink-1">Journey</p>
          <div className="flex-1" />
          {/* Context filter */}
          <select value={filterContext} onChange={e => setFilterContext(e.target.value)}
            className="bg-surface-3 border border-line rounded-[8px] px-3 py-1.5 text-[12px] text-ink-2 outline-none">
            <option value="all">All areas</option>
            {contexts.map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
          </select>
          <button onClick={() => setPresentationMode(true)}
            className="text-[12px] text-ink-3 hover:text-ink-1 px-3 py-1.5 rounded-[8px] hover:bg-surface-3 transition-colors">
            📺 Present
          </button>
          <button onClick={() => navigate('/journey/new')}
            className="text-[12px] bg-accent hover:bg-accent-hover text-white px-4 py-1.5 rounded-[8px] transition-colors font-[500]">
            + New cycle
          </button>
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
            const meta = VERB_META[verb]
            const items = byVerb(verb)
            const needsHuman = items.some(i => i.needsHuman)
            const isActive = activeVerb === verb

            return (
              <div key={verb}
                className="flex flex-col flex-1 border-r border-line last:border-r-0 overflow-hidden"
                style={isActive ? { background: col.soft } : undefined}
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b border-line flex-shrink-0"
                  style={{ borderTop: `3px solid ${col.full}` }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-[600]" style={{ color: col.text }}>
                        {DICT.stage[verb].title}
                      </p>
                      <p className="text-[10px] text-ink-3 truncate">{meta.tag}</p>
                    </div>
                    {needsHuman && (
                      <span className="w-2 h-2 rounded-full bg-warn flex-shrink-0" />
                    )}
                  </div>
                  {/* Aggregate stat */}
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
