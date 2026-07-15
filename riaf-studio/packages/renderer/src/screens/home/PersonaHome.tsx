import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, StatTile, Button, EmptyState } from '@/design/primitives'
import { useUXStore, type Role } from '@/store/ux/ux.store'

/** Where an INFORMS target routes to — mirrors the mapping used in Learn Hub. */
function informsRoute(target: string): string {
  if (/^Pain point:/i.test(target)) return '/room/signals'
  if (/^Business objective/i.test(target)) return '/journey?verb=DECIDE'
  if (/A2|fleet estimates/i.test(target)) return '/room/bizvalue'
  if (/^Hypothesis:/i.test(target)) return '/room/bizvalue'
  return '/room/learn'
}

function parseLessonTargets(description: string | null): string[] {
  if (!description) return []
  try {
    const d = JSON.parse(description) as { targets?: string[] }
    return Array.isArray(d.targets) ? d.targets : []
  } catch {
    return []
  }
}

type HomeWidget =
  | 'actionsPreview'
  | 'journeyMini'
  | 'betsScoreboard'
  | 'painPointTrends'
  | 'buildHealth'
  | 'complianceExposure'
  | 'segmentImpact'
  | 'signalIntake'
  | 'calibration'
  | 'learningsFeed'

const PERSONA_HOME: Record<Role, HomeWidget[]> = {
  executive: ['journeyMini', 'betsScoreboard', 'actionsPreview', 'calibration', 'learningsFeed'],
  product: ['actionsPreview', 'painPointTrends', 'journeyMini', 'betsScoreboard'],
  engineering: ['actionsPreview', 'buildHealth', 'journeyMini', 'calibration'],
  compliance: ['complianceExposure', 'actionsPreview', 'journeyMini'],
  gtm: ['segmentImpact', 'betsScoreboard', 'painPointTrends', 'actionsPreview'],
  support: ['signalIntake', 'painPointTrends', 'learningsFeed'],
}

