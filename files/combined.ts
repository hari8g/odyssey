/* ─────────────────────────────────────────────────────────────────────────────
   learn/LearnHub.tsx
   ───────────────────────────────────────────────────────────────────────────── */
import { useState, useEffect } from 'react'
import { Card, StatTile, Badge, Sparkline, EmptyState } from '../../design/primitives'
import { DICT } from '../../design/dictionary'

function VerdictCard({ v }: { v: any }) {
  const ok = v.validated
  const col = ok ? '#2FBF8F' : '#A9ADB6'
  const phrase = ok
    ? `The bet paid off — ${v.kpi} moved ${v.actualDelta?.toFixed(1) ?? '?'}%`
    : `The bet did not pay off — ${v.kpi} moved ${v.actualDelta?.toFixed(1) ?? '?'}%. That is a lesson, not a failure.`
  return (
    <div className="rounded-[10px] border bg-surface-3 p-4" style={{ borderLeftWidth: '3px', borderLeftColor: col }}>
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{ok ? '✓' : '~'}</span>
        <div>
          <p className="text-[13px] font-[500] text-ink-1">{phrase}</p>
          <p className="text-[11px] text-ink-3 mt-1">
            Predicted {v.predicted?.toFixed(1) ?? '?'}% · actual {v.actualDelta?.toFixed(1) ?? '?'}% · {v.attributionMethod}
          </p>
        </div>
      </div>
    </div>
  )
}

