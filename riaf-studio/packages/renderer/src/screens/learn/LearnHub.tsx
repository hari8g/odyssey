/**
 * screens/learn/LearnHub.tsx
 * The learning loop made visible — verdicts, team impact, lessons, calibration.
 * "Cycle review" mode stacks all four sections for a quarterly-meeting readout.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, Sparkline } from '@/design/primitives'
import { DICT } from '@/design/dictionary'
import { agentName } from '@/store/cycle.store'
import { useUXStore } from '@/store/ux/ux.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type EdgeRow = { from_node_id: number; to_node_id: number; kind: string }
type GraphNodeRow = { id: number; kind?: string; label: string; description: string | null; created_at?: number }

// ── Learning target → route (never A-codes; plain rooms) ─────────────────────
function targetRoute(target: string): string {
  if (/^Pain point:/i.test(target)) return '/room/signals'
  if (/^Business objective/i.test(target)) return '/journey?verb=DECIDE'
  if (/A2|fleet estimates/i.test(target)) return '/room/bizvalue'
  if (/^Hypothesis:/i.test(target)) return '/room/bizvalue'
  return '/room/learn'
}

// ── Verdict parsing (verdict nodes carry the truth in the LABEL, not JSON) ───
function parseVerdict(v: GraphNodeRow): {
  ok: boolean
  kpi: string
  predictedPct: number | null
  actualPct: number | null
  rationale: string
} {
  const ok = /VALIDATED/i.test(v.label)
  const m = v.label.match(/—\s*(?:H:\s*)?(increase|decrease|stabilize)\s+(.+?)\s+by\s+([\d.]+)%/i)
  const kpi = m?.[2] ?? v.label.replace(/^Verdict:\s*\w+\s*—\s*/i, '').slice(0, 40)
  const predictedPct = m?.[3] ? Number(m[3]) : null
  const rationale = v.description ?? ''
  const am = rationale.match(/actual delta:\s*(-?[\d.]+)%/i) ?? rationale.match(/moved\s*(-?[\d.]+)%/i)
  const actualPct = am ? Number(am[1]) : null
  return { ok, kpi, predictedPct, actualPct, rationale }
}

