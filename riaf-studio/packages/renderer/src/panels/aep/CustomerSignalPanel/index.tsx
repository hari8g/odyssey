/**
 * panels/aep/CustomerSignalPanel/index.tsx
 * LISTEN room — bring customer feedback in, see the problems it clusters into.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  EmptyState,
  ProgressRibbon,
  usePeek,
  useToast,
} from '@/design/primitives'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type SourceKind = 'csv' | 'zendesk' | 'nps' | 'manual'

type PainPointRow = {
  id: number
  label: string
  description: string | null
  importance_score: number | null
  signal_count: number
}

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
      return {
        cohort: obj['cohort'] || 'manual',
        type: obj['type'] || 'feature_request',
        text: obj['text'] ?? '',
        date: obj['date'],
      }
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
      date: t['created_at'] ? String(t['created_at']) : (t['date'] ? String(t['date']) : undefined),
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

function ImportanceBar({ score }: { score: number | null }) {
  const pct = Math.round(Math.max(0, Math.min(1, score ?? 0)) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full rounded-full bg-listen transition-all duration-[250ms]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-ink-3 w-9 text-right">{pct}%</span>
    </div>
  )
}

function ProblemCard({
  pp,
  onPeekVoices,
  onStart,
  starting,
}: {
  pp: PainPointRow
  onPeekVoices: (pp: PainPointRow) => void
  onStart: (pp: PainPointRow) => void
  starting: boolean
}) {
  return (
    <Card verb="LISTEN" className="p-4 flex flex-col gap-3">
      <p className="text-[13px] font-[500] text-ink-1">{pp.label}</p>
      {pp.description && <p className="text-[12px] text-ink-3">{pp.description}</p>}
      <button
        type="button"
        onClick={() => onPeekVoices(pp)}
        className="self-start text-[11px] font-[500] text-ink-2 hover:text-ink-1 bg-surface-3 border border-line rounded-[999px] px-2.5 py-1 transition-colors"
      >
        {pp.signal_count} voice{pp.signal_count === 1 ? '' : 's'}
      </button>
      <ImportanceBar score={pp.importance_score} />
      <Button variant="secondary" loading={starting} onClick={() => onStart(pp)} className="self-start">
        Start an initiative →
      </Button>
    </Card>
  )
}

export function CustomerSignalPanel() {
  const navigate = useNavigate()
  const { push } = useToast()
  const { open } = usePeek()

  const [tab, setTab] = useState<'feedback' | 'problems'>('feedback')
  const [source, setSource] = useState<SourceKind>('csv')
  const [content, setContent] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [clustering, setClustering] = useState(false)
  const [starting, setStarting] = useState<number | null>(null)
  const [painPoints, setPainPoints] = useState<PainPointRow[]>([])
  const [signalCount, setSignalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [pp, stats] = await Promise.all([
      eAPI().aepGetPainPoints?.(),
      eAPI().uxGetHomeStats?.(),
    ])
    setPainPoints(Array.isArray(pp) ? pp : [])
    if (stats && !stats.error) setSignalCount(stats.signalCount ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  async function runClustering() {
    setClustering(true)
    try {
      const result = await eAPI().aepClusterPainPoints?.()
      if (result?.error) throw new Error(result.error)
      push({ message: `${result?.clusters?.length ?? 0} problem${(result?.clusters?.length ?? 0) === 1 ? '' : 's'} found`, status: 'ok' })
      await refresh()
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Clustering failed', status: 'danger' })
    } finally {
      setClustering(false)
    }
  }

  async function peekVoices(pp: PainPointRow) {
    open(<VoicesPeekBody painPointId={pp.id} />, `${pp.signal_count} voice${pp.signal_count === 1 ? '' : 's'} — ${pp.label}`)
  }

  async function startInitiative(pp: PainPointRow) {
    setStarting(pp.id)
    try {
      const res = await eAPI().cycleStart?.({ label: pp.label, mode: 'demo', painPointIds: [pp.id] })
      if (res?.error) throw new Error(res.error)
      navigate('/room/cycle')
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Could not start the cycle', status: 'danger' })
    } finally {
      setStarting(null)
    }
  }

  const noFeedbackAtAll = !loading && signalCount === 0 && painPoints.length === 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[15px] font-[600] text-ink-1">Customer Feedback</p>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {signalCount} voice{signalCount === 1 ? '' : 's'} · {painPoints.length} problem{painPoints.length === 1 ? '' : 's'}
          </p>
        </div>
        {tab === 'problems' && (
          <Button variant="secondary" loading={clustering} onClick={() => void runClustering()}>
            Run clustering
          </Button>
        )}
      </div>

      <div className="px-6 pt-3 flex-shrink-0">
        <div className="flex gap-1">
          {(
            [
              { id: 'feedback' as const, label: 'Customer Feedback', count: 0 },
              { id: 'problems' as const, label: 'Problems Found', count: painPoints.length },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-[12px] rounded-[6px] transition-colors ${
                tab === t.id ? 'bg-listen/10 text-listen font-[500]' : 'text-ink-3 hover:text-ink-1 hover:bg-surface-3'
              }`}
            >
              {t.label} {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'feedback' ? (
          <div className="max-w-xl flex flex-col gap-4">
            {noFeedbackAtAll && (
              <EmptyState
                verb="LISTEN"
                title="No customer feedback yet"
                body="Paste support tickets, survey comments, or interview notes — the system will find the patterns."
              />
            )}
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
        ) : painPoints.length === 0 ? (
          <EmptyState
            verb="LISTEN"
            title={noFeedbackAtAll ? 'No customer feedback yet' : 'No problems found yet'}
            body={
              noFeedbackAtAll
                ? 'Paste support tickets, survey comments, or interview notes — the system will find the patterns.'
                : 'Feedback is in — run clustering to find the patterns.'
            }
            action={{ label: 'Add feedback', onClick: () => setTab('feedback') }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-4xl">
            {painPoints.map((pp) => (
              <ProblemCard
                key={pp.id}
                pp={pp}
                onPeekVoices={() => void peekVoices(pp)}
                onStart={() => void startInitiative(pp)}
                starting={starting === pp.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function VoicesPeekBody({ painPointId }: { painPointId: number }) {
  const [signals, setSignals] = useState<{ id: number; label: string; description: string | null }[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void eAPI()
      .aepGetPainPointSignals?.(painPointId, 5)
      .then((res: unknown) => {
        if (!cancelled) setSignals(Array.isArray(res) ? res : [])
      })
    return () => {
      cancelled = true
    }
  }, [painPointId])

  if (signals === null) {
    return <ProgressRibbon label="Loading voices…" pct={null} />
  }
  if (signals.length === 0) {
    return <p className="text-[13px] text-ink-3">No sample voices recorded for this problem.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {signals.map((s) => (
        <div key={s.id} className="bg-surface-3 border border-line rounded-[8px] p-3">
          <p className="text-[13px] text-ink-1">{s.description ?? s.label}</p>
        </div>
      ))}
    </div>
  )
}
