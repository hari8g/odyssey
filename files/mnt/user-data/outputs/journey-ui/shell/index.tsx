/**
 * shell/index.tsx
 * App shell: TopBar + JourneyBar, LeftRail, role selector.
 * Wraps all screens. Replaces App.tsx composition.
 */
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { VerbPill, Badge } from '../design/primitives'
import { VERB_COLOR, type VerbKey } from '../design/tokens'
import { useUXStore } from '../store/ux/ux.store'
import { useCycleStore } from '../store/cycle/cycle.store'

// ── Role types ────────────────────────────────────────────────────────────────
export type Role = 'executive' | 'product' | 'engineering' | 'compliance' | 'gtm' | 'support'
const ROLES: { id: Role; label: string; icon: string }[] = [
  { id: 'executive',   label: 'Executive',    icon: '◈' },
  { id: 'product',     label: 'Product',      icon: '◇' },
  { id: 'engineering', label: 'Engineering',  icon: '⬡' },
  { id: 'compliance',  label: 'Compliance',   icon: '⊕' },
  { id: 'gtm',         label: 'GTM',          icon: '◉' },
  { id: 'support',     label: 'Support',      icon: '◎' },
]

// ── Verb → room map ───────────────────────────────────────────────────────────
const VERB_ROOMS: { verb: VerbKey; rooms: { id: string; label: string; route: string }[] }[] = [
  { verb: 'LISTEN', rooms: [{ id: 'signals', label: 'Customer Signals', route: '/room/signals' }] },
  { verb: 'DECIDE', rooms: [
    { id: 'bizvalue',   label: 'Business Value', route: '/room/bizvalue' },
    { id: 'valuestream',label: 'Value Stream',   route: '/room/valuestream' },
  ]},
  { verb: 'DEFINE', rooms: [
    { id: 'domain',   label: 'Domain',     route: '/room/domain' },
    { id: 'features', label: 'Features',   route: '/room/features' },
    { id: 'po',       label: 'PO Tools',   route: '/room/po' },
  ]},
  { verb: 'BUILD', rooms: [
    { id: 'search',  label: 'Search',    route: '/room/search' },
    { id: 'ucg',     label: 'Graph',     route: '/room/ucg' },
    { id: 'riaf',    label: 'RIAF',      route: '/room/riaf' },
    { id: 'impact',  label: 'Impact',    route: '/room/impact' },
  ]},
  { verb: 'SHIP',  rooms: [{ id: 'release', label: 'Release', route: '/room/release' }] },
  { verb: 'LEARN', rooms: [{ id: 'learn', label: 'Learn Hub', route: '/room/learn' }] },
]

