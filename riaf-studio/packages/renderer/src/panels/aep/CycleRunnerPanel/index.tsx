import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  RefreshCcw,
  Play,
  Square,
  CheckCircle2,
  Lock,
  Loader2,
  Circle,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { CycleStage } from '@shared/index'
import {
  useCycleStore,
  STAGE_ORDER,
  STAGE_META,
  agentName,
  type CycleRun,
} from '@/store/cycle.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type LearningRow = {
  id: number
  label: string
  adjustment?: string
  targets?: string[]
  informs_count?: number
  painPointIds?: number[]
}

function LoopCard({
  onStartNext,
}: {
  onStartNext: (painPointIds: number[]) => void
}) {
  const [learnings, setLearnings] = useState<LearningRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await eAPI().aepGetLearnings?.()
        if (!cancelled && Array.isArray(res)) {
          setLearnings(res.slice(0, 5) as LearningRow[])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const painPointIds = useMemo(() => {
    const ids = new Set<number>()
    for (const l of learnings) {
      for (const id of l.painPointIds ?? []) ids.add(id)
    }
    return [...ids]
  }, [learnings])

  if (loading) {
    return (
      <div className="mx-4 mb-3 rounded-lg border border-learn/30 bg-learn/5 px-3 py-2 text-[11px] text-gray-500 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-learn" />
        Loading lessons…
      </div>
    )
  }

  if (learnings.length === 0) {
    return (
      <div className="mx-4 mb-3 rounded-lg border border-border/60 bg-surface-3/40 px-3 py-2 text-[11px] text-gray-500">
        Complete LEARN to distill lessons that inform the next cycle.
      </div>
    )
  }

  return (
    <div className="mx-4 mb-3 rounded-lg border border-learn/40 bg-learn/5 px-3 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-learn font-semibold">↺ Loop</span>
        <span className="text-[11px] text-gray-400">Lessons ready for the next cycle</span>
      </div>
      <ul className="space-y-2">
        {learnings.map((l) => (
          <li key={l.id} className="text-[12px] text-gray-200">
            <div className="font-medium">💡 {l.label}</div>
            {l.adjustment && (
              <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{l.adjustment}</p>
            )}
            {(l.targets?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {l.targets!.slice(0, 4).map((t, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-learn/30 bg-learn/10 text-learn"
                  >
                    INFORMS · {t}
                  </span>
                ))}
                {(l.informs_count ?? 0) > 4 && (
                  <span className="text-[10px] text-gray-600">+{(l.informs_count ?? 0) - 4}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onStartNext(painPointIds)}
        className="text-[11px] px-2.5 py-1.5 rounded bg-learn/20 border border-learn/40 text-learn hover:bg-learn/30 font-medium"
      >
        Start next cycle →
      </button>
    </div>
  )
}

function stageIndex(stage: CycleStage): number {
  return STAGE_ORDER.indexOf(stage)
}

function cardState(
  stage: CycleStage,
  run: CycleRun | undefined,
): 'done' | 'active' | 'locked' {
  if (!run) return 'locked'
  const cur = stageIndex(run.current_stage)
  const i = stageIndex(stage)
  if (run.status === 'completed' || i < cur) return 'done'
  if (i === cur) return 'active'
  return 'locked'
}

const DECIDE_STAGES: CycleStage[] = ['INTAKE', 'QUALIFY', 'PACKET', 'PORTFOLIO_GATE']

export function CycleRunnerPanel() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const ppIdParam = params.get('ppId')

  const {
    runs,
    activeRunId,
    timeline,
    progress,
    setRuns,
    setActive,
    setTimeline,
    upsertRun,
  } = useCycleStore()

  const [busy, setBusy] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [label, setLabel] = useState('Demo cycle')
  const [mode, setMode] = useState<'live' | 'demo'>('demo')
  const [error, setError] = useState<string | null>(null)
  const [painPointIds, setPainPointIds] = useState<number[]>(
    ppIdParam && Number.isFinite(Number(ppIdParam)) ? [Number(ppIdParam)] : [],
  )

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId),
    [runs, activeRunId],
  )

  const refresh = useCallback(async () => {
    const list = (await eAPI().cycleList?.()) ?? []
    setRuns(Array.isArray(list) ? list : [])
    if (activeRunId) {
      const tl = (await eAPI().cycleTimeline?.(activeRunId)) ?? []
      setTimeline(Array.isArray(tl) ? tl : [])
      const run = await eAPI().cycleGet?.(activeRunId)
      if (run && !run.error) upsertRun(run)
    }
  }, [activeRunId, setRuns, setTimeline, upsertRun])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (ppIdParam && Number.isFinite(Number(ppIdParam))) {
      setPainPointIds([Number(ppIdParam)])
      setShowNew(true)
      setLabel(`Initiative from problem #${ppIdParam}`)
      setMode('demo')
    }
  }, [ppIdParam])

  useEffect(() => {
    const unsub = eAPI().onCycleUpdate?.((r: unknown) => {
      if (r && typeof r === 'object' && 'id' in (r as object)) {
        upsertRun(r as CycleRun)
      }
    })
    return () => unsub?.()
  }, [upsertRun])

  useEffect(() => {
    if (!activeRunId) return
    void eAPI()
      .cycleTimeline?.(activeRunId)
      .then((tl: unknown) => {
        if (Array.isArray(tl)) setTimeline(tl)
      })
  }, [activeRunId, activeRun?.updated_at, setTimeline])

  const startCycle = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await eAPI().cycleStart?.({
        label: label.trim() || 'Cycle',
        mode,
        painPointIds: painPointIds.length > 0 ? painPointIds : undefined,
      })
      if (res?.error) throw new Error(res.error)
      setShowNew(false)
      if (res?.runId) setActive(res.runId)
      await refresh()
      const run = await eAPI().cycleGet?.(res.runId)
      if (run && !run.error) upsertRun(run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const abortCycle = async () => {
    if (!activeRunId) return
    if (!confirm('Abort this cycle run?')) return
    setBusy(true)
    try {
      await eAPI().cycleAbort?.(activeRunId)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const advance = async () => {
    if (!activeRunId) return
    setBusy(true)
    setError(null)
    try {
      const res = await eAPI().cycleAdvance?.(activeRunId)
      if (res?.error) throw new Error(res.error)
      const run = await eAPI().cycleGet?.(activeRunId)
      if (run && !run.error) upsertRun(run)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const simulate = async (kind: 'signals' | 'ci' | 'kpi') => {
    if (!activeRunId) return
    setBusy(true)
    setError(null)
    try {
      let res
      if (kind === 'signals') res = await eAPI().cycleSimulateSignals?.(activeRunId)
      else if (kind === 'ci') res = await eAPI().cycleSimulateCI?.(activeRunId)
      else res = await eAPI().cycleSimulateKpi?.(activeRunId, 0.9)
      if (res?.error) throw new Error(res.error)
      const run = await eAPI().cycleGet?.(activeRunId)
      if (run && !run.error) upsertRun(run)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openDecideRoom = () => {
    if (!activeRunId || !activeRun) return
    const gate =
      activeRun.current_stage === 'RELEASE_GATE' ? 'RELEASE_GATE' : 'PORTFOLIO_GATE'
    navigate(`/gate/${activeRunId}/${gate}`)
  }

  const portfolioAdmit = async () => {
    if (!activeRunId) return
    // Prefer the full Decide Room — Admit here is a quick demo path
    if (!activeRun?.feature_node_id) {
      setError('No feature on this run yet — wait for INTAKE to finish, then Advance.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await eAPI().cyclePortfolioGate?.(activeRunId, {
        decision: 'admit',
        approvedByRole: 'Product Owner',
        rationale: 'Admitted via Cycle Runner quick-admit',
        featureNodeId: activeRun.feature_node_id,
      })
      if (res?.error) throw new Error(res.error)
      const run = await eAPI().cycleGet?.(activeRunId)
      if (run && !run.error) upsertRun(run)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const signRelease = async () => {
    if (!activeRunId) return
    setBusy(true)
    setError(null)
    try {
      const res = await eAPI().cycleSignRelease?.(
        activeRunId,
        'Engineering Lead',
        'Signed via Cycle Runner',
      )
      if (res?.error) throw new Error(res.error)
      const run = await eAPI().cycleGet?.(activeRunId)
      if (run && !run.error) upsertRun(run)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const inDecide = activeRun && DECIDE_STAGES.includes(activeRun.current_stage)
  const showLoop =
    activeRun &&
    (activeRun.status === 'completed' ||
      activeRun.current_stage === 'DONE' ||
      activeRun.current_stage === 'LEARN')

  const startNextFromLessons = (ids: number[]) => {
    setPainPointIds(ids)
    setLabel('Cycle 2 — informed by lessons')
    setMode(activeRun?.mode === 'live' ? 'live' : 'demo')
    setShowNew(true)
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <header className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2">
        <RefreshCcw size={14} className="text-accent" />
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">
          Cycle Runner
          {inDecide ? <span className="ml-2 text-decide normal-case tracking-normal">· Decide</span> : null}
        </h2>
        <select
          className="text-xs bg-surface-3 border border-border rounded px-2 py-1 text-gray-300 max-w-[180px]"
          value={activeRunId ?? ''}
          onChange={(e) => setActive(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select run…</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              #{r.id} {r.label} · {r.current_stage}
            </option>
          ))}
        </select>
        {activeRun && (
          <span
            className={clsx(
              'text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border',
              activeRun.mode === 'demo'
                ? 'text-warn border-warn/40 bg-warn/10'
                : 'text-accent-2 border-accent-2/40 bg-accent-2/10',
            )}
          >
            {activeRun.mode}
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-surface-3"
          title="Refresh"
        >
          <RefreshCcw size={14} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowNew(true)}
          className="text-xs px-2 py-1 rounded bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-50"
        >
          New Cycle
        </button>
        {activeRun && !['completed', 'aborted'].includes(activeRun.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void abortCycle()}
            className="p-1.5 rounded text-red-400 hover:bg-red-400/10"
            title="Abort"
          >
            <Square size={14} />
          </button>
        )}
      </header>

      {error && (
        <div className="px-4 py-2 text-xs text-red-400 border-b border-border bg-red-400/5 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            className="underline text-red-300"
            onClick={() => {
              setError(null)
              void advance()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {progress && activeRunId === progress.runId && (
        <div className="px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <Loader2 size={12} className="animate-spin text-accent" />
            <span>
              {progress.stage} — {progress.detail}
            </span>
            <span className="ml-auto font-mono text-accent">{progress.pct}%</span>
          </div>
          <div className="h-1 bg-surface-3 rounded overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {showLoop && <LoopCard onStartNext={startNextFromLessons} />}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {!activeRun && (
            <p className="text-sm text-gray-500">
              Start a new cycle (demo mode recommended) to walk Listen → Decide → Build → Learn.
              {painPointIds.length > 0
                ? ' A pain point is pre-selected — Start will enter Decide at INTAKE.'
                : ''}
            </p>
          )}
          {STAGE_ORDER.map((stage) => {
            const state = cardState(stage, activeRun)
            const meta = STAGE_META[stage]
            return (
              <div
                key={stage}
                className={clsx(
                  'rounded-lg border px-3 py-2 transition-colors',
                  state === 'active' && 'border-accent/50 bg-accent/5',
                  state === 'done' && 'border-border/60 bg-surface-3/40',
                  state === 'locked' && 'border-border/40 opacity-50',
                  DECIDE_STAGES.includes(stage) && state === 'active' && 'border-decide/50',
                )}
              >
                <div className="flex items-start gap-2">
                  {state === 'done' ? (
                    <CheckCircle2 size={14} className="text-accent-2 mt-0.5 shrink-0" />
                  ) : state === 'active' ? (
                    <Circle size={14} className="text-accent mt-0.5 shrink-0 fill-accent/30" />
                  ) : (
                    <Lock size={14} className="text-gray-600 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-200">{meta.title}</div>
                    {(state === 'active' || state === 'locked') && (
                      <div className="text-[11px] text-gray-500 mt-0.5">{meta.narrative}</div>
                    )}
                    {state === 'active' && activeRun && (
                      <div className="mt-2 space-y-2">
                        <div className="text-[11px] text-gray-400 font-mono">
                          status={activeRun.status}
                          {activeRun.error ? ` · ${activeRun.error}` : ''}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void advance()}
                            className="text-[11px] px-2 py-1 rounded border border-border text-gray-300 hover:bg-surface-3 inline-flex items-center gap-1"
                          >
                            <Play size={11} />{' '}
                            {activeRun.status === 'error' ? 'Retry stage' : 'Advance'}
                          </button>
                          {activeRun.mode === 'demo' && stage === 'SIGNALS' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void simulate('signals')}
                              className="text-[11px] px-2 py-1 rounded border border-warn/40 text-warn hover:bg-warn/10"
                            >
                              Simulate signals
                            </button>
                          )}
                          {activeRun.mode === 'demo' && stage === 'BUILD' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void simulate('ci')}
                              className="text-[11px] px-2 py-1 rounded border border-warn/40 text-warn hover:bg-warn/10"
                            >
                              Simulate CI
                            </button>
                          )}
                          {activeRun.mode === 'demo' && stage === 'OBSERVE' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void simulate('kpi')}
                              className="text-[11px] px-2 py-1 rounded border border-warn/40 text-warn hover:bg-warn/10"
                            >
                              Simulate KPI ×1
                            </button>
                          )}
                          {stage === 'PORTFOLIO_GATE' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={openDecideRoom}
                                className="text-[11px] px-2 py-1 rounded border border-decide/40 text-decide hover:bg-decide/10 font-medium"
                              >
                                Open Decide Room
                              </button>
                              <button
                                type="button"
                                disabled={busy || !activeRun.feature_node_id}
                                onClick={() => void portfolioAdmit()}
                                className="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10"
                                title={
                                  !activeRun.feature_node_id
                                    ? 'Waiting for feature from INTAKE'
                                    : 'Quick-admit without the full forum UI'
                                }
                              >
                                Quick admit
                              </button>
                            </>
                          )}
                          {stage === 'RELEASE_GATE' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={openDecideRoom}
                                className="text-[11px] px-2 py-1 rounded border border-ship/40 text-ship hover:bg-ship/10 font-medium"
                              >
                                Open Decide Room
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void signRelease()}
                                className="text-[11px] px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10"
                              >
                                Sign (Eng Lead)
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <aside className="w-64 shrink-0 border-l border-border overflow-y-auto bg-surface/40">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-border">
            Timeline
          </div>
          <ul className="p-2 space-y-1.5">
            {timeline.length === 0 && (
              <li className="text-[11px] text-gray-600 px-1">No events yet</li>
            )}
            {timeline.map((row, i) => (
              <li key={`${row.ts}-${i}`} className="text-[11px] text-gray-400 px-1">
                <span className="text-gray-600 font-mono">
                  {new Date(row.ts).toLocaleTimeString()}
                </span>{' '}
                <span className="text-accent">{row.stage}</span> · {row.event}
                {row.agent_id ? ` · ${agentName(row.agent_id)}` : ''}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {showNew && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-surface border border-border rounded-lg p-4 w-80 shadow-xl space-y-3">
            <h3 className="text-sm font-medium text-gray-200">New Cycle</h3>
            <label className="block text-[11px] text-gray-500">
              Label
              <input
                className="mt-1 w-full text-xs bg-surface-3 border border-border rounded px-2 py-1.5 text-gray-200"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="block text-[11px] text-gray-500">
              Mode
              <select
                className="mt-1 w-full text-xs bg-surface-3 border border-border rounded px-2 py-1.5 text-gray-200"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'live' | 'demo')}
              >
                <option value="demo">Demo (&lt;10 min)</option>
                <option value="live">Live</option>
              </select>
            </label>
            {painPointIds.length > 0 && (
              <p className="text-[11px] text-decide">
                Starting at INTAKE with pain point {painPointIds.join(', ')}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="text-xs px-2 py-1 text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void startCycle()}
                className="text-xs px-3 py-1.5 rounded bg-accent text-white disabled:opacity-50"
              >
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
