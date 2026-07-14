/**
 * screens/gates/DecideRoom.tsx
 * The human-gate room — portfolio admission and release approval.
 * Evidence left, decision right, consequences explicit.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Card, GateSeal, Badge, EvidenceChip, ConfirmDialog, useToast } from '@/design/primitives'
import { DICT } from '@/design/dictionary'

// ═════════════════════════════════════════════════════════════════════════════
// PORTFOLIO GATE
// ═════════════════════════════════════════════════════════════════════════════
function PortfolioGate({ runId }: { runId: number }) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [data, setData] = useState<any>(null)
  const [decision, setDecision] = useState<'admit' | 'defer' | 'reject' | null>(null)
  const [role, setRole] = useState('')
  const [rationale, setRationale] = useState('')
  const [featureId, setFeatureId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const api = window.electronAPI as any

  useEffect(() => {
    api.cycleGet?.(runId).then((run: any) => {
      if (!run || run.error) return
      Promise.all([
        run.packet_id ? api.uxGetGraphNode?.(run.packet_id) : null,
        api.aepGetHypotheses?.() ?? [],
      ]).then(([packet, hyps]: [any, any]) => {
        setData({ run, packet: packet?.description ? (() => { try { return JSON.parse(packet.description) } catch { return null } })() : null, hyps: Array.isArray(hyps) ? hyps : [] })
        if (run.feature_node_id) setFeatureId(run.feature_node_id)
      })
    })
  }, [runId])

  async function submit() {
    if (!decision || !role || rationale.length < 10) return
    setSubmitting(true)
    try {
      const res = await api.cyclePortfolioGate?.(runId, {
        decision, approvedByRole: role, rationale, featureNodeId: featureId,
      })
      if (res?.error) throw new Error(res.error)
      push({ message: decision === 'admit' ? 'Initiative admitted — bets locked' : `Decision recorded: ${decision}`, status: 'ok' })
      navigate('/journey')
    } catch (e: any) {
      push({ message: e.message ?? 'Error recording decision', status: 'danger' })
    } finally {
      setSubmitting(false)
    }
  }

  if (!data) return <div className="flex items-center justify-center h-full"><p className="text-ink-3 animate-pulse text-[13px]">Loading…</p></div>

  const packet = data.packet ?? {}
  const hyps: any[] = data.hyps ?? []

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-warn text-xl">★</span>
          <div>
            <p className="text-[15px] font-[600] text-ink-1">Portfolio admission</p>
            <p className="text-[12px] text-ink-3">Admit · defer · reject. On admit, bets are locked — permanently.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-0 h-full">
          {/* LEFT — evidence */}
          <div className="border-r border-line px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Evidence</p>

            {/* Origin */}
            <div>
              <p className="text-[12px] font-[500] text-ink-1 mb-1">The problem</p>
              <p className="text-[13px] text-ink-2">{packet.summary ?? 'No summary available'}</p>
              <p className="text-[11px] text-ink-3 mt-1">Evidence strength: {((packet.evidence_strength ?? 0) * 100).toFixed(0)}%</p>
            </div>

            {/* Value */}
            {packet.value_range && (
              <div>
                <p className="text-[12px] font-[500] text-ink-1 mb-1">Worth</p>
                <p className="text-[13px] text-ink-2">
                  ${packet.value_range.low_usd?.toLocaleString()} – ${packet.value_range.high_usd?.toLocaleString()} /{packet.value_range.timeframe}
                </p>
                {packet.value_range.assumptions?.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-[11px] text-accent cursor-pointer">Assumptions ▸</summary>
                    <ul className="mt-1 ml-3 text-[11px] text-ink-3 space-y-0.5">
                      {packet.value_range.assumptions.map((a: string, i: number) => <li key={i}>• {a}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* Bets to be locked */}
            {hyps.length > 0 && (
              <div>
                <p className="text-[12px] font-[500] text-ink-1 mb-2">Bets you are locking</p>
                <div className="flex flex-col gap-2">
                  {hyps.filter((h: any) => !h.verdict).map((h: any) => (
                    <div key={h.id} className="bg-surface-3 border border-warn/20 rounded-[8px] p-3">
                      <p className="text-[12px] font-[500] text-ink-1">{h.label}</p>
                      <p className="text-[11px] text-ink-3 mt-0.5">
                        {h.kpi} · confidence {(h.priorConf * 100).toFixed(0)}%
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* A5 recommendation */}
            {packet.recommendation && (
              <div className="bg-accent/5 border border-accent/20 rounded-[8px] p-3">
                <p className="text-[11px] text-accent font-[500]">
                  Recommendation: {packet.recommendation.toUpperCase()} (score {packet.value_score?.toFixed(1)}/10)
                </p>
              </div>
            )}
          </div>

          {/* RIGHT — decision */}
          <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Your decision</p>

            {/* Decision radio */}
            <div className="flex flex-col gap-2">
              {([
                { v: 'admit',  label: 'Admit — start building',  desc: 'Bets are committed and locked.' },
                { v: 'defer',  label: 'Defer — revisit later',    desc: 'Returns to Listen for more signals.' },
                { v: 'reject', label: 'Reject — close this',       desc: 'No further action.' },
              ] as const).map(opt => (
                <label key={opt.v}
                  className={`flex items-start gap-3 p-3 rounded-[10px] border cursor-pointer transition-colors ${
                    decision === opt.v ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong'
                  }`}>
                  <input type="radio" name="decision" value={opt.v}
                    checked={decision === opt.v} onChange={() => setDecision(opt.v)}
                    className="mt-0.5 accent-accent" />
                  <div>
                    <p className="text-[13px] font-[500] text-ink-1">{opt.label}</p>
                    <p className="text-[11px] text-ink-3">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {/* Role */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Deciding as</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong">
                <option value="">Select your role…</option>
                {['CPO','CTO','CBO','VP Product','VP Engineering','Finance Lead'].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Rationale */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">
                Why (required · permanently recorded)
              </label>
              <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={4}
                placeholder="Your reasoning, in your words. This becomes the organization's record."
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none" />
            </div>

            {/* Lock warning */}
            {decision === 'admit' && (
              <div className="bg-warn/10 border border-warn/30 rounded-[8px] p-3 text-[12px] text-warn">
                Locking the bets is permanent. They will be judged exactly as written.
              </div>
            )}

            <Button
              disabled={!decision || !role || rationale.length < 10 || submitting}
              loading={submitting}
              onClick={() => setConfirm(true)}
            >
              Record decision
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirm}
        title={`${decision === 'admit' ? 'Admit and lock bets' : decision === 'defer' ? 'Defer initiative' : 'Reject initiative'}?`}
        body={decision === 'admit' ? 'This commits all bets. They cannot be changed after this.' : 'This decision is recorded and cannot be undone.'}
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
function ReleaseGate({ runId }: { runId: number }) {
  const navigate = useNavigate()
  const { push } = useToast()
  const [data, setData]   = useState<any>(null)
  const [role, setRole]   = useState('')
  const [rationale, setRationale] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const api = window.electronAPI as any

  useEffect(() => {
    api.cycleGet?.(runId).then((run: any) => {
      if (!run || run.error || !run.readiness_report_id) {
        setData({ run, report: { approvalSet: ['Engineering Lead'] } })
        return
      }
      api.uxGetGraphNode?.(run.readiness_report_id).then((node: any) => {
        let report: any = {}
        try {
          report = node?.description ? JSON.parse(node.description) : {}
        } catch {
          report = { approvalSet: ['Engineering Lead'] }
        }
        if (!report.approvalSet) report.approvalSet = ['Engineering Lead']
        setData({ run, report })
      })
    })
  }, [runId])

  async function sign() {
    if (!role || rationale.length < 5) return
    setSubmitting(true)
    try {
      const res = await api.cycleSignRelease?.(runId, role, rationale)
      if (res?.error) throw new Error(res.error)
      push({ message: `${role} signed — checking if all required signatures are present`, status: 'ok' })
      const run = await api.cycleGet?.(runId)
      if (run?.current_stage === 'ROLLOUT' || run?.current_stage === 'OBSERVE') {
        push({ message: 'Signatures progressing — continuing the journey', status: 'ok' })
        navigate(run.feature_node_id ? `/feature/${run.feature_node_id}` : '/journey')
      }
    } catch (e: any) {
      push({ message: e.message, status: 'danger' })
    } finally {
      setSubmitting(false) }
  }

  if (!data) return <div className="flex items-center justify-center h-full"><p className="text-ink-3 animate-pulse text-[13px]">Loading…</p></div>

  const report = data.report ?? {}
  const blast  = report.blastRadius ?? {}
  const assessment = report.assessment ?? {}
  const approvalSet: string[] = report.approvalSet ?? []
  const signedRoles: string[] = data.run.signed_roles_json
    ? JSON.parse(data.run.signed_roles_json) : []

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-warn text-xl">★</span>
          <div>
            <p className="text-[15px] font-[600] text-ink-1">Release approval</p>
            <p className="text-[12px] text-ink-3">All required signatures must be recorded before rollout begins.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-0 h-full">
          {/* LEFT — scopes in plain language */}
          <div className="border-r border-line px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">What is changing</p>

            <ScopeLine num={1} title="Code"
              ok={true}
              body={`${blast.scope1_code?.length ?? 0} files are changing. ${blast.scope1_code?.filter((f: any) => f.changeType === 'cochange').length ?? 0} more usually change alongside them — teams should be aware.`} />

            <ScopeLine num={2} title="Tests"
              ok={(blast.scope2_gaps?.length ?? 0) === 0}
              body={(blast.scope2_gaps?.length ?? 0) === 0
                ? 'All changed code has test coverage.'
                : `${blast.scope2_gaps.length} changed file${blast.scope2_gaps.length > 1 ? 's' : ''} have no test coverage — this is blocking.`} />

            <ScopeLine num={3} title="Operations"
              ok={true}
              body={(blast.scope3_ops ?? []).length === 0
                ? 'No downstream operational impact identified.'
                : `${blast.scope3_ops.length} events and contexts are affected. ${blast.scope3_ops.map((o: any) => o.label).join(', ')}.`} />

            <ScopeLine num={4} title="Organization"
              ok={(blast.scope4_org?.governed ?? []).length === 0}
              body={`Touches metrics: ${blast.scope4_org?.kpis?.join(', ') || 'none'}. ${blast.scope4_org?.governed?.length > 0 ? `Regulatory exposure: ${blast.scope4_org.governed.join(', ')} — that is why compliance is in the required list.` : 'No regulatory exposure.'}`} />

            {assessment.rollback_plan && (
              <div className="bg-surface-3 border border-line rounded-[8px] p-3">
                <p className="text-[11px] font-[600] text-ink-3 mb-1">Rollback plan</p>
                <p className="text-[12px] text-ink-2">{assessment.rollback_plan}</p>
              </div>
            )}
          </div>

          {/* RIGHT — signatures */}
          <div className="px-6 py-5 overflow-y-auto flex flex-col gap-5">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Required signatures</p>

            <GateSeal required={approvalSet} signed={signedRoles} />

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Signing as</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong">
                <option value="">Your role…</option>
                {approvalSet.filter(r => !signedRoles.includes(r)).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-ink-3 uppercase tracking-wide">Confirmation note</label>
              <textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={3}
                placeholder="Confirm you have reviewed the relevant scope."
                className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 placeholder-ink-3 outline-none focus:border-line-strong resize-none" />
            </div>

            <Button
              disabled={!role || rationale.length < 5 || submitting || signedRoles.includes(role)}
              loading={submitting}
              onClick={sign}
            >
              {signedRoles.includes(role) ? 'Already signed' : `Sign as ${role || '…'}`}
            </Button>

            {approvalSet.every(r => signedRoles.includes(r)) && (
              <p className="text-[12px] text-ok font-[500]">✓ All signatures present — rollout will start automatically.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScopeLine({ num, title, body, ok }: { num: number; title: string; body: string; ok: boolean }) {
  return (
    <div className={`rounded-[10px] border p-4 ${ok ? 'border-line bg-surface-3' : 'border-danger/40 bg-danger/5'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-[700] ${ok ? 'text-ink-3' : 'text-danger'}`}>SCOPE {num}</span>
        <span className="text-[13px] font-[500] text-ink-1">{title}</span>
        <span className="ml-auto">{ok ? '✓' : '⛔'}</span>
      </div>
      <p className="text-[12px] text-ink-2 leading-snug">{body}</p>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// DECIDE ROOM  (router — chooses which gate to render)
// ═════════════════════════════════════════════════════════════════════════════
export function DecideRoom() {
  const { runId, gateType } = useParams()
  const id = parseInt(runId!)
  if (gateType === 'PORTFOLIO_GATE') return <PortfolioGate runId={id} />
  if (gateType === 'RELEASE_GATE')   return <ReleaseGate runId={id} />
  return <div className="flex items-center justify-center h-full"><p className="text-ink-3">Unknown gate type: {gateType}</p></div>
}
