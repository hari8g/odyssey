import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, RefreshCw, Loader2, Upload, ChevronDown, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { useAepStore } from '@/store/aep.store'
import { EmptyState, usePeek, useToast } from '@/design/primitives'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

type Tab = 'packs' | 'contexts' | 'concepts' | 'kpis' | 'rules' | 'regulations'

type RuleRow = {
  id: number
  label: string
  description: string | null
  enforces_count: number
  context_label: string | null
}

type RegRow = {
  id: number
  label: string
  description: string | null
}

type HypRow = {
  id: number
  label: string
  kpiLabel?: string
  kpi_label?: string
  status?: string
  verdict?: string
  direction?: string
  magnitudePct?: number
  magnitude_pct?: number
  timeframeDays?: number
  timeframe_days?: number
}

export function DomainBrowserPanel() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { push } = useToast()
  const peek = usePeek()

  const [tab, setTab] = useState<Tab>('packs')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [rules, setRules] = useState<RuleRow[]>([])
  const [regulations, setRegulations] = useState<RegRow[]>([])
  const [hypotheses, setHypotheses] = useState<HypRow[]>([])
  const [expandedReg, setExpandedReg] = useState<number | null>(null)
  const [regFiles, setRegFiles] = useState<
    Record<number, { id: number; label: string; file_path: string | null }[]>
  >({})
  const [showMoreReg, setShowMoreReg] = useState<Record<number, boolean>>({})

  const { domainPacks, kpis, contexts, concepts, setDomainPacks, setKpis, setContexts, setConcepts } =
    useAepStore()

  const refresh = useCallback(async () => {
    const [packs, kpisData, ctxData, conceptsData, rulesData, regsData, hyps] = await Promise.all([
      eAPI.domainListPacks?.() ?? [],
      eAPI.domainGetKpis?.() ?? [],
      eAPI.domainGetContexts?.() ?? [],
      eAPI.domainGetConcepts?.() ?? [],
      eAPI.domainGetRules?.() ?? [],
      eAPI.domainGetRegulations?.() ?? [],
      eAPI.aepGetHypotheses?.() ?? [],
    ])
    setDomainPacks(Array.isArray(packs) ? packs : [])
    setKpis(Array.isArray(kpisData) ? kpisData : [])
    setContexts(Array.isArray(ctxData) ? ctxData : [])
    setConcepts(Array.isArray(conceptsData) ? conceptsData : [])
    setRules(Array.isArray(rulesData) ? rulesData : [])
    setRegulations(Array.isArray(regsData) ? regsData : [])
    setHypotheses(Array.isArray(hyps) ? hyps : [])
  }, [setDomainPacks, setKpis, setContexts, setConcepts])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const pre = params.get('regulation')
    if (pre) {
      setTab('regulations')
      const match = regulations.find((r) => r.label === pre || String(r.id) === pre)
      if (match) setExpandedReg(match.id)
    }
  }, [params, regulations])

  const betsByKpi = useMemo(() => {
    const map = new Map<string, HypRow[]>()
    for (const h of hypotheses) {
      const key = (h.kpiLabel ?? h.kpi_label ?? '').toLowerCase()
      if (!key) continue
      const list = map.get(key) ?? []
      list.push(h)
      map.set(key, list)
    }
    return map
  }, [hypotheses])

  const runPassD = async () => {
    setLoading(true)
    setStatus('Running Pass D…')
    setValidationErrors([])
    try {
      const result = await eAPI.domainRunPassD?.()
      if (result?.error) {
        setStatus(`Error: ${result.error}`)
        push({ message: result.error, status: 'danger' })
      } else {
        const n = result?.packsLoaded ?? 0
        const nodes = result?.nodes ?? 0
        setStatus(`Pass D complete — ${n} pack(s), ${nodes} nodes`)
        push({
          message: `✓ Domain packs loaded — ${nodes} concepts, rules, KPIs indexed`,
          status: 'ok',
        })
      }
      if (Array.isArray(result?.errors)) setValidationErrors(result.errors)
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  const loadPack = async () => {
    const dlg = await eAPI.showOpenDialog?.({
      title: 'Load Domain Pack',
      filters: [{ name: 'Domain packs', extensions: ['yaml', 'yml'] }],
      properties: ['openFile'],
    })
    const filePath = dlg?.filePaths?.[0]
    if (!filePath) return
    setLoading(true)
    setValidationErrors([])
    try {
      const result = await eAPI.domainLoadPack?.(filePath)
      if (result?.error) {
        push({ message: result.error, status: 'danger' })
        setStatus(`Error: ${result.error}`)
      } else {
        const packName = filePath.split(/[/\\]/).pop() ?? 'pack'
        const nodes = result?.nodes ?? 0
        push({
          message: `✓ ${packName} loaded — ${nodes} concepts, rules, KPIs indexed`,
          status: 'ok',
        })
        setStatus(`Loaded ${packName}`)
        if (Array.isArray(result?.errors)) setValidationErrors(result.errors)
      }
      await refresh()
      setTab('packs')
    } finally {
      setLoading(false)
    }
  }

  const expandRegulation = async (id: number) => {
    if (expandedReg === id) {
      setExpandedReg(null)
      return
    }
    setExpandedReg(id)
    if (!regFiles[id]) {
      const files = (await eAPI.domainGetContextFiles?.({ regulationId: id })) ?? []
      setRegFiles((prev) => ({ ...prev, [id]: Array.isArray(files) ? files : [] }))
    }
  }

  const openKpiBets = (kpiLabel: string, bets: HypRow[]) => {
    peek.open(
      <ul className="space-y-2 text-xs">
        {bets.length === 0 ? (
          <li className="text-gray-500">No bets linked to this KPI yet.</li>
        ) : (
          bets.map((b) => (
            <li key={b.id} className="border border-border rounded px-2 py-1.5 bg-surface-3">
              <div className="text-gray-200 font-medium">{b.label}</div>
              <div className="text-gray-500 mt-0.5">
                {b.verdict ?? b.status ?? 'pending'}
                {b.magnitudePct != null || b.magnitude_pct != null
                  ? ` · ${b.direction ?? ''} ${b.magnitudePct ?? b.magnitude_pct}%`
                  : ''}
              </div>
            </li>
          ))
        )}
      </ul>,
      `Bets on ${kpiLabel}`,
    )
  }

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: 'packs', label: 'Packs', count: domainPacks.length },
    { id: 'contexts', label: 'Contexts', count: contexts.length },
    { id: 'concepts', label: 'Concepts', count: concepts.length },
    { id: 'kpis', label: 'KPIs', count: kpis.length },
    { id: 'rules', label: 'Rules', count: rules.length },
    { id: 'regulations', label: 'Regulations', count: regulations.length },
  ]

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-gray-300 font-medium">
          <BookOpen size={14} />
          <span>Domain Browser</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => void refresh()}
            className="p-1 text-gray-500 hover:text-gray-200 hover:bg-surface-3 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => void loadPack()}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-surface-3 hover:bg-surface-2 text-gray-300 border border-border rounded transition-colors disabled:opacity-50"
          >
            <Upload size={11} />
            Load Domain Pack
          </button>
          <button
            onClick={() => void runPassD()}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent rounded transition-colors disabled:opacity-50"
            title="Run Pass D to index domain packs"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            Run Pass D
          </button>
        </div>
      </div>

      {status && (
        <div className="px-4 py-1 text-xs text-gray-400 border-b border-border bg-surface shrink-0">
          {status}
        </div>
      )}

      {validationErrors.length > 0 && (
        <details className="px-4 py-2 border-b border-danger/30 bg-danger/5 text-xs text-danger">
          <summary className="cursor-pointer font-medium">
            {validationErrors.length} validation error(s)
          </summary>
          <ul className="mt-1 space-y-0.5 list-disc pl-4">
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex border-b border-border shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
              tab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1 rounded bg-surface-3 text-gray-400">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'packs' && (
          <div className="p-2 space-y-1">
            {domainPacks.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No domain packs loaded"
                body="Load mlff-tolling.pack.yaml or run Pass D to index packs in .riaf/domain_packs/."
                action={{ label: 'Load Domain Pack', onClick: () => void loadPack() }}
              />
            ) : (
              domainPacks.map((pack) => (
                <div
                  key={pack.name}
                  className="px-3 py-2 rounded bg-surface-2 border border-border/50 hover:border-border transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-accent">{pack.name}</span>
                    <span className="text-xs text-gray-600">v{pack.version}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{pack.node_count} nodes</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'contexts' && (
          <div className="p-2 space-y-1">
            {contexts.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No bounded contexts"
                body="Load a domain pack that declares contexts."
              />
            ) : (
              contexts.map((ctx) => (
                <div key={ctx.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="text-xs font-medium text-gray-200">{ctx.label}</div>
                  {ctx.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ctx.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'concepts' && (
          <div className="p-2 space-y-1">
            {concepts.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No domain concepts"
                body="Glossary terms and concepts appear after Pass D."
              />
            ) : (
              concepts.map((c) => (
                <div key={c.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-200">{c.label}</span>
                    <span className="px-1 rounded text-xs bg-surface-3 text-gray-500">
                      {(c as { kind?: string }).kind === 'GLOSSARY_TERM' ? 'term' : 'concept'}
                    </span>
                  </div>
                  {c.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{c.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'kpis' && (
          <div className="p-2 space-y-1">
            {kpis.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No KPIs indexed"
                body="Domain packs declare measurable outcomes as KPIs."
              />
            ) : (
              kpis.map((kpi) => {
                const bets = betsByKpi.get(kpi.label.toLowerCase()) ?? []
                return (
                  <div key={kpi.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-gray-200">{kpi.label}</div>
                      <button
                        type="button"
                        onClick={() => openKpiBets(kpi.label, bets)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-decide/40 bg-decide/10 text-decide hover:bg-decide/20"
                      >
                        Bets {bets.length}
                      </button>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      {kpi.baseline_value != null && <span>baseline: {kpi.baseline_value}</span>}
                      {kpi.target_value != null && <span>target: {kpi.target_value}</span>}
                      {kpi.measurement_unit && <span>{kpi.measurement_unit}</span>}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {tab === 'rules' && (
          <div className="p-2 space-y-1">
            {rules.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No business rules"
                body="Rules from the domain pack will show enforcement gaps here."
              />
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="px-3 py-2 rounded bg-surface-2 border border-border/50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-200">{rule.label}</span>
                    {rule.context_label && (
                      <span className="text-[10px] text-gray-600 font-mono">{rule.context_label}</span>
                    )}
                    {(rule.enforces_count ?? 0) === 0 && (
                      <button
                        type="button"
                        title="No ENFORCES edge to a TEST_CASE"
                        onClick={() =>
                          navigate(
                            `/room/features?context=${encodeURIComponent(rule.context_label ?? '')}`,
                          )
                        }
                        className="text-[10px] px-1.5 py-0.5 rounded border border-warn/40 bg-warn/10 text-warn"
                      >
                        ⚠ No enforcing test
                      </button>
                    )}
                  </div>
                  {rule.description && (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{rule.description}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'regulations' && (
          <div className="p-2 space-y-1">
            {regulations.length === 0 ? (
              <EmptyState
                verb="DEFINE"
                title="No regulations"
                body="Load a pack that includes regulation definitions."
              />
            ) : (
              regulations.map((reg) => {
                const open = expandedReg === reg.id
                const body = reg.description ?? ''
                const truncated = body.length > 200 && !showMoreReg[reg.id]
                const files = regFiles[reg.id] ?? []
                return (
                  <div
                    key={reg.id}
                    className="rounded bg-surface-2 border border-border/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => void expandRegulation(reg.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-3/50"
                    >
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="text-xs font-medium text-gray-200 flex-1">{reg.label}</span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 space-y-2 border-t border-border/40">
                        {body && (
                          <p className="text-xs text-gray-400 pt-2">
                            {truncated ? `${body.slice(0, 200)}…` : body}
                            {body.length > 200 && (
                              <button
                                type="button"
                                className="ml-1 text-accent underline"
                                onClick={() =>
                                  setShowMoreReg((s) => ({ ...s, [reg.id]: !s[reg.id] }))
                                }
                              >
                                {showMoreReg[reg.id] ? 'show less' : 'show more'}
                              </button>
                            )}
                          </p>
                        )}
                        <p className="text-[10px] text-warn">
                          This regulation triggers Compliance sign-off on releases touching these
                          files
                        </p>
                        {files.length === 0 ? (
                          <p className="text-[11px] text-gray-600">No governed files linked yet.</p>
                        ) : (
                          <ul className="space-y-0.5">
                            {files.map((f) => (
                              <li key={f.id} className="text-[11px] font-mono text-gray-400 truncate">
                                {f.file_path ?? f.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
