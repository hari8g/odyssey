/**
 * screens/story/FeatureStory.tsx
 * One initiative's whole life told as a narrative timeline.
 * The golden thread made human.
 */
import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Badge, EvidenceChip, ProgressRibbon,
  Button, EmptyState, usePeek,
} from '@/design/primitives'
import { VERB_COLOR, type VerbKey } from '@/design/tokens'
import { DICT, t } from '@/design/dictionary'
import { useCycleStore } from '@/store/cycle.store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

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

type GraphNodeCache = Record<number, { id: number; kind: string; label: string; description: string | null }>

// ── Stage narrative rows ──────────────────────────────────────────────────────
function StageRow({
  stageId, state, title, narrative, verb, children, artifacts = [],
  bounceReason, onOpenArtifact,
}: {
  stageId: string; state: StageState; title: string; narrative: string
  verb: VerbKey; children?: React.ReactNode
  artifacts?: { id: number; kind: string; label: string }[]
  bounceReason?: string
  onOpenArtifact: (nodeId: number) => void
}) {
  const col = VERB_COLOR[verb]
  void stageId

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
          {state === 'locked' && <span className="text-ink-3/30 text-[12px]">🔒</span>}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Bounce annotation */}
          {bounceReason && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-danger">
              <span>↩</span><span>Sent back — {bounceReason}</span>
            </div>
          )}

          <div className="flex items-baseline gap-2 mb-0.5">
            <p className={`text-[13px] font-[500] ${state === 'locked' ? 'text-ink-3 opacity-40' : 'text-ink-1'}`}>
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
                  onClick={() => onOpenArtifact(a.id)} />
              ))}
            </div>
          )}

          {/* Active stage content (AgentProgress / WaitBlock / GateBlock / ErrorBlock) */}
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

