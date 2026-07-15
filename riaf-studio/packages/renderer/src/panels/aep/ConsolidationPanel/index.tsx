/**
 * panels/aep/ConsolidationPanel/index.tsx
 * SHIP room — is this release safe to go out, and who still needs to sign?
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ProgressRibbon, useToast } from '@/design/primitives'
import { agentName } from '@/store/cycle.store'
import type { BlastRadius, ValueStreamRow } from '@shared/index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = () => window.electronAPI as any

type A10Result = {
  reportId: number
  blastRadius: BlastRadius
  pendingGates: { kind: string; label: string; reason: string }[]
  approvalSet: string[]
  isStub: boolean
}

function daysAgo(ts: number | null | undefined): number {
  if (!ts) return 0
  return Math.max(0, Math.round((Date.now() - ts) / 86_400_000))
}

function explainRole(
  role: string,
  ctx: { governed: string[]; direct: number; segments: string[] },
): string {
  const lower = role.toLowerCase()
  if (lower.includes('engineering')) return 'Always required for any code change'
  if (lower.includes('compliance') || lower.includes('legal')) {
    return ctx.governed.length > 0
      ? `Required because ${ctx.governed.join(', ')} governs ${ctx.direct} file${ctx.direct === 1 ? '' : 's'} in this release`
      : 'Consulted on regulatory exposure for this release'
  }
  if (lower.includes('customer success') || lower.includes('support')) {
    return ctx.segments.length > 0
      ? `Required because this release affects the ${ctx.segments.join(', ')} customer segment`
      : 'Required because this release affects customers directly'
  }
  return "Included based on this feature's ownership and consultation graph"
}

function ScopeCard({ num, title, ok, children }: { num: number; title: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-[10px] border p-4 ${ok ? 'border-line bg-surface-3' : 'border-danger/40 bg-danger/5'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[11px] font-[700] ${ok ? 'text-ink-3' : 'text-danger'}`}>SCOPE {num}</span>
        <span className="text-[13px] font-[500] text-ink-1">{title}</span>
        <span className="ml-auto">{ok ? '✓' : '⛔'}</span>
      </div>
      <div className="text-[12px] text-ink-2 leading-snug flex flex-col gap-1">{children}</div>
    </div>
  )
}

export function ConsolidationPanel() {
  const navigate = useNavigate()
  const { push } = useToast()

  const [features, setFeatures] = useState<ValueStreamRow[]>([])
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [signedRoles, setSignedRoles] = useState<string[]>([])
  const [approvalSet, setApprovalSet] = useState<string[]>([])
  const [blast, setBlast] = useState<BlastRadius | null>(null)
  const [a10, setA10] = useState<A10Result | null>(null)
  const [a10Running, setA10Running] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const refresh = useCallback(async () => {
    const vs = await eAPI().aepGetValueStream?.()
    const rows: ValueStreamRow[] = Array.isArray(vs) ? vs : []
    setFeatures(rows.filter((f) => f.stream_state === 'CONSOLIDATE'))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (selectedFeatureId == null) return
    let cancelled = false
    setLoadingDetail(true)
    setA10(null)
    setBlast(null)
    void (async () => {
      try {
        const [br, aset, board] = await Promise.all([
          eAPI().aepGetBlastRadius?.({ featureId: selectedFeatureId }),
          eAPI().aepGetApprovalSet?.(selectedFeatureId),
          eAPI().uxGetJourneyBoard?.(),
        ])
        if (cancelled) return
        if (br && !br.error) setBlast(br as BlastRadius)
        setApprovalSet(Array.isArray(aset) ? aset : [])
        const boardRows: Array<{ id: number; featureId?: number | null }> = Array.isArray(board) ? board : []
        const match = boardRows.find((b) => b.featureId === selectedFeatureId)
        setRunId(match?.id ?? null)
        if (match?.id) {
          const run = await eAPI().cycleGet?.(match.id)
          if (!cancelled && run && !run.error) {
            try {
              setSignedRoles(run.signed_roles_json ? JSON.parse(run.signed_roles_json) : [])
            } catch {
              setSignedRoles([])
            }
          }
        } else {
          setSignedRoles([])
        }
      } finally {
        if (!cancelled) setLoadingDetail(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedFeatureId])

  async function runSafetyCheck() {
    if (selectedFeatureId == null) return
    setA10Running(true)
    try {
      const result = await eAPI().aepRunA10?.(selectedFeatureId)
      if (result?.error) throw new Error(result.error)
      setA10(result as A10Result)
      setBlast((result as A10Result).blastRadius)
      push({ message: `Release Checker complete — ${(result as A10Result).pendingGates.length} gate(s) pending`, status: 'ok' })
    } catch (e) {
      push({ message: e instanceof Error ? e.message : 'Release Checker failed', status: 'danger' })
    } finally {
      setA10Running(false)
    }
  }

  const selectedFeature = features.find((f) => f.id === selectedFeatureId)
  const unsignedRoles = approvalSet.filter((r) => !signedRoles.includes(r))
  const allSigned = approvalSet.length > 0 && unsignedRoles.length === 0
  const governed = blast?.scope4_org.governed ?? []
  const segments = blast?.scope4_org.segments ?? []
  const direct = blast?.scope1_code.filter((f) => f.changeType === 'direct').length ?? 0
  const cochange = blast?.scope1_code.filter((f) => f.changeType === 'cochange').length ?? 0
  const complianceRole = approvalSet.find((r) => /compliance|legal/i.test(r)) ?? 'Compliance'

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[15px] font-[600] text-ink-1">Check release readiness</p>
          <p className="text-[12px] text-ink-3 mt-0.5">{features.length} initiative{features.length === 1 ? '' : 's'} ready to check</p>
        </div>
        <select
          value={selectedFeatureId ?? ''}
          onChange={(e) => setSelectedFeatureId(e.target.value ? Number(e.target.value) : null)}
          className="bg-surface-3 border border-line rounded-[8px] px-3 py-2 text-[13px] text-ink-1 outline-none focus:border-line-strong max-w-[280px]"
        >
          <option value="">Select an initiative…</option>
          {features.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} · {daysAgo(f.entered_state_at)}d in stage
            </option>
          ))}
        </select>
        <Button loading={a10Running} disabled={selectedFeatureId == null} onClick={() => void runSafetyCheck()}>
          Run safety check
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {features.length === 0 ? (
          <EmptyState
            verb="SHIP"
            title="Nothing waiting on a safety check"
            body="Initiatives show up here once they reach the release-readiness stage."
          />
        ) : selectedFeatureId == null ? (
          <p className="text-[13px] text-ink-3">Select an initiative above to check release readiness.</p>
        ) : (
          <div className="flex flex-col gap-5 max-w-2xl">
            {a10Running && <ProgressRibbon label={`${agentName('A10')} working…`} pct={null} />}
            {loadingDetail && !blast && <ProgressRibbon label="Loading blast radius…" pct={null} />}

            {approvalSet.length > 0 && (
              allSigned ? (
                <div className="bg-ok/10 border border-ok/30 rounded-[8px] p-3">
                  <p className="text-[12px] text-ok font-[500]">
                    ✓ All approvals recorded — rollout will begin automatically.
                  </p>
                </div>
              ) : (
                <div className="bg-warn/10 border border-warn/30 rounded-[10px] p-4 flex flex-col gap-2">
                  <p className="text-[13px] font-[500] text-warn">
                    {unsignedRoles.length} approval{unsignedRoles.length === 1 ? '' : 's'} still needed before release
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {unsignedRoles.map((role) => (
                      <div key={role} className="flex items-center gap-2 text-[12px]">
                        <span className="flex-1 text-ink-2">
                          {role} · pending {daysAgo(selectedFeature?.entered_state_at)}d
                        </span>
                        {runId != null && (
                          <Button
                            variant="secondary"
                            onClick={() => navigate(`/gate/${runId}/RELEASE_GATE`)}
                            className="text-[11px] py-1 px-2"
                          >
                            Sign now →
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {blast && (
              <div className="flex flex-col gap-3">
                <ScopeCard num={1} title="Code" ok>
                  <p>
                    <strong>{direct} files</strong> are changing. {cochange} more often change at the same time — their
                    owners should be aware.
                  </p>
                </ScopeCard>

                <ScopeCard num={2} title="Tests" ok={blast.scope2_gaps.length === 0}>
                  {blast.scope2_gaps.length === 0 ? (
                    <p>
                      <strong>All changed files have test coverage</strong> — nothing is going out untested ✓
                    </p>
                  ) : (
                    <>
                      <p>
                        <strong>
                          {blast.scope2_gaps.length} changed file{blast.scope2_gaps.length === 1 ? '' : 's'} have no test
                        </strong>{' '}
                        — this blocks release until covered:
                      </p>
                      <ul className="list-disc pl-4">
                        {blast.scope2_gaps.map((f) => (
                          <li key={f} className="font-mono text-[11px]">{f}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </ScopeCard>

                <ScopeCard num={3} title="Operations" ok={blast.scope3_ops.length === 0}>
                  {blast.scope3_ops.length === 0 ? (
                    <p>No downstream dependencies affected.</p>
                  ) : (
                    <>
                      <p>
                        <strong>
                          {blast.scope3_ops.length} event{blast.scope3_ops.length === 1 ? '' : 's'} or service
                          {blast.scope3_ops.length === 1 ? '' : 's'}
                        </strong>{' '}
                        that other teams depend on are in the blast radius:
                      </p>
                      <ul className="list-disc pl-4">
                        {blast.scope3_ops.map((o, i) => (
                          <li key={i}>Event: {o.label} — {o.detail || 'no further detail'}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </ScopeCard>

                <ScopeCard num={4} title="Your responsibility" ok={governed.length === 0}>
                  {governed.length === 0 ? (
                    <p>No regulatory exposure in this release.</p>
                  ) : (
                    governed.map((reg) => (
                      <p key={reg}>
                        <strong>{reg}</strong> applies here — this is why <strong>{complianceRole}</strong> is a required
                        approver.
                      </p>
                    ))
                  )}
                </ScopeCard>
              </div>
            )}

            {a10?.isStub && (
              <p className="text-[11px] text-ink-3">
                Release Checker report generated without an LLM — using the stub summary.
              </p>
            )}

            {approvalSet.length > 0 && (
              <div className="bg-surface-3 border border-line rounded-[8px] p-4 flex flex-col gap-2">
                <p className="text-[12px] font-[500] text-ink-1">
                  Who needs to approve this release — derived from what&apos;s changing, not configured manually:
                </p>
                <ul className="flex flex-col gap-1.5">
                  {approvalSet.map((role) => (
                    <li key={role} className="text-[12px] text-ink-2">
                      <strong>{role}</strong> → {explainRole(role, { governed, direct, segments })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
