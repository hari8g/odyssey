import { useEffect, useState } from 'react'
import { EmptyState } from '@/design/primitives'
import { useUXStore } from '@/store/ux/ux.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

function VerdictCard({ v }: { v: { id: number; label: string; description: string | null } }) {
  let parsed: { validated?: boolean; kpi?: string; actualDelta?: number; attributionMethod?: string } =
    {}
  try {
    parsed = v.description ? JSON.parse(v.description) : {}
  } catch {
    parsed = {}
  }
  const ok = !!parsed.validated
  const col = ok ? '#2FBF8F' : '#A9ADB6'
  const phrase = ok
    ? `The bet paid off — ${parsed.kpi ?? v.label} moved ${parsed.actualDelta?.toFixed(1) ?? '?'}%`
    : `The bet did not pay off — ${parsed.kpi ?? v.label}. That is a lesson, not a failure.`
  return (
    <div
      className="rounded-[10px] border bg-surface-3 p-4"
      style={{ borderLeftWidth: '3px', borderLeftColor: col }}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg flex-shrink-0">{ok ? '✓' : '~'}</span>
        <div>
          <p className="text-[13px] font-[500] text-ink-1">{phrase}</p>
          <p className="text-[11px] text-ink-3 mt-1">{v.label}</p>
        </div>
      </div>
    </div>
  )
}

function LessonCard({ l }: { l: { id: number; label: string; description: string | null } }) {
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
            <span
              key={i}
              className="text-[10px] bg-surface-3 border border-line rounded-[4px] px-2 py-0.5 text-ink-3"
            >
              informs: {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function LearnHub() {
  const [tab, setTab] = useState<'verdicts' | 'lessons' | 'calibration'>('verdicts')
  const { verdicts, learnings, refreshHome } = useUXStore()
  const [calibration, setCalibration] = useState<
    Array<{ agentId: string; meanErrorPct: number | null; trend?: string; recommendation?: string }>
  >([])

  useEffect(() => {
    void refreshHome()
    void eAPI()
      .aepGetCalibration?.()
      .then((c: unknown) => {
        if (Array.isArray(c)) setCalibration(c as typeof calibration)
      })
  }, [refreshHome])

  const TABS = [
    { id: 'verdicts' as const, label: 'Verdicts', count: verdicts.length },
    { id: 'lessons' as const, label: 'Lessons', count: learnings.length },
    { id: 'calibration' as const, label: 'Getting better?', count: 0 },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <p className="text-[15px] font-[600] text-ink-1">Learn Hub</p>
        <p className="text-[12px] text-ink-3 mt-0.5">
          {verdicts.length} verdicts · {learnings.length} lessons distilled
        </p>
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
        {tab === 'verdicts' &&
          (verdicts.length === 0 ? (
            <EmptyState
              verb="LEARN"
              title="No verdicts yet"
              body="Verdicts appear after a deployment's measurement window closes."
            />
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              {verdicts.map((v) => (
                <VerdictCard key={v.id} v={v} />
              ))}
            </div>
          ))}

        {tab === 'lessons' &&
          (learnings.length === 0 ? (
            <EmptyState
              verb="LEARN"
              title="No lessons yet"
              body="Lessons are distilled by A14 after verdicts are issued."
            />
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              {learnings.map((l) => (
                <LessonCard key={l.id} l={l} />
              ))}
            </div>
          ))}

        {tab === 'calibration' && (
          <div className="max-w-2xl flex flex-col gap-4">
            <p className="text-[13px] text-ink-2">
              Calibration tracks how accurate our estimates are, cycle over cycle.
            </p>
            {calibration.length === 0 ? (
              <p className="text-[13px] text-ink-3">No calibration data yet.</p>
            ) : (
              calibration.map((c) => (
                <div key={c.agentId} className="bg-surface-3 border border-line rounded-[10px] p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-[500] text-ink-1">{c.agentId}</span>
                    {c.meanErrorPct != null && (
                      <span className="text-[12px] text-ink-3">
                        Mean error: {c.meanErrorPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {c.recommendation && (
                    <p className="text-[12px] text-ink-3">{c.recommendation}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
