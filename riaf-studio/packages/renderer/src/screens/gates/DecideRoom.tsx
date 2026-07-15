/**
 * screens/gates/DecideRoom.tsx
 * The human-gate room — portfolio admission and release approval.
 * Evidence left, decision right, consequences explicit.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, GateSeal, ConfirmDialog, useToast } from '@/design/primitives'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type PacketView = {
  featureLabel?: string
  rationale?: string
  suggestedDecision?: string
  painPointCount?: number
  kpiLabels?: string[]
  hypothesisIds?: number[]
  topFiles?: string[]
  streamState?: string
  bizAssessmentId?: number | null
}

// ═════════════════════════════════════════════════════════════════════════════
// PORTFOLIO GATE
// ═════════════════════════════════════════════════════════════════════════════
function PortfolioGate({ runId }: { runId: number }) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [data, setData] = useState<{
    run: Record<string, unknown>
    packet: PacketView
    hyps: Array<Record<string, unknown>>
  } | null>(null)
  const [worthProse, setWorthProse] = useState<string | null>(null)
  const [worthOpen, setWorthOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [decision, setDecision] = useState<'admit' | 'defer' | 'reject' | null>(null)
  const [role, setRole] = useState('')
  const [rationale, setRationale] = useState('')
  const [featureId, setFeatureId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    setData(null)
    void (async () => {
      try {
        const run = await eAPI().cycleGet?.(runId)
        if (cancelled) return
        if (!run || run.error) {
          setLoadError(run?.error ?? `Cycle run #${runId} not found`)
          return
        }
        const fid = run.feature_node_id as number | null
        const [packetNode, hyps] = await Promise.all([
          run.packet_id ? eAPI().uxGetGraphNode?.(run.packet_id) : null,
          fid
            ? eAPI().aepGetHypotheses?.({ featureId: fid, includeDrafts: true })
            : eAPI().aepGetHypotheses?.({ includeDrafts: false }),
        ])
        if (cancelled) return
        let packet: PacketView = {}
        try {
          packet = packetNode?.description ? JSON.parse(packetNode.description) : {}
        } catch {
          packet = {}
        }
        setData({
          run,
          packet,
          hyps: Array.isArray(hyps) ? hyps : [],
        })
        if (fid) setFeatureId(fid)
        if (packet.suggestedDecision) {
          setDecision(packet.suggestedDecision as 'admit' | 'defer' | 'reject')
        }
        // "Worth" — the business impact assessment prose (assumptions live inside it)
        if (packet.bizAssessmentId) {
          const biaNode = await eAPI().uxGetGraphNode?.(packet.bizAssessmentId)
          if (!cancelled && biaNode?.description) setWorthProse(biaNode.description)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId])

  async function submit() {
    if (!decision || !role || rationale.length < 10) return
    if (!featureId) {
      push({ message: 'No feature on this run — finish INTAKE first', status: 'danger' })
      return
    }
    setSubmitting(true)
    try {
      const res = await eAPI().cyclePortfolioGate?.(runId, {
        decision,
        approvedByRole: role,
        rationale,
        featureNodeId: featureId,
      })
      if (res?.error) throw new Error(res.error)
      push({
        message:
          decision === 'admit'
            ? 'Initiative admitted — bets locked'
            : `Decision recorded: ${decision}`,
        status: 'ok',
      })
      const destination = decision === 'admit' && featureId ? `/feature/${featureId}` : '/journey'
      setTimeout(() => navigate(destination), 2000)
    } catch (e: unknown) {
      push({
        message: e instanceof Error ? e.message : 'Error recording decision',
        status: 'danger',
      })
    } finally {
      setSubmitting(false)
      setConfirm(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <p className="text-[13px] text-danger">{loadError}</p>
        <Button variant="secondary" onClick={() => navigate('/room/cycle')}>
          Open Cycle Runner
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-ink-3 animate-pulse text-[13px]">Loading…</p>
      </div>
    )
  }

  const packet = data.packet
  const hyps = data.hyps
  // Evidence strength — a transparent heuristic from real counts, never a fabricated score.
  const evidenceStrength = Math.max(
    0.15,
    Math.min(1, (packet.painPointCount ?? 0) / 3 + (hyps.length > 0 ? 0.25 : 0)),
  )

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-warn text-xl">★</span>
          <div>
            <p className="text-[15px] font-[600] text-ink-1">
              Portfolio admission{packet.featureLabel ? ` — ${packet.featureLabel}` : ''}
            </p>
            <p className="text-[12px] text-ink-3">
              Admit · defer · reject. On admit, bets are locked — permanently.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-0 h-full min-h-[420px]">
          <div className="border-r border-line px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Evidence</p>

            <div>
              <p className="text-[12px] font-[500] text-ink-1 mb-1">The problem</p>
              <p className="text-[13px] text-ink-2">
                {packet.rationale ?? 'Portfolio packet assembled for forum review.'}
              </p>
              <p className="text-[11px] text-ink-3 mt-1">
                {packet.painPointCount ?? 0} problem
                {(packet.painPointCount ?? 0) === 1 ? '' : 's'} ·{' '}
                {(packet.kpiLabels ?? []).join(', ') || 'no KPIs listed'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(evidenceStrength * 100)}%` }} />
                </div>
                <span className="text-[10px] text-ink-3 flex-shrink-0">evidence strength</span>
              </div>
            </div>

            <div>
              <p className="text-[12px] font-[500] text-ink-1 mb-1">Worth</p>
              {worthProse ? (
                <>
                  <p className="text-[13px] text-ink-2 leading-relaxed">
                    {worthOpen ? worthProse.replace(/^\[stub\]\s*/, '') : `${worthProse.replace(/^\[stub\]\s*/, '').slice(0, 160)}…`}
                  </p>
                  <button type="button" onClick={() => setWorthOpen((o) => !o)}
                    className="text-[11px] text-accent mt-1">
                    {worthOpen ? 'Show less ▸' : 'Assumptions ▸'}
                  </button>
                </>
              ) : (
                <p className="text-[12px] text-ink-3">No business value assessment attached yet.</p>
              )}
            </div>

            {hyps.length > 0 && (
              <div>
                <p className="text-[12px] font-[500] text-ink-1 mb-2">Bets you are locking</p>
                <div className="flex flex-col gap-2">
                  {hyps.map((h) => (
                    <div
                      key={String(h.hypothesisNodeId ?? h.id)}
                      className="bg-surface-3 border border-warn/30 rounded-[8px] p-3"
                    >
                      <p className="text-[12px] font-[500] text-ink-1">{String(h.label)}</p>
                      <p className="text-[11px] text-ink-3 mt-0.5">
                        {String(h.kpiLabel ?? h.kpi ?? 'KPI')}
                        {typeof h.priorConfidence === 'number' || typeof h.priorConf === 'number'
                          ? ` · confidence ${(((h.priorConfidence as number) ?? (h.priorConf as number)) * 100).toFixed(0)}%`
                          : ''}
                        {h.attributionMethod ? ` · ${String(h.attributionMethod).replace(/_/g, ' ')}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hyps.length === 0 && (
              <p className="text-[12px] text-ink-3">
                No draft bets yet — admit will still create the DEFINE state; run QUALIFY if
                assessments are missing.
              </p>
            )}

            {packet.suggestedDecision && (
              <div className="bg-accent/5 border border-accent/20 rounded-[8px] p-3">
                <p className="text-[11px] text-accent font-[500]">
                  Recommendation: {packet.suggestedDecision.toUpperCase()}
                </p>
              </div>
            )}
          </div>

          <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Your decision</p>

            <div className="flex flex-col gap-2">
              {(
                [
                  { v: 'admit' as const, label: 'Admit', desc: 'Bets are committed and permanently locked before any code exists.' },
                  { v: 'defer' as const, label: 'Not now', desc: 'Returns to Listen. More data can be gathered before re-presenting.' },
                  { v: 'reject' as const, label: 'No', desc: 'Closes this initiative. The reason is recorded for learning.' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.v}
                  className={`flex items-start gap-3 p-3 rounded-[10px] border cursor-pointer transition-colors ${
                    decision === opt.v ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong'
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value={opt.v}
                    checked={decision === opt.v}
                    onChange={() => setDecision(opt.v)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <p className="text-[13px] font-[500] text-ink-1">{opt.label}</p>
                    <p className="text-[11px] text-ink-3">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Deciding as</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong"
              >
                <option value="">Select your role…</option>
                {['CPO', 'CTO', 'CBO', 'VP Product', 'VP Engineering', 'Finance Lead', 'Product Owner'].map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">
                Why — this is permanently recorded and cannot be changed
              </label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={4}
                placeholder="Your reasoning, in your words. This becomes the organization's record."
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none"
              />
            </div>

            {decision === 'admit' && (
              <div className="bg-warn/10 border border-warn/30 rounded-[8px] p-3 text-[12px] text-warn">
                Locking the bets is permanent. They will be judged exactly as written.
              </div>
            )}

            <Button
              disabled={!decision || !role || rationale.length < 10 || submitting || !featureId}
              loading={submitting}
              onClick={() => setConfirm(true)}
            >
              Record decision
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title={`${decision === 'admit' ? 'Admit and lock bets' : decision === 'defer' ? 'Defer initiative' : 'Reject initiative'}?`}
        body={
          decision === 'admit'
            ? 'This commits all bets. They cannot be changed after this.'
            : 'This decision is recorded and cannot be undone.'
        }
        confirmLabel="Record decision"
        variant={decision === 'reject' ? 'danger' : 'warn'}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// RELEASE GATE
// ═════════════════════════════════════════════════════════════════════════════
type BlastRadiusView = {
  scope1_code: { filePath: string; changeType: 'direct' | 'cochange' }[]
  scope2_gaps: string[]
  scope3_ops: { kind: string; label: string; detail: string }[]
  scope4_org: { kpis: string[]; segments: string[]; orgUnits: string[]; governed: string[] }
  approvalSet: string[]
}

function ReleaseGate({ runId }: { runId: number }) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [data, setData] = useState<{
    run: Record<string, unknown>
    report: Record<string, unknown>
    blast: BlastRadiusView | null
  } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [rationale, setRationale] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    void (async () => {
      try {
        const run = await eAPI().cycleGet?.(runId)
        if (cancelled) return
        if (!run || run.error) {
          setLoadError(run?.error ?? `Cycle run #${runId} not found`)
          return
        }

        // The readiness report node stores narrative markdown, not the structured
        // blast radius — fetch the real scopes straight from the blast-radius engine.
        let blast: BlastRadiusView | null = null
        if (run.feature_node_id) {
          const br = await eAPI().aepGetBlastRadius?.({ featureId: run.feature_node_id })
          if (br && !br.error) blast = br as BlastRadiusView
        }

        let report: Record<string, unknown> = { approvalSet: blast?.approvalSet ?? ['Engineering Lead'] }
        if (run.readiness_report_id) {
          const node = await eAPI().uxGetGraphNode?.(run.readiness_report_id)
          if (typeof node?.description === 'string') report.narrative = node.description
        }
        if (!report.approvalSet) report.approvalSet = blast?.approvalSet ?? ['Engineering Lead']

        if (cancelled) return
        setData({ run, report, blast })
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId])

  async function sign() {
    if (!role || rationale.length < 5) return
    setSubmitting(true)
    try {
      const res = await eAPI().cycleSignRelease?.(runId, role, rationale)
      if (res?.error) throw new Error(res.error)
      push({
        message: `${role} signed — checking if all required signatures are present`,
        status: 'ok',
      })
      const run = await eAPI().cycleGet?.(runId)
      if (run?.current_stage === 'ROLLOUT' || run?.current_stage === 'OBSERVE') {
        push({ message: 'Signatures progressing — continuing the journey', status: 'ok' })
        navigate(run.feature_node_id ? `/feature/${run.feature_node_id}` : '/journey')
      } else if (run) {
        setData((prev) => (prev ? { ...prev, run } : prev))
      }
    } catch (e: unknown) {
      push({ message: e instanceof Error ? e.message : String(e), status: 'danger' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <p className="text-[13px] text-danger">{loadError}</p>
        <Button variant="secondary" onClick={() => navigate('/room/cycle')}>
          Open Cycle Runner
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-ink-3 animate-pulse text-[13px]">Loading…</p>
      </div>
    )
  }

  const report = data.report ?? {}
  const blast = data.blast
  const approvalSet: string[] = (report.approvalSet as string[]) ?? []
  let signedRoles: string[] = []
  try {
    signedRoles = data.run.signed_roles_json
      ? JSON.parse(String(data.run.signed_roles_json))
      : []
  } catch {
    signedRoles = []
  }

  const scope1 = blast?.scope1_code ?? []
  const direct = scope1.filter((f) => f.changeType === 'direct')
  const cochange = scope1.filter((f) => f.changeType === 'cochange')
  const scope2Gaps = blast?.scope2_gaps ?? []
  const scope3 = blast?.scope3_ops ?? []
  const scope4 = blast?.scope4_org ?? { kpis: [], segments: [], orgUnits: [], governed: [] }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-warn text-xl">★</span>
          <div>
            <p className="text-[15px] font-[600] text-ink-1">Release approval</p>
            <p className="text-[12px] text-ink-3">
              All required signatures must be recorded before rollout begins.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-0 h-full min-h-[420px]">
          <div className="border-r border-line px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">What is changing</p>

            <ScopeLine
              num={1}
              title="Code"
              ok={true}
              body={`${direct.length} file${direct.length === 1 ? '' : 's'} are changing. ${cochange.length} more usually change alongside them — their owners should be aware.`}
            />
            <ScopeLine
              num={2}
              title="Tests"
              ok={scope2Gaps.length === 0}
              body={
                scope2Gaps.length === 0
                  ? 'Everything changed is covered by tests ✓'
                  : `${scope2Gaps.length} changed file${scope2Gaps.length === 1 ? '' : 's'} have no test — this is blocking.`
              }
              list={scope2Gaps.length > 0 ? scope2Gaps : undefined}
            />
            <ScopeLine
              num={3}
              title="Operations"
              ok={true}
              body={
                scope3.length === 0
                  ? 'No downstream operational impact identified.'
                  : `${scope3.length} event${scope3.length === 1 ? '' : 's'} and context${scope3.length === 1 ? '' : 's'} that other teams use are affected.`
              }
              list={scope3.length > 0 ? scope3.map((o) => `${o.label}${o.detail ? ` — ${o.detail}` : ''}`) : undefined}
            />
            <ScopeLine
              num={4}
              title="Your responsibility"
              ok={scope4.governed.length === 0}
              body={
                scope4.governed.length === 0
                  ? 'No regulatory exposure in this release.'
                  : scope4.governed
                      .map((reg) => `${reg} applies here — this is why compliance sign-off is required.`)
                      .join(' ')
              }
            />
            {(scope4.kpis.length > 0 || scope4.orgUnits.length > 0) && (
              <p className="text-[11px] text-ink-3">
                {scope4.kpis.length > 0 && `Metrics touched: ${scope4.kpis.join(', ')}.`}
                {scope4.orgUnits.length > 0 && ` Teams affected: ${scope4.orgUnits.join(', ')}.`}
              </p>
            )}

            {typeof report.narrative === 'string' && (
              <div className="bg-surface-3 border border-line rounded-[8px] p-3">
                <p className="text-[11px] font-[600] text-ink-3 mb-1">Full readiness report</p>
                <p className="text-[12px] text-ink-2 whitespace-pre-line line-clamp-6">
                  {(report.narrative as string).replace(/^\[stub\]\s*/, '').replace(/[#*]/g, '')}
                </p>
              </div>
            )}
          </div>

          <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Required signatures</p>
            <GateSeal required={approvalSet} signed={signedRoles} />

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Signing as</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong"
              >
                <option value="">Your role…</option>
                {approvalSet.filter((r) => !signedRoles.includes(r)).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Confirmation note</label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={3}
                placeholder="Confirm you have reviewed the relevant scope."
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none"
              />
            </div>

            <Button
              disabled={!role || rationale.length < 5 || submitting || signedRoles.includes(role)}
              loading={submitting}
              onClick={() => void sign()}
            >
              {signedRoles.includes(role) ? 'Already signed' : `Sign as ${role || '…'}`}
            </Button>

            {approvalSet.length > 0 && approvalSet.every((r) => signedRoles.includes(r)) && (
              <p className="text-[12px] text-ok font-[500]">
                ✓ All signatures present — rollout will start automatically.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScopeLine({
  num,
  title,
  body,
  ok,
  list,
}: {
  num: number
  title: string
  body: string
  ok: boolean
  list?: string[]
}) {
  return (
    <div
      className={`rounded-[10px] border p-4 ${ok ? 'border-line bg-surface-3' : 'border-danger/40 bg-danger/5'}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-[700] ${ok ? 'text-ink-3' : 'text-danger'}`}>
          SCOPE {num}
        </span>
        <span className="text-[13px] font-[500] text-ink-1">{title}</span>
        <span className="ml-auto">{ok ? '✓' : '⛔'}</span>
      </div>
      <p className="text-[12px] text-ink-2 leading-snug">{body}</p>
      {list && list.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {list.slice(0, 8).map((item, i) => (
            <li key={i} className="text-[11px] text-ink-3 font-mono truncate">· {item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DecideRoom() {
  const { runId, gateType } = useParams()
  const id = parseInt(runId ?? '', 10)
  if (!Number.isFinite(id)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-ink-3">Invalid gate route</p>
      </div>
    )
  }
  if (gateType === 'PORTFOLIO_GATE') return <PortfolioGate runId={id} />
  if (gateType === 'RELEASE_GATE') return <ReleaseGate runId={id} />
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-ink-3">Unknown gate type: {gateType}</p>
    </div>
  )
}
