/**
 * panels/aep/OutcomeDashboardPanel/index.tsx
 * LEARN room — the raw data behind the narrative in the Learn Hub.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, DataTable, EmptyState, Sparkline, useToast } from '@/design/primitives'
import type { StatusKey } from '@/design/tokens'
import { DICT } from '@/design/dictionary'
import { agentName } from '@/store/cycle.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type ValueStreamFeature = { id: number; label: string; stream_state: string; entered_state_at: number }

type OutcomeApiRow = {
  id: number
  featureId: number
  featureLabel: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  timeframeDays: number
  actualDeltaPct: number | null
  verdict: 'validated' | 'refuted' | 'inconclusive'
  createdAt: number
}

type VerdictRow = {
  id: string
  featureId: number
  initiative: string
  metric: string
  predicted: string
  status: 'validated' | 'refuted' | 'inconclusive'
  actualDeltaPct: number | null
  predictedMagnitude: number
  when: number
}

type OrgImpactGroup = { orgUnitLabel: string; summaries: string[] }

type CalibrationRow = {
  id: number
  agentId: string
  cycleEndDate: string
  predictions: number
  verified: number
  meanErrorPct: number | null
  calibrationScore: number | null
}

function sentimentOf(text: string): 'positive' | 'neutral' | 'mixed' | 'negative' {
  const lower = text.toLowerCase()
  const neg = /risk|concern|issue|blocker|negative|breach|halt|complaint/.test(lower)
  const pos = /improved|success|positive|paid off|validated|growth|delight/.test(lower)
  if (pos && neg) return 'mixed'
  if (pos) return 'positive'
  if (neg) return 'negative'
  return 'neutral'
}

const SENTIMENT_BADGE: Record<'positive' | 'neutral' | 'mixed' | 'negative', StatusKey> = {
  positive: 'ok',
  neutral: 'neutral',
  mixed: 'warn',
  negative: 'danger',
}

function splitSentences(text: string): string[] {
  return text
    .replace(/^\[stub\]\s*/i, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

type Trend = 'improving' | 'stable' | 'degrading'

function computeTrend(values: number[]): Trend {
  if (values.length < 2) return 'stable'
  const first = values[0]!
  const last = values[values.length - 1]!
  if (last < first - 5) return 'improving'
  if (last > first + 5) return 'degrading'
  return 'stable'
}

const TREND_META: Record<Trend, { arrow: string; color: string }> = {
  improving: { arrow: '↓', color: 'text-ok' },
  stable: { arrow: '→', color: 'text-ink-3' },
  degrading: { arrow: '↑', color: 'text-danger' },
}

function trendInterpretation(trend: Trend, cycles: number): string {
  if (trend === 'improving') return 'Predictions getting more accurate — lessons are working'
  if (trend === 'degrading') return "Predictions getting less accurate — this agent's prompts may need review"
  return `Consistent accuracy over ${cycles} cycle${cycles === 1 ? '' : 's'}`
}