// ═════════════════════════════════════════════════════════════════════════════
// ROLE SELECTOR
// ═════════════════════════════════════════════════════════════════════════════
function RoleSelector() {
  const [open, setOpen] = useState(false)
  const { role, setRole } = useUXStore()
  const current = ROLES.find(r => r.id === role)!
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink-1 px-3 py-1.5 rounded-[8px] hover:bg-surface-3 transition-colors">
        <span>{current.icon}</span><span>{current.label}</span><span className="text-ink-3">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 bg-surface-2 border border-line rounded-[10px] shadow-pop py-1 min-w-[160px]">
            {ROLES.map(r => (
              <button key={r.id} onClick={() => { setRole(r.id); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-surface-3 transition-colors ${r.id === role ? 'text-ink-1 font-[500]' : 'text-ink-2'}`}>
                <span>{r.icon}</span><span>{r.label}</span>
                {r.id === role && <span className="ml-auto text-accent text-[10px]">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// JOURNEY BAR  (six verb pills, live counts)
// ═════════════════════════════════════════════════════════════════════════════
function JourneyBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { board } = useUXStore()
  const verbs: VerbKey[] = ['LISTEN','DECIDE','DEFINE','BUILD','SHIP','LEARN']

  const counts: Record<VerbKey, number> = { LISTEN: 0, DECIDE: 0, DEFINE: 0, BUILD: 0, SHIP: 0, LEARN: 0 }
  const needs: Record<VerbKey, boolean> = { LISTEN: false, DECIDE: false, DEFINE: false, BUILD: false, SHIP: false, LEARN: false }
  board.forEach(item => {
    counts[item.verb as VerbKey]++
    if (item.needsHuman) needs[item.verb as VerbKey] = true
  })
  // LISTEN always shows raw signal/problem counts
  const { signalCount, painPointCount } = useUXStore()
  counts.LISTEN = painPointCount

  return (
    <div className="flex items-center gap-1">
      {verbs.map(verb => (
        <VerbPill key={verb}
          verb={verb}
          count={counts[verb]}
          needsAttention={needs[verb]}
          active={location.pathname.includes(verb.toLowerCase())}
          onClick={() => navigate(`/journey?verb=${verb}`)}
        />
      ))}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TOP BAR
// ═════════════════════════════════════════════════════════════════════════════
function TopBar({ workspace }: { workspace: string }) {
  const { actionCount } = useUXStore()
  const navigate = useNavigate()
  return (
    <header className="h-12 flex items-center gap-4 px-4 border-b border-line bg-surface-1 flex-shrink-0 z-30">
      {/* Workspace */}
      <button className="text-[13px] font-[500] text-ink-2 hover:text-ink-1 flex items-center gap-1">
        {workspace} <span className="text-ink-3">▾</span>
      </button>
      <div className="w-px h-4 bg-line" />
      {/* Journey bar */}
      <JourneyBar />
      <div className="flex-1" />
      {/* Action bell */}
      <button onClick={() => navigate('/actions')}
        className="relative text-[13px] text-ink-2 hover:text-ink-1 px-3 py-1.5 rounded-[8px] hover:bg-surface-3 transition-colors">
        Actions
        {actionCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-warn text-canvas text-[9px] font-[700] flex items-center justify-center">
            {actionCount}
          </span>
        )}
      </button>
      <RoleSelector />
    </header>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// LEFT RAIL
// ═════════════════════════════════════════════════════════════════════════════
function LeftRail() {
  const [expanded, setExpanded] = useState<VerbKey | null>(null)
  const navigate = useNavigate()

  return (
    <nav className="w-52 border-r border-line bg-surface-1 flex flex-col overflow-y-auto flex-shrink-0">
      {/* Top nav */}
      <div className="p-2 flex flex-col gap-0.5">
        <RailLink to="/" label="Home" icon="⬛" />
        <RailLink to="/actions" label="Actions" icon="◈" />
        <RailLink to="/journey" label="Journey" icon="→" />
      </div>
      <div className="h-px bg-line mx-3 my-1" />
      {/* Verb groups */}
      <div className="p-2 flex flex-col gap-0.5 flex-1">
        {VERB_ROOMS.map(vr => (
          <div key={vr.verb}>
            <button onClick={() => setExpanded(e => e === vr.verb ? null : vr.verb)}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] text-[12px] font-[500] hover:bg-surface-3 transition-colors"
              style={{ color: VERB_COLOR[vr.verb].text }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: VERB_COLOR[vr.verb].full }} />
              {vr.verb[0] + vr.verb.slice(1).toLowerCase()}
              <span className="ml-auto text-ink-3 text-[10px]">{expanded === vr.verb ? '▾' : '›'}</span>
            </button>
            {expanded === vr.verb && (
              <div className="ml-4 mt-0.5 flex flex-col gap-0.5">
                {vr.rooms.map(room => (
                  <RailLink key={room.id} to={room.route} label={room.label} icon="" indent />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="h-px bg-line mx-3 my-1" />
      <div className="p-2">
        <RailLink to="/settings" label="Settings" icon="⊙" />
      </div>
    </nav>
  )
}

function RailLink({ to, label, icon, indent }: { to: string; label: string; icon: string; indent?: boolean }) {
  return (
    <NavLink to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-2 py-1.5 rounded-[6px] text-[12px] transition-colors
         ${indent ? 'pl-4' : ''}
         ${isActive ? 'bg-accent/10 text-accent font-[500]' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-3'}`
      }>
      {icon && <span className="text-[10px]">{icon}</span>}
      <span>{label}</span>
    </NavLink>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// APP SHELL  (the root layout)
// ═════════════════════════════════════════════════════════════════════════════
export function AppShell({ children, workspace = 'RIAF Studio' }: { children: ReactNode; workspace?: string }) {
  return (
    <div className="h-screen flex flex-col bg-canvas text-ink-1 overflow-hidden">
      <TopBar workspace={workspace} />
      <div className="flex flex-1 overflow-hidden">
        <LeftRail />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