// ── Error block ────────────────────────────────────────────────────────────────
function ErrorBlock({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="bg-danger/10 border border-danger/30 rounded-[10px] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <span className="text-danger text-sm mt-0.5">✕</span>
        <div>
          <p className="text-[12px] font-[500] text-ink-1">Needs attention</p>
          {error && <p className="text-[11px] text-danger mt-0.5">{error}</p>}
        </div>
      </div>
      <Button variant="danger" onClick={onRetry} className="self-start text-[11px]">
        Retry
      </Button>
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
  const { open } = usePeek()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [story, setStory] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [run, setRun] = useState<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [isEngineer, setIsEngineer] = useState(false)
  const [nodeCache, setNodeCache] = useState<GraphNodeCache>({})
  const [fisResults, setFisResults] = useState<Array<Record<string, unknown>> | null>(null)
  const [fisRunning, setFisRunning] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoaded(false)
    Promise.all([
      eAPI().uxGetFeatureStory?.(parseInt(id, 10)),
      eAPI().cycleList?.() ?? [],
    ]).then(([s, runs]: [any, any]) => {
      setStory(s && !s.error ? s : null)
      const list = Array.isArray(runs) ? runs : []
      const linked = list.find((r: any) => r.feature_node_id === parseInt(id!, 10))
      if (linked) setRun(linked)
      else if (s?.run) setRun(s.run)
      setLoaded(true)
    })
  }, [id])

  // Lazily hydrate the node cache for timeline artifacts and bet verdicts —
  // both are only IDs on the story payload; we fetch human-readable content on demand.
  useEffect(() => {
    if (!story) return
    const timelineIds: number[] = (story.timeline ?? [])
      .map((r: any) => r.artifact_node_id)
      .filter((x: unknown): x is number => typeof x === 'number')
    const betVerdictIds: number[] = (story.bets ?? [])
      .map((b: any) => b.verdict_node_id)
      .filter((x: unknown): x is number => typeof x === 'number')
    const ids = Array.from(new Set([...timelineIds, ...betVerdictIds])).filter((nid) => !nodeCache[nid])
    if (ids.length === 0) return
    void Promise.all(ids.map((nid) => eAPI().uxGetGraphNode?.(nid))).then((nodes) => {
      setNodeCache((prev) => {
        const next = { ...prev }
        nodes.forEach((n: any, i: number) => {
          const nid = ids[i]
          if (n && !n.error && nid != null) next[nid] = n
        })
        return next
      })
    })
  }, [story, nodeCache])

  const bounceByStage = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of story?.timeline ?? []) {
      if (row.event === 'bounced') {
        let reason = 'sent back for rework'
        try {
          const d = row.detail_json ? JSON.parse(row.detail_json) : {}
          if (d.reason) reason = d.reason
        } catch {
          /* keep default */
        }
        map[row.stage] = reason
      }
    }
    return map
  }, [story])

  const artifactsByStage = useMemo(() => {
    const map: Record<string, { id: number; kind: string; label: string }[]> = {}
    const seen = new Set<number>()
    for (const row of story?.timeline ?? []) {
      const nid = row.artifact_node_id
      if (typeof nid !== 'number' || seen.has(nid)) continue
      seen.add(nid)
      const cached = nodeCache[nid]
      const list = map[row.stage] ?? (map[row.stage] = [])
      list.push({
        id: nid,
        kind: cached?.kind ?? 'FEATURE',
        label: cached?.label ?? `Evidence #${nid}`,
      })
    }
    return map
  }, [story, nodeCache])

  function openArtifact(nodeId: number) {
    const node = nodeCache[nodeId]
    open(
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-[500] text-ink-1">{node?.label ?? `Node #${nodeId}`}</p>
        <pre className="text-[11px] text-ink-2 whitespace-pre-wrap bg-surface-3 rounded-[8px] p-3 max-h-[60vh] overflow-y-auto">
          {node?.description ?? 'Loading…'}
        </pre>
      </div>,
      node ? t(node.kind) : 'Evidence',
    )
  }

  function openVoices() {
    open(
      <div className="flex flex-col gap-2">
        {(story.signals ?? []).length === 0 ? (
          <p className="text-[13px] text-ink-3">No sample voices captured yet.</p>
        ) : (
          (story.signals ?? []).slice(0, 10).map((s: any) => (
            <div key={s.id} className="bg-surface-3 border border-line rounded-[8px] p-3">
              <p className="text-[12px] text-ink-2">{s.label}</p>
            </div>
          ))
        )}
      </div>,
      `${story.signalCount ?? 0} customer voices`,
    )
  }

  async function runFis() {
    setFisRunning(true)
    try {
      const res = await eAPI().aepDomainFIS?.(story.title)
      setFisResults(Array.isArray(res) ? res : [])
    } finally {
      setFisRunning(false)
    }
  }

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
                "{story.originProblem}" —{' '}
                <button onClick={openVoices} className="text-accent underline underline-offset-2">
                  {story.signalCount ?? 0} voices
                </button>
              </p>
            )}
          </div>
          {run && (
            <Badge verb={stageToVerb(run.current_stage)} dot>
              {DICT.status[run.status as keyof typeof DICT.status] ?? run.current_stage}
            </Badge>
          )}
          <Button variant="ghost" onClick={() => setIsEngineer(e => !e)} className="text-[11px]">
            {isEngineer ? 'Exit engineering view' : 'Engineering view'}
          </Button>
        </div>

        {/* Bets summary — plain-English bet lines, never raw hypothesis labels */}
        {story.bets && story.bets.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {story.bets.map((b: any, i: number) => (
              <span key={i} className="text-[11px] bg-decide/10 border border-decide/30 text-decide-text px-2 py-0.5 rounded-[4px]">
                {b.kpi_label && b.direction && typeof b.magnitude_pct === 'number' && typeof b.timeframe_days === 'number'
                  ? DICT.phrases.betLine(b.kpi_label, b.direction, b.magnitude_pct, b.timeframe_days)
                  : b.label}
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
              const isError   = run?.status === 'error' && idx === currentStageIdx

              return (
                <StageRow key={stage.id} stageId={stage.id} state={state}
                  title={stage.title} narrative={stage.narrative} verb={verb}
                  artifacts={artifactsByStage[stage.id] ?? []}
                  bounceReason={bounceByStage[stage.id]}
                  onOpenArtifact={openArtifact}>
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
                        if (stage.id === 'SIGNALS') void eAPI().cycleSimulateSignals?.(run.id)
                        else if (stage.id === 'BUILD') void eAPI().cycleSimulateCI?.(run.id)
                        else void eAPI().cycleSimulateKpi?.(run.id, 0.9)
                      }}
                    />
                  )}
                  {isGate && (
                    <Button variant="primary" onClick={() => navigate(`/gate/${run.id}/${stage.id}`)}>
                      Go to decision room →
                    </Button>
                  )}
                  {isError && (
                    <ErrorBlock error={run?.error ?? undefined}
                      onRetry={() => void eAPI().cycleAdvance?.(run.id)} />
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
                {story.bets.map((b: any, i: number) => {
                  const verdictNode = typeof b.verdict_node_id === 'number' ? nodeCache[b.verdict_node_id] : undefined
                  const pending = b.verdict_node_id == null
                  const validated = verdictNode ? /VALIDATED/i.test(verdictNode.label) : undefined
                  return (
                    <div key={i} className="bg-surface-3 border border-line rounded-[8px] p-3">
                      <p className="text-[12px] text-ink-1 leading-snug">
                        {b.kpi_label && b.direction && typeof b.magnitude_pct === 'number' && typeof b.timeframe_days === 'number'
                          ? DICT.phrases.betLine(b.kpi_label, b.direction, b.magnitude_pct, b.timeframe_days)
                          : b.label}
                      </p>
                      <p className="text-[11px] text-ink-3 mt-1">
                        Confidence: {((b.prior_confidence ?? b.priorConf ?? 0) * 100).toFixed(0)}%
                      </p>
                      <p className="text-[11px] mt-1 font-[500]" style={{ color: pending ? '#A9ADB6' : validated ? '#2FBF8F' : '#E8A13C' }}>
                        {pending ? '⏳ Still measuring' : validated ? '✓ Paid off' : '~ Lesson taken'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Rules & regulations */}
          {story.regulations && story.regulations.length > 0 && (
            <div>
              <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Regulations touched</p>
              <div className="flex flex-col gap-1.5">
                {story.regulations.map((r: any) => (
                  <button key={r.id} type="button"
                    onClick={() => navigate(`/room/domain?regulation=${r.id}`)}
                    className="flex items-center gap-2 text-[12px] text-left hover:text-ink-1">
                    <span className="text-warn">⚠</span>
                    <span className="text-ink-2">{r.label}</span>
                  </button>
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
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Top traced files</p>
                {(story.code ?? []).length === 0 ? (
                  <p className="text-[12px] text-ink-3">No files traced to this initiative yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(story.code ?? []).slice(0, 8).map((f: any) => (
                      <div key={f.id} className="flex items-center justify-between gap-2 bg-surface-3 border border-line rounded-[6px] px-2.5 py-1.5">
                        <span className="text-[11px] text-ink-2 font-mono truncate">{f.file_path ?? f.label}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {f.sdlc_phase && <Badge>{f.sdlc_phase}</Badge>}
                          <span className="text-[10px] text-ink-3">FIS {typeof f.fis === 'number' ? f.fis.toFixed(2) : '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Impact analysis</p>
                <Button variant="ghost" loading={fisRunning} onClick={() => void runFis()} className="text-[11px] w-full">
                  Run FIS
                </Button>
                {fisResults && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {fisResults.length === 0 ? (
                      <p className="text-[11px] text-ink-3">No related files found.</p>
                    ) : fisResults.slice(0, 8).map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between gap-2 bg-surface-3 border border-line rounded-[6px] px-2.5 py-1.5">
                        <span className="text-[11px] text-ink-2 font-mono truncate">{r.filePath}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {r.isGoverned && <Badge variant="warn">governed</Badge>}
                          <span className="text-[10px] text-ink-3">{typeof r.score === 'number' ? r.score.toFixed(2) : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