export function OutcomeDashboardPanel() {
  const navigate = useNavigate()
  const { push } = useToast()

  const [tab, setTab] = useState<'verdicts' | 'team' | 'calibration'>('verdicts')
  const [loading, setLoading] = useState(true)
  const [verdicts, setVerdicts] = useState<VerdictRow[]>([])
  const [orgImpacts, setOrgImpacts] = useState<OrgImpactGroup[]>([])
  const [calibration, setCalibration] = useState<CalibrationRow[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [outcomes, vs, cal] = await Promise.all([
        eAPI().aepGetOutcomes?.(),
        eAPI().aepGetValueStream?.(),
        eAPI().aepGetCalibration?.(),
      ])

      const outcomeRows: OutcomeApiRow[] = Array.isArray(outcomes) ? outcomes : []
      setVerdicts(
        outcomeRows.map((r) => ({
          id: String(r.id),
          featureId: r.featureId,
          initiative: r.featureLabel,
          metric: r.kpiLabel,
          predicted: DICT.phrases.betLine(r.kpiLabel, r.direction, r.magnitudePct, r.timeframeDays),
          status: r.verdict,
          actualDeltaPct: r.actualDeltaPct,
          predictedMagnitude: r.magnitudePct,
          when: r.createdAt,
        })),
      )

      const features: ValueStreamFeature[] = Array.isArray(vs) ? vs : []
      const threads = await Promise.all(features.map((f) => eAPI().aepGetGoldenThread?.(f.id)))

      const orgMap = new Map<string, string[]>()
      for (const thread of threads) {
        const impacts = (thread && !thread.error ? thread.orgImpacts : []) as
          | { id: number; orgUnitLabel: string; summary: string }[]
          | undefined
        for (const imp of impacts ?? []) {
          if (!imp.summary) continue
          const list = orgMap.get(imp.orgUnitLabel) ?? []
          list.push(imp.summary)
          orgMap.set(imp.orgUnitLabel, list)
        }
      }
      setOrgImpacts(Array.from(orgMap.entries()).map(([orgUnitLabel, summaries]) => ({ orgUnitLabel, summaries })))

      setCalibration(Array.isArray(cal) ? cal : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const validatedCount = verdicts.filter((v) => v.status === 'validated').length
  const refutedCount = verdicts.filter((v) => v.status === 'refuted').length
  const inconclusiveCount = verdicts.filter((v) => v.status === 'inconclusive').length

  const calByAgent = new Map<string, CalibrationRow[]>()
  for (const row of calibration) {
    const list = calByAgent.get(row.agentId) ?? []
    list.push(row)
    calByAgent.set(row.agentId, list)
  }
  const agentGroups = Array.from(calByAgent.entries()).map(([agentId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.cycleEndDate.localeCompare(b.cycleEndDate)).slice(-4)
    const values = sorted.map((r) => r.meanErrorPct ?? 0)
    const trend = computeTrend(values)
    return { agentId, rows: sorted, values, trend }
  })

  const anyData = verdicts.length > 0 || orgImpacts.length > 0 || calibration.length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <p className="text-[15px] font-[600] text-ink-1">Outcomes</p>
        <p className="text-[12px] text-ink-3 mt-0.5">
          {validatedCount} paid off · {refutedCount} lesson{refutedCount === 1 ? '' : 's'} · {inconclusiveCount} inconclusive
        </p>
        <div className="flex gap-1 mt-3">
          {(
            [
              { id: 'verdicts' as const, label: 'Verdicts', count: verdicts.length },
              { id: 'team' as const, label: 'Per-team impact', count: orgImpacts.length },
              { id: 'calibration' as const, label: 'Agent calibration', count: agentGroups.length },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-colors ${
                tab === t.id ? 'bg-learn/10 text-learn font-[500]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'
              }`}
            >
              {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!loading && !anyData ? (
          <EmptyState
            verb="LEARN"
            title="No outcomes yet"
            body="Complete a demo cycle through Observe and Learn to see verdicts, team impact, and agent calibration here."
          />
        ) : (
          <>
            {tab === 'verdicts' && (
              <DataTable<VerdictRow>
                cols={[
                  { key: 'initiative', header: 'Initiative' },
                  { key: 'metric', header: 'Metric' },
                  { key: 'predicted', header: 'We predicted' },
                  {
                    key: 'actualDeltaPct',
                    header: 'What happened',
                    render: (row) => (
                      <span className={row.status === 'validated' ? 'text-ok' : 'text-ink-2'}>
                        {row.actualDeltaPct != null ? `${row.actualDeltaPct.toFixed(1)}%` : 'no data'} vs {row.predictedMagnitude}% predicted
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    header: 'Verdict',
                    render: (row) => (
                      <span className={row.status === 'validated' ? 'text-ok' : 'text-ink-3'}>
                        {row.status === 'validated' ? '✓ Validated' : row.status === 'refuted' ? '~ Refuted' : '· Inconclusive'}
                      </span>
                    ),
                  },
                  {
                    key: 'when',
                    header: 'When',
                    render: (row) => <span>{row.when ? new Date(row.when).toLocaleDateString() : '—'}</span>,
                  },
                ]}
                rows={verdicts}
                onRow={(row) => navigate(`/feature/${row.featureId}`)}
                emptyText="No verdicts yet"
              />
            )}

            {tab === 'team' &&
              (orgImpacts.length === 0 ? (
                <p className="text-[13px] text-ink-3">No team impact assessments recorded yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-4xl">
                  {orgImpacts.map((group) => {
                    const combined = group.summaries.join(' ')
                    const sentiment = sentimentOf(combined)
                    const sentences = splitSentences(combined)
                    const summary = sentences.slice(0, 2).join(' ')
                    const actions = sentences.slice(2, 5)
                    return (
                      <div key={group.orgUnitLabel} className="bg-surface-2 border border-line rounded-[12px] p-4 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[13px] font-[500] text-ink-1">{group.orgUnitLabel}</p>
                          <Badge variant={SENTIMENT_BADGE[sentiment]}>{sentiment}</Badge>
                        </div>
                        <p className="text-[12px] text-ink-2">{summary || 'No summary available yet.'}</p>
                        {actions.length > 0 && (
                          <div className="flex flex-col gap-0.5">
                            {actions.map((a, i) => (
                              <p key={i} className="text-[11px] text-ink-3">→ {a}</p>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(`${group.orgUnitLabel}\n${summary}`)
                            push({ message: 'Copied to clipboard', status: 'ok' })
                          }}
                          className="self-start text-[11px] text-ink-3 hover:text-ink-1 mt-1"
                        >
                          Share
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}

            {tab === 'calibration' &&
              (agentGroups.length === 0 ? (
                <p className="text-[13px] text-ink-3">No calibration data yet.</p>
              ) : (
                <div className="flex flex-col gap-3 max-w-2xl">
                  {agentGroups.map(({ agentId, rows, values, trend }) => {
                    const meta = TREND_META[trend]
                    const latest = rows[rows.length - 1]
                    return (
                      <div key={agentId} className="bg-surface-3 border border-line rounded-[10px] p-4 flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-[500] text-ink-1">{agentName(agentId)}</span>
                            <span className={`text-[13px] ${meta.color}`}>{meta.arrow}</span>
                          </div>
                          <p className="text-[12px] text-ink-3 mt-0.5">
                            {latest?.meanErrorPct != null ? `Mean error ${latest.meanErrorPct.toFixed(1)}%` : 'No error data yet'}
                          </p>
                          <p className="text-[11px] text-ink-3 mt-1">{trendInterpretation(trend, rows.length)}</p>
                        </div>
                        {values.length >= 2 && <Sparkline values={values} color={meta.color.includes('ok') ? '#2FBF8F' : meta.color.includes('danger') ? '#E25C5C' : '#6F747E'} />}
                      </div>
                    )
                  })}
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  )
}
