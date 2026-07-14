/**
 * screens/story/FeatureStory.tsx
 * One initiative's whole life told as a narrative timeline.
 * The golden thread made human.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card, Badge, EvidenceChip, GateSeal, Timeline, ProgressRibbon,
  Button, EmptyState, usePeek, Term,
} from '@/design/primitives'
import { VERB_COLOR, STATUS_COLOR, type VerbKey } from '@/design/tokens'
import { DICT, t } from '@/design/dictionary'
import { useCycleStore } from '@/store/cycle.store'

// ── Stage narration helpers ───────────────────────────────────────────────────
type StageState = 'done' | 'active' | 'locked'

function stageToVerb(stage: string): VerbKey {
  const map: Record<string, VerbKey> = {
    SIGNALS: 'LISTEN', CLUSTER: 'LISTEN',
    INTAKE: 'DECIDE', QUALIFY: 'DECIDE', PACKET: 'DECIDE', PORTFOLIO_GATE: 'DECIDE',
    BUILD: 'BUILD',
    CONSOLIDATE: 'SHIP', RELEASE_GATE: 'SHIP', ROLLOUT: 'SHIP',
    OBSERVE: 'LEARN', LEARN: 'LEARN', DONE: 'LEARN',
  }
  return map[stage] ?? 'BUILD'
}

// Past-tense narrative per completed stage (shown collapsed)
const DONE_LINES: Record<string, (d: DoneData) => string> = {
  SIGNALS:         d => `${d.count ?? '?'} customers voiced the problem`,
  CLUSTER:         d => `Synthesized into ${d.count ?? '?'} named problem${d.count !== 1 ? 's' : ''}`,
  INTAKE:          d => `Case for action written and classified`,
  QUALIFY:         d => `Sized at ${d.effort ?? '?'} and worth ${d.value ?? '?'}`,
  PACKET:          d => `Decision packet assembled and ready for the forum`,
  PORTFOLIO_GATE:  d => `Admitted by ${d.role ?? 'the forum'} — bets locked`,
  BUILD:           d => `${d.count ?? '?'} files traced, ${d.builds ?? '?'} builds`,
  CONSOLIDATE:     d => `Readiness confirmed — ${d.gaps ?? 'no'} gaps, ${d.scopes ?? '4'} scopes clear`,
  RELEASE_GATE:    d => `All ${d.count ?? '?'} required signatures recorded`,
  ROLLOUT:         d => `Deployed to production — ${d.strategy ?? 'canary'} rollout`,
  OBSERVE:         d => `${d.count ?? '?'} measurements taken over ${d.days ?? '?'} days`,
  LEARN:           d => `${d.validated ?? 0} bet${d.validated !== 1 ? 's' : ''} validated · ${d.lessons ?? 0} lesson${d.lessons !== 1 ? 's' : ''} distilled`,
}
type DoneData = { count?: number; effort?: string; value?: string; role?: string; gaps?: number; builds?: number; scopes?: number; strategy?: string; days?: number; validated?: number; lessons?: number }

// ── Stage narrative rows ──────────────────────────────────────────────────────
function StageRow({
  stageId, state, title, narrative, verb, children, artifacts = [],
  bounceFrom, peekContent,
}: {
  stageId: string; state: StageState; title: string; narrative: string
  verb: VerbKey; children?: React.ReactNode; artifacts?: { label: string; kind: string; id: number }[]
  bounceFrom?: string; peekContent?: React.ReactNode
}) {
  const col = VERB_COLOR[verb]
  const { open } = usePeek()

  return (
    <div className="relative">
      {/* Connector line */}
      <div className="absolute left-[19px] top-8 bottom-0 w-px bg-line" />
      <div className="flex gap-4 pb-5">
        {/* Step indicator */}
        <div className={`relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
          state === 'done'   ? 'bg-surface-2 border-line' :
          state === 'active' ? 'border-2' : 'bg-surface-1 border-line/40'
        }`}
          style={state === 'active' ? { borderColor: col.full, background: col.soft } : undefined}>
          {state === 'done'   && <span className="text-ink-3 text-[12px]">✓</span>}
          {state === 'active' && <span className="text-[14px]" style={{ color: col.full }}>●</span>}
          {state === 'locked' && <span className="text-ink-3/30 text-[12px]">○</span>}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Bounce annotation */}
          {bounceFrom && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-danger">
              <span>↩</span><span>Sent back from {bounceFrom} — {narrative}</span>
            </div>
          )}

          <div className="flex items-baseline gap-2 mb-0.5">
            <p className={`text-[13px] font-[500] ${state === 'locked' ? 'text-ink-3' : 'text-ink-1'}`}>
              {title}
            </p>
            {state === 'active' && (
              <Badge verb={verb} dot>{DICT.stage[verb].title}</Badge>
            )}
          </div>

          {state !== 'locked' && (
            <p className="text-[12px] text-ink-3 mb-2">{narrative}</p>
          )}

          {/* Artifacts as evidence chips */}
          {state === 'done' && artifacts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {artifacts.map(a => (
                <EvidenceChip key={a.id} kind={a.kind} label={a.label}
                  onClick={() => open(peekContent ?? <p className="text-ink-2">{a.label}</p>, t(a.kind))} />
              ))}
            </div>
          )}

          {/* Active stage content (AgentProgress / WaitBlock / GateBlock) */}
          {state === 'active' && children && (
            <div className="mt-3">{children}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Wait block ────────────────────────────────────────────────────────────────
function WaitBlock({ reason, simulate, onSimulate }: { reason?: string; simulate?: string; onSimulate?: () => void }) {
  return (
    <div className="bg-surface-3 border border-line rounded-[10px] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="text-warn text-sm mt-0.5">⏳</span>
        <div>
          <p className="text-[12px] font-[500] text-ink-1">Waiting on the world</p>
          {reason && <p className="text-[11px] text-ink-3 mt-0.5">{reason}</p>}
        </div>
      </div>
      {simulate && onSimulate && (
        <Button variant="ghost" onClick={onSimulate} className="self-start text-[11px]">
          ⚡ {simulate}
        </Button>
      )}
    </div>
  )
}

// ── Agent progress block ──────────────────────────────────────────────────────
function AgentProgressBlock({ agents, pct, detail }: { agents: string[]; pct: number | null; detail?: string }) {
  return (
    <div className="bg-surface-3 border border-line rounded-[10px] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5 mb-1">
        {agents.map(a => (
          <span key={a} className="text-[10px] font-[600] px-2 py-0.5 rounded-[999px] bg-accent/10 border border-accent/30 text-accent">{a}</span>
        ))}
        <span className="text-[11px] text-ink-3 self-center ml-1">{pct === null ? 'working…' : `${pct}%`}</span>
      </div>
      <ProgressRibbon label={detail ?? 'Agent working…'} pct={pct} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE STORY
// ═════════════════════════════════════════════════════════════════════════════
export function FeatureStory() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { progress } = useCycleStore()
  const [story, setStory] = useState<any>(null)
  const [run, setRun]   = useState<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [isEngineer, setIsEngineer] = useState(false)
  const api = window.electronAPI as any

  useEffect(() => {
    if (!id) return
    setLoaded(false)
    Promise.all([
      api.uxGetFeatureStory?.(parseInt(id, 10)),
      api.cycleList?.() ?? [],
    ]).then(([s, runs]: [any, any]) => {
      setStory(s && !s.error ? s : null)
      const list = Array.isArray(runs) ? runs : []
      const linked = list.find((r: any) => r.feature_node_id === parseInt(id!, 10))
      if (linked) setRun(linked)
      else if (s?.run) setRun(s.run)
      setLoaded(true)
    })
  }, [id])

  if (!loaded) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-ink-3 text-[13px] animate-pulse">Loading story…</p>
    </div>
  )

  if (!story) return (
    <div className="flex items-center justify-center h-full p-8">
      <EmptyState
        verb="DEFINE"
        title="No story for this feature"
        body="Open the Journey Canvas and pick an initiative that has a feature node."
        action={{ label: 'Back to Journey', onClick: () => navigate('/journey') }}
      />
    </div>
  )

  const currentStageIdx = run ? ['SIGNALS','CLUSTER','INTAKE','QUALIFY','PACKET','PORTFOLIO_GATE','BUILD','CONSOLIDATE','RELEASE_GATE','ROLLOUT','OBSERVE','LEARN','DONE'].indexOf(run.current_stage) : -1

  const NARRATIVE_STAGES = [
    { id: 'SIGNALS',        title: 'Customer voices heard',           narrative: `${story.signals?.length ?? 0} pieces of feedback captured from real customers` },
    { id: 'CLUSTER',        title: 'Problems named',                   narrative: `${story.painPoints?.length ?? 0} distinct problems identified` },
    { id: 'INTAKE',         title: 'Case for action written',          narrative: 'Classified, deduplicated, and routed' },
    { id: 'QUALIFY',        title: 'Sized and valued',                 narrative: 'Business case and engineering effort estimated as ranges' },
    { id: 'PACKET',         title: 'Decision packet ready',            narrative: 'Forum materials assembled' },
    { id: 'PORTFOLIO_GATE', title: 'Forum decided — bets locked',      narrative: 'Pre-registered predictions committed before code exists' },
    { id: 'BUILD',          title: 'Building',                         narrative: 'Teams working; CI tracking progress automatically' },
    { id: 'CONSOLIDATE',    title: 'Readiness checked',                narrative: '4 scopes verified — code, tests, operations, organization' },
    { id: 'RELEASE_GATE',   title: 'Release signed off',               narrative: 'All required roles confirmed' },
    { id: 'ROLLOUT',        title: 'Deployed',                         narrative: 'Staged rollout with automatic guard checks' },
    { id: 'OBSERVE',        title: 'Measuring the bet',                narrative: 'KPIs tracked against pre-registered predictions' },
    { id: 'LEARN',          title: 'Verdict and lessons',              narrative: 'Did the bet pay off? What do we carry forward?' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-line flex-shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <button onClick={() => navigate('/journey')} className="text-[11px] text-ink-3 hover:text-ink-1">← Journey</button>
            </div>
            <h1 className="text-[18px] font-[600] text-ink-1 mb-1">{story.title}</h1>
            {story.originProblem && (
              <p className="text-[13px] text-ink-3">
                "{story.originProblem}" — <button className="text-accent underline underline-offset-2">{story.signalCount ?? 0} voices</button>
              </p>
            )}
          </div>
          {run && (
            <Badge verb={stageToVerb(run.current_stage)} dot>
              {DICT.status[run.status as keyof typeof DICT.status] ?? run.current_stage}
            </Badge>
          )}
          {!isEngineer && (
            <Button variant="ghost" onClick={() => setIsEngineer(true)} className="text-[11px]">
              Engineering view
            </Button>
          )}
        </div>

        {/* Bets summary */}
        {story.bets && story.bets.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {story.bets.map((b: any, i: number) => (
              <span key={i} className="text-[11px] bg-decide/10 border border-decide/30 text-decide-text px-2 py-0.5 rounded-[4px]">
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="flex-1 overflow-y-auto flex">
        {/* Story timeline */}
        <div className="flex-1 px-6 py-5 overflow-y-auto">
          <div className="max-w-xl">
            {NARRATIVE_STAGES.map((stage, idx) => {
              const state: StageState = idx < currentStageIdx ? 'done'
                : idx === currentStageIdx ? 'active' : 'locked'
              const verb = stageToVerb(stage.id)
              const isWaiting = run?.status === 'waiting_external' && idx === currentStageIdx
              const isRunning = run?.status === 'running' && idx === currentStageIdx
              const isGate    = run?.status === 'waiting_gate' && idx === currentStageIdx

              return (
                <StageRow key={stage.id} stageId={stage.id} state={state}
                  title={stage.title} narrative={stage.narrative} verb={verb}>
                  {isRunning && (
                    <AgentProgressBlock
                      agents={progress?.stage === stage.id ? [progress.stage] : ['working']}
                      pct={progress?.stage === stage.id ? progress.pct : null}
                      detail={progress?.detail}
                    />
                  )}
                  {isWaiting && (
                    <WaitBlock reason={run?.error ?? undefined}
                      simulate={run?.mode === 'demo' ? 'Simulate progress' : undefined}
                      onSimulate={() => {
                        if (!run?.id) return
                        if (stage.id === 'SIGNALS') void api.cycleSimulateSignals?.(run.id)
                        else if (stage.id === 'BUILD') void api.cycleSimulateCI?.(run.id)
                        else void api.cycleSimulateKpi?.(run.id, 0.9)
                      }}
                    />
                  )}
                  {isGate && (
                    <Button variant="primary" onClick={() => navigate(`/gate/${run.id}/${stage.id}`)}>
                      Go to decision room →
                    </Button>
                  )}
                </StageRow>
              )
            })}
          </div>
        </div>

        {/* Right rail */}
        <div className="w-72 border-l border-line px-4 py-5 flex-shrink-0 overflow-y-auto flex flex-col gap-5">
          {/* The bets */}
          {story.bets && story.bets.length > 0 && (
            <div>
              <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">The bets</p>
              <div className="flex flex-col gap-2">
                {story.bets.map((b: any, i: number) => (
                  <div key={i} className="bg-surface-3 border border-line rounded-[8px] p-3">
                    <p className="text-[12px] text-ink-1 leading-snug">{b.label}</p>
                    <p className="text-[11px] text-ink-3 mt-1">
                      Confidence: {(b.priorConf * 100).toFixed(0)}%
                    </p>
                    {b.verdict && (
                      <p className="text-[11px] mt-1 font-[500]" style={{ color: b.validated ? '#2FBF8F' : '#E8A13C' }}>
                        {b.validated ? '✓ Paid off' : '~ Lesson taken'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rules & regulations */}
          {story.regulations && story.regulations.length > 0 && (
            <div>
              <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Regulations touched</p>
              <div className="flex flex-col gap-1.5">
                {story.regulations.map((r: any) => (
                  <div key={r.id} className="flex items-center gap-2 text-[12px]">
                    <span className="text-warn">⚠</span>
                    <span className="text-ink-2">{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Who's involved */}
          {story.involvedRoles && story.involvedRoles.length > 0 && (
            <div>
              <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Who's involved</p>
              <div className="flex flex-wrap gap-1.5">
                {story.involvedRoles.map((r: string) => (
                  <span key={r} className="text-[11px] bg-surface-3 border border-line rounded-[999px] px-2.5 py-1 text-ink-2">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Engineering view (conditional) */}
          {isEngineer && (
            <div>
              <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Engineering detail</p>
              <Button variant="ghost" onClick={() => navigate(`/room/impact?feature=${id}`)} className="text-[11px] w-full">
                Open in Impact room →
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