function LessonCard({ l }: { l: any }) {
  const d = (() => { try { return JSON.parse(l.description) } catch { return {} } })()
  return (
    <div className="rounded-[10px] border border-learn/20 bg-learn/5 p-4">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-learn">💡</span>
        <p className="text-[13px] font-[500] text-ink-1">{l.label}</p>
      </div>
      {d.adjustment && <p className="text-[12px] text-ink-2 mb-2">→ {d.adjustment}</p>}
      {d.targets && d.targets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.targets.map((t: string, i: number) => (
            <span key={i} className="text-[10px] bg-surface-3 border border-line rounded-[4px] px-2 py-0.5 text-ink-3">
              informs: {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function LearnHub() {
  const [tab, setTab] = useState<'verdicts' | 'impact' | 'lessons' | 'calibration'>('verdicts')
  const [data, setData] = useState<any>({})
  const api = window.electronAPI as any

  useEffect(() => {
    Promise.all([
      api.invoke('aep:getOutcomes'),
      api.invoke('aep:getLearnings'),
      api.invoke('aep:getCalibration'),
    ]).then(([outcomes, learnings, calibration]) => {
      setData({ outcomes, learnings, calibration })
    })
  }, [])

  const verdicts = (data.outcomes ?? []).filter((o: any) => o.kind === 'HYPOTHESIS_VERDICT')
  const lessons  = data.learnings ?? []
  const cal      = data.calibration ?? []

  const TABS = [
    { id: 'verdicts',     label: 'Verdicts',         count: verdicts.length },
    { id: 'impact',       label: 'Your team',        count: 0 },
    { id: 'lessons',      label: 'Lessons',          count: lessons.length },
    { id: 'calibration',  label: 'Getting better?',  count: 0 },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[15px] font-[600] text-ink-1">Learn Hub</p>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {verdicts.filter((v: any) => v.validated).length} bets validated ·{' '}
              {verdicts.filter((v: any) => !v.validated).length} lessons taken ·{' '}
              {lessons.length} lessons distilled
            </p>
          </div>
        </div>
        <div className="flex gap-1 mt-3">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-colors ${tab === t.id ? 'bg-learn/10 text-learn font-[500]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'}`}>
              {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'verdicts' && (
          verdicts.length === 0
            ? <EmptyState verb="LEARN" title="No verdicts yet" body="Verdicts appear after a deployment's measurement window closes." />
            : <div className="flex flex-col gap-3 max-w-2xl">{verdicts.map((v: any) => <VerdictCard key={v.id} v={(() => { try { return { ...JSON.parse(v.description), id: v.id } } catch { return v } })()} />)}</div>
        )}

        {tab === 'lessons' && (
          lessons.length === 0
            ? <EmptyState verb="LEARN" title="No lessons yet" body="Lessons are distilled by A14 after verdicts are issued." />
            : <div className="flex flex-col gap-3 max-w-2xl">{lessons.map((l: any) => <LessonCard key={l.id} l={l} />)}</div>
        )}

        {tab === 'calibration' && (
          <div className="max-w-2xl flex flex-col gap-4">
            <p className="text-[13px] text-ink-2">
              Calibration tracks how accurate our estimates are, cycle over cycle.
              A downward trend here means the organization is learning.
            </p>
            {cal.filter((c: any) => c.meanErrorPct !== null).map((c: any) => (
              <div key={c.agentId} className="bg-surface-3 border border-line rounded-[10px] p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-[500] text-ink-1">{c.agentId}</span>
                  <span className={`text-[12px] font-[500] ${
                    c.trend === 'improving' ? 'text-ok' : c.trend === 'degrading' ? 'text-danger' : 'text-ink-3'
                  }`}>
                    {c.trend === 'improving' ? '↓ improving' : c.trend === 'degrading' ? '↑ degrading' : '→ stable'}
                  </span>
                </div>
                <p className="text-[12px] text-ink-3">{c.recommendation}</p>
                {c.meanErrorPct !== null && (
                  <p className="text-[11px] text-ink-3 mt-1">Mean error: {c.meanErrorPct.toFixed(1)}%</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


/* ─────────────────────────────────────────────────────────────────────────────
   actions/ActionsInbox.tsx
   ───────────────────────────────────────────────────────────────────────────── */
export function ActionsInbox() {
  const [items, setItems] = useState<any[]>([])
  const navigate = useNavigate?.() ?? ((path: string) => { window.location.hash = path })
  const api = window.electronAPI as any

  useEffect(() => {
    api.invoke('ux:getActions', { role: 'all' }).then(setItems)
  }, [])

  const VERB_MAP: Record<string, string> = {
    SIGN: 'text-warn', DECIDE: 'text-decide', FIX: 'text-danger', REVIEW: 'text-info', START: 'text-ok',
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <p className="text-[15px] font-[600] text-ink-1">My actions</p>
        <p className="text-[12px] text-ink-3 mt-0.5">{items.filter(i => !i.done).length} items need attention</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {items.length === 0
          ? <EmptyState verb="DECIDE" title="No actions right now" body="When decisions or fixes are needed, they appear here." />
          : <div className="flex flex-col divide-y divide-line">
              {items.map(item => (
                <div key={item.id} className="flex items-center gap-4 py-4">
                  <span className={`text-[12px] font-[700] w-14 flex-shrink-0 ${VERB_MAP[item.verb] ?? 'text-ink-3'}`}>
                    {item.verb}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-[500] text-ink-1">{item.title}</p>
                    <p className="text-[12px] text-ink-3 mt-0.5">{item.sub}</p>
                  </div>
                  <span className="text-[11px] text-ink-3 flex-shrink-0">{item.age}</span>
                  <button onClick={() => navigate(item.route)}
                    className="text-[12px] text-accent hover:text-accent-hover font-[500] flex-shrink-0 whitespace-nowrap">
                    {item.actionLabel} →
                  </button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  )
}

// polyfill for files that import useNavigate outside router context
function useNavigate() {
  try {
    const { useNavigate: rr } = require('react-router-dom')
    return rr()
  } catch { return null }
}


/* ─────────────────────────────────────────────────────────────────────────────
   store/ux/ux.store.ts
   ───────────────────────────────────────────────────────────────────────────── */
export type BoardItem = {
  id: number; featureId?: number; title: string; verb: string
  statusLine: string; status: string; needsHuman: boolean
  daysInStage: number; betCount: number; contextLabel?: string
  requiredRoles?: string[]; signedRoles?: string[]
}

// (abbreviated — full version has immer middleware)
import { create } from 'zustand'
import { immer }  from 'zustand/middleware/immer'

type UXState = {
  board: BoardItem[]; painPoints: any[]; contexts: any[]
  signalCount: number; painPointCount: number
  actionCount: number; role: string
  setBoard: (b: BoardItem[]) => void; setPainPoints: (p: any[]) => void
  setContexts: (c: any[]) => void; setSignalCount: (n: number) => void
  setPainPointCount: (n: number) => void; setActionCount: (n: number) => void
  setRole: (r: string) => void
}

export const useUXStore = create<UXState>()(immer(set => ({
  board: [], painPoints: [], contexts: [], signalCount: 0,
  painPointCount: 0, actionCount: 0, role: 'product',
  setBoard:          b => set(s => { s.board = b }),
  setPainPoints:     p => set(s => { s.painPoints = p }),
  setContexts:       c => set(s => { s.contexts = c }),
  setSignalCount:    n => set(s => { s.signalCount = n }),
  setPainPointCount: n => set(s => { s.painPointCount = n }),
  setActionCount:    n => set(s => { s.actionCount = n }),
  setRole:           r => set(s => { s.role = r }),
})))


/* ─────────────────────────────────────────────────────────────────────────────
   ux/uxReadModels.ts  (main process — the only backend addition)
   ───────────────────────────────────────────────────────────────────────────── */
// Paste into packages/main/src/ux/uxReadModels.ts and call registerUxReadModels
// in aepOrchestrator.register() with one line.

export function registerUxReadModels(ipcMain: any, db: any) {
  // 1. Journey board — one row per in-flight initiative
  ipcMain.handle('ux:getJourneyBoard', () => {
    const STAGE_TO_VERB: Record<string, string> = {
      SIGNALS: 'LISTEN', CLUSTER: 'LISTEN',
      INTAKE: 'DECIDE', QUALIFY: 'DECIDE', PACKET: 'DECIDE', PORTFOLIO_GATE: 'DECIDE',
      BUILD: 'BUILD',
      CONSOLIDATE: 'SHIP', RELEASE_GATE: 'SHIP', ROLLOUT: 'SHIP',
      OBSERVE: 'LEARN', LEARN: 'LEARN', DONE: 'LEARN',
    }
    const STATUS_LINE: Record<string, string> = {
      running: 'Agents working', waiting_gate: 'Needs a decision',
      waiting_external: 'Waiting on the world', error: 'Needs attention',
    }
    return db.prepare(`
      SELECT cr.id, cr.label as title, cr.current_stage, cr.status, cr.error,
             cr.feature_node_id, cr.readiness_report_id,
             (unixepoch()*1000 - cr.updated_at) / 86400000 as days_in_stage,
             (SELECT COUNT(*) FROM value_hypotheses vh
              JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
              WHERE vh.verdict_node_id IS NULL) as bet_count,
             (cr.status = 'waiting_gate') as needs_human
      FROM cycle_runs cr
      WHERE cr.status NOT IN ('completed','aborted')
      ORDER BY cr.updated_at DESC
    `).all().map((r: any) => ({
      id: r.id, featureId: r.feature_node_id,
      title: r.title,
      verb: STAGE_TO_VERB[r.current_stage] ?? 'BUILD',
      statusLine: r.status === 'waiting_gate' ? 'Needs a decision'
                : r.status === 'error' ? `Needs attention — ${r.error?.slice(0, 60)}`
                : r.status === 'waiting_external' ? `Waiting on the world`
                : 'Agents working',
      status: r.status, needsHuman: r.needs_human === 1,
      daysInStage: Math.round(r.days_in_stage ?? 0),
      betCount: r.bet_count ?? 0,
    }))
  })

  // 2. Feature story — golden thread + cycle timeline + roles
  ipcMain.handle('ux:getFeatureStory', (_e: any, { featureId }: { featureId: number }) => {
    const node = db.prepare('SELECT id, label FROM graph_nodes WHERE id=?').get(featureId) as any
    if (!node) return null

    const signals = db.prepare(`
      SELECT cs.label FROM graph_nodes cs
      JOIN graph_edges ge ON ge.from_node_id=cs.id AND ge.kind='EXPRESSES'
      JOIN graph_nodes pp ON pp.id=ge.to_node_id
      JOIN graph_edges ge2 ON ge2.to_node_id=? AND ge2.from_node_id=pp.id AND ge2.kind='MOTIVATES'
      WHERE cs.kind='CUSTOMER_SIGNAL' LIMIT 3
    `).all(featureId) as any[]

    const painPoints = db.prepare(`
      SELECT pp.label FROM graph_nodes pp
      JOIN graph_edges ge ON ge.to_node_id=? AND ge.from_node_id=pp.id AND ge.kind='MOTIVATES'
      WHERE pp.kind='PAIN_POINT'
    `).all(featureId) as any[]

    const bets = db.prepare(`
      SELECT gn.label, vh.kpi_node_id, vh.magnitude_pct, vh.direction,
             vh.prior_confidence, vh.verdict_node_id, vh.actual_delta_pct,
             (vn.description LIKE '%"validated":true%') as validated
      FROM value_hypotheses vh
      JOIN graph_nodes gn ON gn.id=vh.hypothesis_node_id AND gn.source_type='committed'
      JOIN graph_edges ge ON ge.from_node_id=? AND ge.to_node_id=vh.hypothesis_node_id
      LEFT JOIN graph_nodes vn ON vn.id=vh.verdict_node_id
    `).all(featureId) as any[]

    const regulations = db.prepare(`
      SELECT DISTINCT reg.id, reg.label FROM graph_nodes reg
      JOIN graph_edges ge ON ge.to_node_id=reg.id AND ge.kind='GOVERNED_BY'
      JOIN graph_nodes code ON code.id=ge.from_node_id
      JOIN feature_traces ft ON ft.code_node_id=code.id AND ft.feature_node_id=?
      WHERE reg.kind='REGULATION'
    `).all(featureId) as any[]

    const run = db.prepare(`SELECT * FROM cycle_runs WHERE feature_node_id=? ORDER BY created_at DESC LIMIT 1`).get(featureId) as any
    const signalCount = db.prepare(`
      SELECT COUNT(DISTINCT cs.id) c FROM graph_nodes cs
      JOIN graph_edges ge ON ge.from_node_id=cs.id AND ge.kind='EXPRESSES'
      JOIN graph_nodes pp ON pp.id=ge.to_node_id
      JOIN graph_edges ge2 ON ge2.to_node_id=? AND ge2.from_node_id=pp.id
    `).get(featureId) as any

    const approvalSet = run?.readiness_report_id
      ? (() => {
          try {
            const r = db.prepare('SELECT description FROM graph_nodes WHERE id=?').get(run.readiness_report_id) as any
            return JSON.parse(r.description).approvalSet ?? []
          } catch { return [] }
        })()
      : []

    return {
      id: node.id, title: node.label,
      originProblem: painPoints[0]?.label ?? null,
      signalCount: signalCount?.c ?? signals.length,
      signals, painPoints, bets, regulations,
      involvedRoles: approvalSet,
      run,
    }
  })

  // 3. Actions inbox
  ipcMain.handle('ux:getActions', (_e: any, { role }: { role: string }) => {
    const gates = db.prepare(`
      SELECT cr.id as run_id, cr.current_stage, cr.label as title
      FROM cycle_runs cr
      WHERE cr.status='waiting_gate'
      ORDER BY cr.updated_at ASC
    `).all() as any[]

    return gates.map((g: any) => ({
      id: g.run_id, verb: 'SIGN',
      title: `Sign off on ${g.title}`,
      sub: g.current_stage === 'PORTFOLIO_GATE' ? 'Portfolio admission decision needed' : 'Release approval needed',
      age: 'now',
      actionLabel: 'Review & sign',
      route: `/gate/${g.run_id}/${g.current_stage}`,
    }))
  })

  // 4. Single graph node (for peeks and gate rooms)
  ipcMain.handle('ux:getGraphNode', (_e: any, { nodeId }: { nodeId: number }) =>
    db.prepare('SELECT id, kind, label, description FROM graph_nodes WHERE id=?').get(nodeId)
  )
}