function VerdictCard({ v, onOpen }: { v: GraphNodeRow; onOpen: () => void }) {
  const { ok, kpi, predictedPct, actualPct, rationale } = parseVerdict(v)
  const col = ok ? '#2FBF8F' : '#A9ADB6'
  const phrase = ok
    ? DICT.phrases.verdictValidated(kpi, actualPct ?? predictedPct ?? 0)
    : DICT.phrases.verdictRefuted(kpi, actualPct ?? 0)
  return (
    <div onClick={onOpen}
      className="rounded-[10px] border bg-surface-3 p-4 cursor-pointer hover:bg-surface-2 transition-colors"
      style={{ borderLeftWidth: '3px', borderLeftColor: col }}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{ok ? '✓' : '~'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-[500] text-ink-1">{phrase}</p>
          <p className="text-[11px] text-ink-3 mt-1">
            {predictedPct !== null && `Predicted ${predictedPct}%`}
            {predictedPct !== null && actualPct !== null && ' · '}
            {actualPct !== null && `actual ${actualPct}%`}
          </p>
          {rationale && !rationale.startsWith('[stub]') && (
            <p className="text-[11px] text-ink-3 mt-1 line-clamp-2">{rationale}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function LessonCard({ l, navigate }: {
  l: { id: number; label: string; description: string | null }
  navigate: (route: string) => void
}) {
  const d = (() => {
    try {
      return l.description ? JSON.parse(l.description) : {}
    } catch {
      return {}
    }
  })() as { adjustment?: string; targets?: string[] }
  return (
    <div className="rounded-[10px] border border-learn/20 bg-learn/5 p-4">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-learn">💡</span>
        <p className="text-[13px] font-[500] text-ink-1">{l.label}</p>
      </div>
      {d.adjustment && <p className="text-[12px] text-ink-2 mb-2">→ {d.adjustment}</p>}
      {Array.isArray(d.targets) && d.targets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.targets.map((t: string, i: number) => (
            <button key={i} type="button" onClick={() => navigate(targetRoute(t))}
              className="text-[10px] bg-surface-3 border border-line rounded-[4px] px-2 py-0.5 text-ink-3 hover:text-ink-1 hover:border-line-strong transition-colors"
            >
              informs: {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sentiment heuristic (IMPACT_ASSESSMENT nodes carry free-form summaries) ──
function sentimentOf(summary: string): 'positive' | 'neutral' | 'mixed' | 'negative' {
  const s = summary.toLowerCase()
  const pos = /positive|improv|benefit|win|success|paid off/.test(s)
  const neg = /negative|risk|concern|regress|burden|failure|blocked/.test(s)
  if (pos && neg) return 'mixed'
  if (pos) return 'positive'
  if (neg) return 'negative'
  return 'neutral'
}
const SENTIMENT_COLOR: Record<string, string> = {
  positive: '#2FBF8F', neutral: '#A9ADB6', mixed: '#E8A13C', negative: '#E25C5C',
}

function TeamImpactCard({ node, defaultOpen }: { node: GraphNodeRow; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const unitMatch = node.label.match(/^Impact:\s*(.+?)\s*←/)
  const unit = unitMatch ? unitMatch[1] : node.label
  const summary = node.description ?? ''
  const sentiment = sentimentOf(summary)
  const actionItems = summary
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-') || l.startsWith('•'))
    .map((l) => l.replace(/^[-•]\s*/, ''))
  const prose = summary.replace(/^\[stub\]\s*/, '')

  return (
    <div className="rounded-[10px] border border-line bg-surface-3 p-4">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-[500] text-ink-1">{unit}</span>
          <span className="text-[10px] font-[500] px-2 py-0.5 rounded-[999px] border"
            style={{ color: SENTIMENT_COLOR[sentiment], borderColor: SENTIMENT_COLOR[sentiment] + '60', background: SENTIMENT_COLOR[sentiment] + '1A' }}>
            {sentiment}
          </span>
        </div>
        <span className="text-ink-3 text-[11px]">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-[12px] text-ink-2 leading-relaxed">{prose.slice(0, 400)}</p>
          {actionItems.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {actionItems.map((a, i) => (
                <li key={i} className="text-[11px] text-ink-3">→ {a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Getting better? row ───────────────────────────────────────────────────────
type CalRow = {
  id: number
  agentId: string
  cycleEndDate: string
  predictions: number
  verified: number
  meanErrorPct: number | null
  calibrationScore: number | null
}
type AgentTrend = {
  agentId: string
  trend: 'improving' | 'stable' | 'degrading'
  sparkline: number[]
  meanErrorPct: number | null
  recommendation: string
  cycles: number
}

function groupCalibration(rows: CalRow[]): AgentTrend[] {
  const byAgent = new Map<string, CalRow[]>()
  for (const r of rows) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, [])
    byAgent.get(r.agentId)!.push(r)
  }
  const out: AgentTrend[] = []
  for (const [agentId, agentRows] of byAgent) {
    // rows arrive most-recent-first; reverse for chronological order
    const chron = [...agentRows].reverse()
    const errors = chron.map((r) => r.meanErrorPct).filter((v): v is number => v != null)
    const last4 = errors.slice(-4)
    let trend: AgentTrend['trend'] = 'stable'
    const first = last4[0]
    const last = last4[last4.length - 1]
    if (last4.length >= 2 && first != null && last != null) {
      const delta = last - first
      if (delta < -2) trend = 'improving'
      else if (delta > 2) trend = 'degrading'
    }
    const recommendation =
      trend === 'improving'
        ? 'Predictions are getting more accurate — the learning loop is working.'
        : trend === 'degrading'
          ? "Accuracy is slipping — this agent's prompts may need review."
          : `Consistent accuracy over ${agentRows.length} cycle${agentRows.length === 1 ? '' : 's'}.`
    out.push({
      agentId,
      trend,
      sparkline: last4,
      meanErrorPct: agentRows[0]?.meanErrorPct ?? null,
      recommendation,
      cycles: agentRows.length,
    })
  }
  return out
}

const TREND_META: Record<AgentTrend['trend'], { icon: string; color: string }> = {
  improving: { icon: '↓', color: '#2FBF8F' },
  stable: { icon: '→', color: '#A9ADB6' },
  degrading: { icon: '↑', color: '#E25C5C' },
}

function CalibrationRow({ a, first }: { a: AgentTrend; first: boolean }) {
  const meta = TREND_META[a.trend]
  return (
    <div className="flex flex-col gap-2">
      {first && a.trend === 'improving' && (
        <div className="bg-learn/10 border border-learn/30 rounded-[8px] px-3 py-2 text-[12px] text-learn font-[500]">
          Your estimates are improving. The learning loop is working.
        </div>
      )}
      <div className="rounded-[10px] border border-line bg-surface-3 p-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-[500] text-ink-1">{agentName(a.agentId)}</span>
            <span className="text-[12px] font-[600]" style={{ color: meta.color }}>{meta.icon}</span>
          </div>
          {a.meanErrorPct != null && (
            <p className="text-[11px] text-ink-3 mt-0.5">Mean error: {a.meanErrorPct.toFixed(1)}%</p>
          )}
          <p className="text-[12px] text-ink-2 mt-1">{a.recommendation}</p>
        </div>
        {a.sparkline.length >= 2 && <Sparkline values={a.sparkline} color={meta.color} />}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// LEARN HUB
// ═════════════════════════════════════════════════════════════════════════════
type TabId = 'verdicts' | 'team' | 'lessons' | 'calibration'

export function LearnHub() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('verdicts')
  const [reviewMode, setReviewMode] = useState(false)
  const { verdicts, learnings, refreshHome } = useUXStore()
  const [calibration, setCalibration] = useState<CalRow[]>([])
  const [teamNodes, setTeamNodes] = useState<GraphNodeRow[]>([])
  const [verdictToFeature, setVerdictToFeature] = useState<Record<number, number>>({})
  const [role] = useState(() => useUXStore.getState().role)

  useEffect(() => {
    void refreshHome()
    void eAPI().aepGetCalibration?.()?.then((c: unknown) => {
      if (Array.isArray(c)) setCalibration(c as CalRow[])
    })
  }, [refreshHome])

  // Team impact: fetch IMPACT_ASSESSMENT nodes, scoped to the most recently completed feature if possible.
  useEffect(() => {
    void (async () => {
      const [nodes, runs] = await Promise.all([
        eAPI().getISSGraphNodes?.({ kind: 'IMPACT_ASSESSMENT' }),
        eAPI().cycleList?.(),
      ])
      const all: GraphNodeRow[] = Array.isArray(nodes) ? nodes : []
      const completedRuns = Array.isArray(runs) ? runs.filter((r: any) => r.status === 'completed') : []
      const latest = completedRuns.sort((a: any, b: any) => (b.updated_at ?? 0) - (a.updated_at ?? 0))[0]
      if (latest?.feature_node_id) {
        const thread = await eAPI().aepGetGoldenThread?.(latest.feature_node_id)
        const featureLabel = thread?.featureLabel
        const scoped = featureLabel
          ? all.filter((n) => n.label.includes(`← ${String(featureLabel).slice(0, 80)}`))
          : []
        setTeamNodes(scoped.length > 0 ? scoped : all)
      } else {
        setTeamNodes(all)
      }
    })()
  }, [])

  // Map verdict node → feature, via VALIDATES/REFUTES_HYPOTHESIS then HAS_HYPOTHESIS edges.
  useEffect(() => {
    void (async () => {
      const [validates, refutes, hasHyp] = await Promise.all([
        eAPI().getISSGraphEdges?.({ kind: 'VALIDATES_HYPOTHESIS' }),
        eAPI().getISSGraphEdges?.({ kind: 'REFUTES_HYPOTHESIS' }),
        eAPI().getISSGraphEdges?.({ kind: 'HAS_HYPOTHESIS' }),
      ])
      const verdictToHyp = new Map<number, number>()
      for (const e of [...(Array.isArray(validates) ? validates : []), ...(Array.isArray(refutes) ? refutes : [])] as EdgeRow[]) {
        verdictToHyp.set(e.from_node_id, e.to_node_id)
      }
      const hypToFeature = new Map<number, number>()
      for (const e of (Array.isArray(hasHyp) ? hasHyp : []) as EdgeRow[]) {
        hypToFeature.set(e.to_node_id, e.from_node_id)
      }
      const map: Record<number, number> = {}
      for (const [verdictId, hypId] of verdictToHyp) {
        const featureId = hypToFeature.get(hypId)
        if (featureId) map[verdictId] = featureId
      }
      setVerdictToFeature(map)
    })()
  }, [])

  const calByAgent = useMemo(() => groupCalibration(calibration), [calibration])
  const sortedTeamNodes = useMemo(() => {
    const roleWord = role.toLowerCase()
    return [...teamNodes].sort((a, b) => {
      const aMatch = a.label.toLowerCase().includes(roleWord) ? 0 : 1
      const bMatch = b.label.toLowerCase().includes(roleWord) ? 0 : 1
      return aMatch - bMatch
    })
  }, [teamNodes, role])

  const openVerdict = (v: GraphNodeRow) => {
    const featureId = verdictToFeature[v.id]
    if (featureId) navigate(`/feature/${featureId}`)
  }

  const TABS: { id: TabId; label: string; count: number }[] = [
    { id: 'verdicts', label: 'Verdicts', count: verdicts.length },
    { id: 'team', label: 'Your team', count: teamNodes.length },
    { id: 'lessons', label: 'Lessons', count: learnings.length },
    { id: 'calibration', label: 'Getting better?', count: calByAgent.length },
  ]

  const Verdicts = () => (
    verdicts.length === 0 ? (
      <EmptyState verb="LEARN" title="No verdicts yet"
        body="Verdicts appear after a deployment's measurement window closes." />
    ) : (
      <div className="flex flex-col gap-3 max-w-2xl">
        {verdicts.map((v) => (
          <VerdictCard key={v.id} v={v as GraphNodeRow} onOpen={() => openVerdict(v as GraphNodeRow)} />
        ))}
      </div>
    )
  )

  const Team = () => (
    sortedTeamNodes.length === 0 ? (
      <EmptyState verb="LEARN" title="No team impact yet"
        body="Impact for your team appears after a deployment's outcomes are assessed." />
    ) : (
      <div className="flex flex-col gap-3 max-w-2xl">
        {sortedTeamNodes.map((n, i) => (
          <TeamImpactCard key={n.id} node={n} defaultOpen={i === 0} />
        ))}
      </div>
    )
  )

  const Lessons = () => (
    learnings.length === 0 ? (
      <EmptyState verb="LEARN" title="No lessons yet"
        body="Lessons are distilled by the Lesson Distiller after verdicts are issued." />
    ) : (
      <div className="flex flex-col gap-3 max-w-2xl">
        {learnings.map((l) => (
          <LessonCard key={l.id} l={l} navigate={navigate} />
        ))}
      </div>
    )
  )

  const Calibration = () => (
    <div className="max-w-2xl flex flex-col gap-4">
      <p className="text-[13px] text-ink-2">
        Calibration tracks how accurate our estimates are, cycle over cycle.
      </p>
      {calByAgent.length === 0 ? (
        <p className="text-[13px] text-ink-3">No calibration data yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {calByAgent.map((a, i) => (
            <CalibrationRow key={a.agentId} a={a} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  )

  if (reviewMode) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-line flex-shrink-0 flex items-center gap-3">
          <p className="text-[15px] font-[600] text-ink-1">Cycle review</p>
          <div className="flex-1" />
          <button type="button" onClick={() => setReviewMode(false)}
            className="text-[11px] text-ink-3 bg-surface-2 border border-line px-3 py-1 rounded-[999px]">
            Exit review
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          <section>
            <p className="text-[13px] font-[600] text-ink-1 mb-3">Verdicts</p>
            <Verdicts />
          </section>
          <section>
            <p className="text-[13px] font-[600] text-ink-1 mb-3">Your team</p>
            <Team />
          </section>
          <section>
            <p className="text-[13px] font-[600] text-ink-1 mb-3">Lessons</p>
            <Lessons />
          </section>
          <section>
            <p className="text-[13px] font-[600] text-ink-1 mb-3">Getting better?</p>
            <Calibration />
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-[600] text-ink-1">Learn Hub</p>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {verdicts.length} verdicts · {learnings.length} lessons distilled
            </p>
          </div>
          <Button variant="ghost" onClick={() => setReviewMode(true)} className="text-[11px]">
            📊 Cycle review
          </Button>
        </div>
        <div className="flex gap-1 mt-3">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-colors ${
                tab === t.id
                  ? 'bg-learn/10 text-learn font-[500]'
                  : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'
              }`}
            >
              {t.label}{' '}
              {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'verdicts' && <Verdicts />}
        {tab === 'team' && <Team />}
        {tab === 'lessons' && <Lessons />}
        {tab === 'calibration' && <Calibration />}
      </div>
    </div>
  )
}