function Widget({ id }: { id: HomeWidget }) {
  const navigate = useNavigate()
  const { board, actions, bets, painPoints, signalCount, learnings, actionCount } = useUXStore()

  switch (id) {
    case 'journeyMini':
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-3">Journey</p>
          <div className="flex flex-wrap gap-2">
            {(['LISTEN', 'DECIDE', 'DEFINE', 'BUILD', 'SHIP', 'LEARN'] as const).map((v) => {
              const n =
                v === 'LISTEN'
                  ? painPoints.length
                  : board.filter((b) => b.verb === v).length
              const needs = board.some((b) => b.verb === v && b.needsHuman)
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => navigate(`/journey?verb=${v}`)}
                  className="text-[12px] px-2.5 py-1 rounded-pill border border-line hover:border-line-strong text-ink-2"
                >
                  {v[0] + v.slice(1).toLowerCase()} {n}
                  {needs ? ' !' : ''}
                </button>
              )
            })}
          </div>
        </Card>
      )
    case 'betsScoreboard':
      return (
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Committed bets" value={bets.committed} onClick={() => navigate('/room/learn')} />
          <StatTile label="Still measuring" value={bets.pending} onClick={() => navigate('/journey?verb=LEARN')} />
          <StatTile label="Validated" value={bets.validated} onClick={() => navigate('/room/learn')} />
          <StatTile label="In flight" value={board.length} onClick={() => navigate('/journey')} />
        </div>
      )
    case 'actionsPreview':
      return (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">Your actions</p>
            <Button variant="ghost" onClick={() => navigate('/actions')}>
              All
            </Button>
          </div>
          {actions.length === 0 ? (
            <p className="text-[13px] text-ink-3">Nothing waiting on you right now.</p>
          ) : (
            <ul className="space-y-2">
              {actions.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => navigate(a.route)}
                    className="w-full text-left text-[13px] text-ink-1 hover:text-accent"
                  >
                    {a.title}
                    <span className="block text-[11px] text-ink-3">{a.sub}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )
    case 'painPointTrends':
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-3">Top problems</p>
          {painPoints.length === 0 ? (
            <EmptyState
              verb="LISTEN"
              title="No problems yet"
              body="Ingest customer voices to see problems here."
              action={{ label: 'Open Listen', onClick: () => navigate('/room/signals') }}
            />
          ) : (
            <ul className="space-y-2">
              {painPoints.slice(0, 5).map((pp) => (
                <li key={pp.id} className="flex justify-between text-[13px]">
                  <span className="text-ink-1 truncate pr-2">{pp.label}</span>
                  <span className="text-ink-3 shrink-0">{pp.signal_count} voices</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )
    case 'buildHealth': {
      const building = board.filter((b) => b.verb === 'BUILD' || b.verb === 'DEFINE')
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-3">Build health</p>
          <StatTile
            label="In DEFINE / BUILD"
            value={building.length}
            onClick={() => navigate('/journey?verb=BUILD')}
          />
        </Card>
      )
    }
    case 'complianceExposure': {
      const shipping = board.filter((b) => b.verb === 'SHIP')
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-3">Compliance</p>
          <StatTile
            label="In SHIP"
            value={shipping.length}
            sub={shipping.some((s) => s.needsHuman) ? 'Signatures waiting' : undefined}
            onClick={() => navigate('/journey?verb=SHIP')}
          />
        </Card>
      )
    }
    case 'segmentImpact':
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">Segment impact</p>
          <p className="text-[13px] text-ink-3">Open Learn Hub for org-unit impact after go-live.</p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/room/learn')}>
            Learn Hub
          </Button>
        </Card>
      )
    case 'signalIntake':
      return (
        <Card className="p-4">
          <StatTile
            label="Customer voices"
            value={signalCount}
            onClick={() => navigate('/room/signals')}
          />
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/room/signals')}>
            Ingest signals
          </Button>
        </Card>
      )
    case 'calibration':
      return (
        <Card className="p-4">
          <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide mb-2">
            Are we getting better?
          </p>
          <p className="text-[13px] text-ink-2">
            Calibration trends live in Learn Hub after cycles complete.
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => navigate('/room/learn')}>
            See calibration
          </Button>
        </Card>
      )
    case 'learningsFeed':
      return (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-[600] text-ink-3 uppercase tracking-wide">
              What we learned last cycle
            </p>
            <Button variant="ghost" onClick={() => navigate('/room/learn')}>
              See all lessons →
            </Button>
          </div>
          {learnings.length === 0 ? (
            <p className="text-[13px] text-ink-3">Complete your first cycle to see lessons here.</p>
          ) : (
            <ul className="space-y-3">
              {learnings.slice(0, 3).map((l) => {
                const targets = parseLessonTargets(l.description)
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => navigate('/room/learn')}
                      className="text-[13px] text-ink-1 hover:text-accent text-left"
                    >
                      💡 {l.label}
                    </button>
                    {targets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {targets.map((tgt, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => navigate(informsRoute(tgt))}
                            className="text-[10px] bg-surface-3 border border-line rounded-[4px] px-2 py-0.5 text-ink-3 hover:text-ink-1 hover:border-line-strong transition-colors"
                          >
                            informs: {tgt}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )
    default:
      return null
  }
}

export function PersonaHome() {
  const navigate = useNavigate()
  const { role, actionCount, refreshHome } = useUXStore()
  const widgets = PERSONA_HOME[role]

  useEffect(() => {
    void refreshHome()
  }, [refreshHome])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-display text-ink-1">
            {actionCount > 0
              ? `${actionCount} decision${actionCount === 1 ? '' : 's'} waiting on you.`
              : 'Good to go — nothing waiting on you.'}
          </p>
          <p className="text-[13px] text-ink-3 mt-1">
            Role: {(role?.[0] ?? 'P').toUpperCase() + (role?.slice(1) ?? 'roduct')}. Change it anytime in the
            header.
          </p>
        </div>
        {actionCount > 0 && (
          <Button onClick={() => navigate('/actions')}>Go to Actions</Button>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {widgets.map((w) => (
          <Widget key={w} id={w} />
        ))}
      </div>
    </div>
  )
}
