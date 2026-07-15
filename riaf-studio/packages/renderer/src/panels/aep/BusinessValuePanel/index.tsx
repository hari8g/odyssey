/**
 * panels/aep/BusinessValuePanel/index.tsx
 * DECIDE room — pick problems worth sizing, run the advisor pipeline, review the bets.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, useToast } from '@/design/primitives'
import { DICT } from '@/design/dictionary'
import { agentName, STAGE_ORDER, type CycleRun } from '@/store/cycle.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type PainPointRow = {
  id: number
  label: string
  description: string | null
  importance_score: number | null
  signal_count: number
}

type HypothesisRow = {
  hypothesisNodeId: number
  label: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  priorConfidence: number
  attributionMethod: string
  actualDeltaPct: number | null
  verdict: string | null
}

type SourceKind = 'csv' | 'zendesk' | 'nps' | 'manual'
type RawSignal = { cohort: string; type: string; text: string; date?: string }

const SOURCE_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'zendesk', label: 'Zendesk JSON' },
  { value: 'nps', label: 'NPS JSON' },
  { value: 'manual', label: 'Plain text (one signal per line)' },
]

const FORMAT_HINTS: Record<SourceKind, string> = {
  csv: 'date,cohort,type,text\n2026-07-01,enterprise,feature_request,We need bulk operations',
  zendesk:
    'A JSON array of tickets: [{"subject":"…","description":"…","organization":"enterprise","created_at":"2026-07-01"}]',
  nps: 'A JSON array of responses: [{"score":6,"comment":"…","segment":"fleet-operators","date":"2026-07-01"}]',
  manual: 'Each line becomes one signal — cohort is recorded as "manual", type as "feature_request".',
}

function parseCsvBlock(raw: string): RawSignal[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase())
  return lines
    .slice(1)
    .map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
      const obj: Record<string, string> = {}
      header.forEach((h, i) => {
        obj[h] = values[i] ?? ''
      })
      return { cohort: obj['cohort'] || 'manual', type: obj['type'] || 'feature_request', text: obj['text'] ?? '', date: obj['date'] }
    })
    .filter((s) => s.text.trim().length > 0)
}

function parseZendeskBlock(raw: string): RawSignal[] {
  let arr: Array<Record<string, unknown>>
  try {
    const parsed = JSON.parse(raw)
    arr = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  return arr
    .map((t) => ({
      cohort: String(t['organization'] ?? t['cohort'] ?? 'zendesk'),
      type: String(t['type'] ?? 'feature_request'),
      text: String(t['description'] ?? t['subject'] ?? t['text'] ?? ''),
      date: t['created_at'] ? String(t['created_at']) : t['date'] ? String(t['date']) : undefined,
    }))
    .filter((s) => s.text.trim().length > 0)
}

function parseNpsBlock(raw: string): RawSignal[] {
  let arr: Array<Record<string, unknown>>
  try {
    const parsed = JSON.parse(raw)
    arr = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  return arr
    .map((r) => {
      const score = typeof r['score'] === 'number' ? (r['score'] as number) : null
      return {
        cohort: String(r['segment'] ?? r['cohort'] ?? 'nps'),
        type: score !== null && score <= 6 ? 'churn_risk' : 'feature_request',
        text: String(r['comment'] ?? r['text'] ?? ''),
        date: r['date'] ? String(r['date']) : undefined,
      }
    })
    .filter((s) => s.text.trim().length > 0)
}

function parsePlainText(raw: string): RawSignal[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ cohort: 'manual', type: 'feature_request', text }))
}

function parseFeedback(source: SourceKind, raw: string): RawSignal[] {
  if (source === 'csv') return parseCsvBlock(raw)
  if (source === 'zendesk') return parseZendeskBlock(raw)
  if (source === 'nps') return parseNpsBlock(raw)
  return parsePlainText(raw)
}

function verdictStatus(v: string | null): 'pending' | 'validated' | 'refuted' {
  if (!v) return 'pending'
  const up = v.toUpperCase()
  if (up.includes('VALIDATED')) return 'validated'
  return 'refuted'
}

const SORT_WEIGHT: Record<'pending' | 'validated' | 'refuted', number> = {
  pending: 0,
  validated: 1,
  refuted: 2,
}

const PIPELINE_STAGES = ['INTAKE', 'QUALIFY', 'PACKET', 'PORTFOLIO_GATE'] as const

function pipelineStepLabel(stage: string): string {
  if (stage === 'INTAKE') return `${agentName('A1')} working…`
  if (stage === 'QUALIFY') return `${agentName('A2')} + ${agentName('A4')} working…`
  if (stage === 'PACKET') return `${agentName('A5')} working…`
  if (stage === 'PORTFOLIO_GATE') return 'Decision packet ready →'
  return stage
}

export function BusinessValuePanel() {
  const navigate = useNavigate()
  const { push } = useToast()

  const [tab, setTab] = useState<'problems' | 'feedback' | 'bets'>('problems')

  // Problems tab
  const [painPoints, setPainPoints] = useState<PainPointRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pipelineRun, setPipelineRun] = useState<CycleRun | null>(null)
  const [pipelineBusy, setPipelineBusy] = useState(false)

  // Feedback tab
  const [source, setSource] = useState<SourceKind>('csv')
  const [content, setContent] = useState('')
  const [ingesting, setIngesting] = useState(false)

  // Bets tab
  const [hypotheses, setHypotheses] = useState<HypothesisRow[]>([])

  const unsubRef = useRef<(() => void) | null>(null)

  const refresh = useCallback(async () => {
    const [pp, hyps] = await Promise.all([eAPI().aepGetPainPoints?.(), eAPI().aepGetHypotheses?.()])
    setPainPoints(Array.isArray(pp) ? pp : [])
    setHypotheses(Array.isArray(hyps) ? hyps : [])
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => () => unsubRef.current?.(), [])

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function addFeedback() {
    const parsed = parseFeedback(source, content)
    if (parsed.length === 0) {
      push({ message: 'Nothing to add — check the format hint below the textarea', status: 'warn' })
      return
    }
    setIngesting(true)
    try {
      const result = await eAPI().aepIngestSignals?.(source, JSON.stringify(parsed))
      if (result?.error) throw new Error(result.error)
      push({ message: `✓ ${result?.inserted ?? parsed.length} feedback item${(result?.inserted ?? parsed.length) === 1 ? '' : 's'} added`, status: 'ok' })
      setContent('')
      await refresh()
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Could not add feedback', status: 'danger' })
    } finally {
      setIngesting(false)
    }
  }

  async function runAdvisors() {
    if (selected.size === 0) return
    setPipelineBusy(true)
    setPipelineRun(null)
    try {
      const res = await eAPI().cycleStart?.({
        label: `Advisors run — ${selected.size} problem${selected.size === 1 ? '' : 's'}`,
        mode: 'demo',
        painPointIds: Array.from(selected),
      })
      if (res?.error) throw new Error(res.error)
      const runId = res.runId as number

      unsubRef.current?.()
      unsubRef.current = eAPI().onCycleUpdate?.((r: unknown) => {
        if (r && typeof r === 'object' && (r as CycleRun).id === runId) {
          const run = r as CycleRun
          setPipelineRun(run)
          if (run.status === 'waiting_gate' || run.status === 'error' || run.status === 'completed') {
            setPipelineBusy(false)
          }
        }
      })

      const run = await eAPI().cycleGet?.(runId)
      if (run && !run.error) setPipelineRun(run)
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Could not run advisors', status: 'danger' })
      setPipelineBusy(false)
    }
  }

  async function retryPipeline() {
    if (!pipelineRun) return
    setPipelineBusy(true)
    try {
      await eAPI().cycleAdvance?.(pipelineRun.id)
      const run = await eAPI().cycleGet?.(pipelineRun.id)
      if (run && !run.error) setPipelineRun(run)
    } finally {
      setPipelineBusy(false)
    }
  }

  const sortedHypotheses = [...hypotheses].sort(
    (a, b) => SORT_WEIGHT[verdictStatus(a.verdict)] - SORT_WEIGHT[verdictStatus(b.verdict)],
  )

  const atPortfolioGate = pipelineRun?.current_stage === 'PORTFOLIO_GATE' && pipelineRun.status === 'waiting_gate'
  const pipelineErrored = pipelineRun?.status === 'error'

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <p className="text-[15px] font-[600] text-ink-1">Business Value</p>
        <p className="text-[12px] text-ink-3 mt-0.5">
          {painPoints.length} problem{painPoints.length === 1 ? '' : 's'} · {hypotheses.length} bet{hypotheses.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-1 mt-3">
          {(
            [
              { id: 'problems' as const, label: 'Problems', count: painPoints.length },
              { id: 'feedback' as const, label: 'Add Feedback', count: 0 },
              { id: 'bets' as const, label: 'Bets & Predictions', count: hypotheses.length },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-colors ${
                tab === t.id ? 'bg-decide/10 text-decide font-[500]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'
              }`}
            >
              {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'problems' && (
          <div className="flex flex-col gap-4 max-w-4xl">
            {painPoints.length === 0 ? (
              <EmptyState
                verb="DECIDE"
                title="No problems to size yet"
                body="Add customer feedback and run clustering from the Customer Feedback room first."
                action={{ label: 'Add feedback', onClick: () => setTab('feedback') }}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {painPoints.map((pp) => (
                    <Card key={pp.id} verb="DECIDE" className="p-4 flex flex-col gap-2">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(pp.id)}
                          onChange={() => toggleSelect(pp.id)}
                          className="mt-0.5 accent-accent"
                        />
                        <div className="flex-1">
                          <p className="text-[13px] font-[500] text-ink-1">{pp.label}</p>
                          <p className="text-[11px] text-ink-3 mt-0.5">
                            {pp.signal_count} voice{pp.signal_count === 1 ? '' : 's'}
                          </p>
                        </div>
                      </label>
                    </Card>
                  ))}
                </div>

                <Button
                  disabled={selected.size === 0 || pipelineBusy}
                  loading={pipelineBusy}
                  onClick={() => void runAdvisors()}
                  className="self-start"
                >
                  Run advisors on {selected.size} selected →
                </Button>

                {pipelineRun && (
                  <div className="bg-surface-3 border border-line rounded-[10px] p-4 flex flex-col gap-3 max-w-md">
                    {PIPELINE_STAGES.map((stage) => {
                      const curIdx = STAGE_ORDER.indexOf(pipelineRun.current_stage)
                      const stageIdx = STAGE_ORDER.indexOf(stage)
                      const done = curIdx > stageIdx || (curIdx === stageIdx && atPortfolioGate)
                      const active = curIdx === stageIdx && !done
                      return (
                        <div key={stage} className="flex items-center gap-2 text-[12px]">
                          <span className={done ? 'text-ok' : active ? 'text-accent' : 'text-ink-3'}>
                            {done ? '✓' : active ? '⟳' : '○'}
                          </span>
                          <span className={done ? 'text-ink-2' : active ? 'text-ink-1 font-[500]' : 'text-ink-3'}>
                            {pipelineStepLabel(stage)}
                          </span>
                        </div>
                      )
                    })}

                    {pipelineErrored && (
                      <div className="flex items-center gap-2 text-[12px] text-danger">
                        <span className="flex-1">{pipelineRun.error ?? 'Something went wrong'}</span>
                        <Button variant="ghost" onClick={() => void retryPipeline()} className="text-danger">
                          Retry
                        </Button>
                      </div>
                    )}

                    {atPortfolioGate && (
                      <div className="bg-ok/10 border border-ok/30 rounded-[8px] p-3 flex flex-col gap-2">
                        <p className="text-[12px] text-ok font-[500]">
                          Ready for leadership review → the decision packet is assembled.
                        </p>
                        <Button onClick={() => navigate(`/gate/${pipelineRun.id}/PORTFOLIO_GATE`)} className="self-start">
                          Open decision room
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'feedback' && (
          <div className="max-w-xl flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as SourceKind)}
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong"
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Paste raw feedback</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder="Paste here…"
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none font-mono"
              />
              <p className="text-[11px] text-ink-3 whitespace-pre-wrap">{FORMAT_HINTS[source]}</p>
            </div>
            <Button loading={ingesting} disabled={!content.trim()} onClick={() => void addFeedback()} className="self-start">
              Add feedback
            </Button>
          </div>
        )}

        {tab === 'bets' &&
          (sortedHypotheses.length === 0 ? (
            <EmptyState
              verb="DECIDE"
              title="No bets yet"
              body="Bets appear once a problem is admitted at the portfolio gate."
            />
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              {sortedHypotheses.map((h) => {
                const status = verdictStatus(h.verdict)
                const icon = status === 'pending' ? '⏳' : status === 'validated' ? '✅' : '~'
                return (
                  <Card key={h.hypothesisNodeId} verb="DECIDE" className="p-4 flex flex-col gap-1.5">
                    <div className="flex items-start gap-2.5">
                      <span className="text-[14px] flex-shrink-0">{icon}</span>
                      <p className="text-[13px] font-[500] text-ink-1">
                        {DICT.phrases.betLine(h.kpiLabel, h.direction, h.magnitudePct, h.timeframeDays)}
                      </p>
                    </div>
                    <p className="text-[12px] text-ink-3 pl-6">
                      We&apos;re {(h.priorConfidence * 100).toFixed(0)}% confident before measuring
                    </p>
                    {status !== 'pending' && (
                      <p className={`text-[12px] pl-6 ${status === 'refuted' ? 'text-ink-3' : 'text-ok'}`}>
                        {status === 'refuted'
                          ? `The bet didn't pay off — ${h.actualDeltaPct?.toFixed(1) ?? '?'}% vs ${h.magnitudePct}% predicted. That's a lesson.`
                          : `Actual ${h.actualDeltaPct?.toFixed(1) ?? '?'}% vs ${h.magnitudePct}% predicted · ${h.attributionMethod}`}
                      </p>
                    )}
                  </Card>
                )
              })}
            </div>
          ))}
      </div>
    </div>
  )
}
