import { useState, type ReactNode } from 'react'
import {
  BookOpen,
  Radio,
  Briefcase,
  GitBranch,
  Layers,
  Package,
  Rocket,
  Target,
  RefreshCw,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Users,
  Shield,
  Activity,
  Lightbulb,
  Workflow,
  CircleDot,
  MessageCircleQuestion,
  Scale,
  Eye,
  TrendingUp,
  Map,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

type LayerId = 'overview' | 'L-2' | 'L-1' | 'L0' | 'L1-3' | 'L+4' | 'L+5' | 'loop'

type LayerDef = {
  id: LayerId
  /** Short label for the rail (business-friendly, no L−2 / Pass codes). */
  label: string
  title: string
  question: string
  Icon: LucideIcon
  accent: string
  accentBg: string
  accentBorder: string
  /** Plain-language things this stage tracks. */
  tracks: string[]
  /** Plain-language activities that happen here. */
  activities: string[]
  panels: string[]
  steps: { title: string; detail: string }[]
}

const LAYERS: LayerDef[] = [
  {
    id: 'L-2',
    label: 'Customers',
    title: 'Customer voice',
    question: 'What are customers asking for — and how often?',
    Icon: Radio,
    accent: 'text-sky-400',
    accentBg: 'bg-sky-400/10',
    accentBorder: 'border-sky-400/30',
    tracks: ['Customer feedback', 'Repeated problems', 'Customer groups', 'Jobs to be done'],
    activities: ['Bring in feedback', 'Group similar complaints'],
    panels: ['Customer Signals'],
    steps: [
      {
        title: 'Collect what customers say',
        detail:
          'Pull in support tickets, survey comments, sales notes, or type them in by hand — so feedback is not stuck in one person’s inbox.',
      },
      {
        title: 'Group the same problem once',
        detail:
          'Similar complaints are clustered into one clear problem. You see how often it shows up instead of debating anecdotes.',
      },
      {
        title: 'Start work from real need',
        detail:
          'New initiatives begin from these problems. Every piece of work can answer: which customer pain is this for?',
      },
    ],
  },
  {
    id: 'L-1',
    label: 'Value',
    title: 'Business value',
    question: 'Is this worth doing — and what should improve?',
    Icon: Briefcase,
    accent: 'text-amber-400',
    accentBg: 'bg-amber-400/10',
    accentBorder: 'border-amber-400/30',
    tracks: ['Business goals', 'Success bets', 'Cost estimates', 'Teams & investment'],
    activities: ['Write a brief', 'Estimate impact', 'Decide go / no-go'],
    panels: ['Business Value', 'Value Stream'],
    steps: [
      {
        title: 'Turn a problem into a brief',
        detail:
          'Pick the customer problems that matter and write a short brief: what we think we should do and why.',
      },
      {
        title: 'Write a clear success bet',
        detail:
          'Before building, agree what “better” means — e.g. dispute time from 5 days to 2. That promise stays with the work.',
      },
      {
        title: 'Decide: do it, defer, or stop',
        detail:
          'Leaders see the packet in one place and record admit, defer, or reject with a reason — not a decision lost in a meeting.',
      },
    ],
  },
  {
    id: 'L0',
    label: 'Language',
    title: 'Shared business language',
    question: 'Do we all mean the same thing when we say “dispute” or “charge”?',
    Icon: BookOpen,
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-400/10',
    accentBorder: 'border-emerald-400/30',
    tracks: ['Business terms', 'Rules', 'Key metrics', 'Business areas', 'Regulations'],
    activities: ['Load your domain glossary', 'Link work to real terms'],
    panels: ['Domain Browser'],
    steps: [
      {
        title: 'Load how your business talks',
        detail:
          'Bring in your glossary, rules, metrics, and regulated areas — the words product, engineering, and ops already use day to day.',
      },
      {
        title: 'Connect terms to the real systems',
        detail:
          'Those terms are linked to the parts of the product that implement them, so “dispute” points at the same thing for everyone.',
      },
      {
        title: 'Keep features in business language',
        detail:
          'Work items are tied to those terms. Conversations stay about the business — not invented labels that mean different things to different teams.',
      },
    ],
  },
  {
    id: 'L1-3',
    label: 'Product & code',
    title: 'Features and the codebase',
    question: 'What are we building, and what in the product does it touch?',
    Icon: GitBranch,
    accent: 'text-violet-400',
    accentBg: 'bg-violet-400/10',
    accentBorder: 'border-violet-400/30',
    tracks: ['Features', 'Code areas', 'Services', 'Tests', 'Links to code'],
    activities: ['Map features to code', 'Spot what usually changes together'],
    panels: ['Features', 'ISS Graph', 'PO Workbench', 'Impact'],
    steps: [
      {
        title: 'See how the product is structured',
        detail:
          'The codebase is mapped into understandable pieces — modules, services, tests — so you are not guessing where work lives.',
      },
      {
        title: 'Know what usually changes together',
        detail:
          'History shows which parts of the product tend to move as a set. That warns you before a “small change” surprises another team.',
      },
      {
        title: 'Link each feature to real code',
        detail:
          'Features from tickets, docs, or manual entry are connected to the code that implements them — so impact is visible before you commit the sprint.',
      },
    ],
  },
  {
    id: 'L+4',
    label: 'Delivery',
    title: 'Build, test, and release',
    question: 'What shipped — and who needed to say yes?',
    Icon: Rocket,
    accent: 'text-orange-400',
    accentBg: 'bg-orange-400/10',
    accentBorder: 'border-orange-400/30',
    tracks: ['Builds', 'Release candidates', 'Test results', 'Deployments', 'Incidents'],
    activities: ['Record pipeline results', 'Check blast radius', 'Release with guardrails'],
    panels: ['Consolidation'],
    steps: [
      {
        title: 'Keep delivery on the same story',
        detail:
          'Builds, tests, and deployments stay attached to the original feature — not only in a separate CI dashboard.',
      },
      {
        title: 'See who and what is affected',
        detail:
          'Before release you see impact across code, tests, operations, and other teams — and who should approve when it matters.',
      },
      {
        title: 'Ship with eyes open',
        detail:
          'If a key metric goes the wrong way after release, that is flagged and can pause the rollout instead of being discovered days later.',
      },
    ],
  },
  {
    id: 'L+5',
    label: 'Results',
    title: 'Outcomes and learning',
    question: 'Did the bet pay off — and what should we do next?',
    Icon: Target,
    accent: 'text-rose-400',
    accentBg: 'bg-rose-400/10',
    accentBorder: 'border-rose-400/30',
    tracks: ['Metric readings', 'Bet results', 'Impact by team', 'Outcomes', 'Lessons'],
    activities: ['Compare predicted vs actual', 'Record the verdict', 'Feed the next cycle'],
    panels: ['Outcomes'],
    steps: [
      {
        title: 'Look at the numbers you promised',
        detail:
          'After go-live, record what the metric actually did — manually or from your monitoring — next to the original bet.',
      },
      {
        title: 'Say clearly: worked, didn’t, or too early',
        detail:
          'Each success bet gets a simple verdict. Teams and leaders can find it later — not buried in a slide deck.',
      },
      {
        title: 'Carry lessons into the next plan',
        detail:
          'What you learned feeds the next set of customer problems and goals, so the organisation gets sharper — not just busier.',
      },
    ],
  },
  {
    id: 'loop',
    label: 'Flow & approvals',
    title: 'Keeping work moving safely',
    question: 'Where is each initiative, and who must approve the next step?',
    Icon: RefreshCw,
    accent: 'text-teal-400',
    accentBg: 'bg-teal-400/10',
    accentBorder: 'border-teal-400/30',
    tracks: ['Decision records', 'Work stage', 'How accurate our bets were', 'Who owns what'],
    activities: ['Advance when ready', 'Human approvals', 'Improve over time'],
    panels: ['Value Stream'],
    steps: [
      {
        title: 'Follow a clear path',
        detail:
          'Each initiative moves through familiar stages: intake → qualify → prioritise → define → build → consolidate → release → observe → learn.',
      },
      {
        title: 'Only move when evidence is ready',
        detail:
          'The next stage unlocks when the previous proof is in place. Blocked work shows what is still missing — not a mystery status.',
      },
      {
        title: 'People approve where it matters',
        detail:
          'Important steps wait for a human yes, with the decision recorded. Over time you also see how well past bets matched reality.',
      },
    ],
  },
]

const STREAM_STATES = [
  { id: 'INTAKE', label: 'Intake' },
  { id: 'QUALIFY', label: 'Qualify' },
  { id: 'PRIORITIZE', label: 'Prioritise' },
  { id: 'DEFINE', label: 'Define' },
  { id: 'BUILD', label: 'Build' },
  { id: 'CONSOLIDATE', label: 'Consolidate' },
  { id: 'RELEASE', label: 'Release' },
  { id: 'OBSERVE', label: 'Observe' },
  { id: 'LEARN', label: 'Learn' },
] as const

const QUICKSTART = [
  {
    n: 1,
    title: 'Open your product repo',
    detail: 'Index the workspace so features can be linked to real code.',
    Icon: Layers,
  },
  {
    n: 2,
    title: 'Load your business language',
    detail: 'In Domain Browser, load the glossary and rules for your domain.',
    Icon: BookOpen,
  },
  {
    n: 3,
    title: 'Bring in customer feedback',
    detail: 'In Customer Signals, paste tickets or notes and group them into problems.',
    Icon: Users,
  },
  {
    n: 4,
    title: 'Write a brief and a success bet',
    detail: 'In Business Value, turn a problem into a brief, then decide go / no-go.',
    Icon: Workflow,
  },
  {
    n: 5,
    title: 'Ship and check the result',
    detail: 'Keep delivery on the same story, then record whether the bet paid off.',
    Icon: Activity,
  },
]

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border border-border bg-surface-3 text-gray-400',
        className,
      )}
    >
      {children}
    </span>
  )
}

function LayerRail({
  active,
  onSelect,
}: {
  active: LayerId
  onSelect: (id: LayerId) => void
}) {
  return (
    <div className="flex flex-row lg:flex-col gap-0.5 shrink-0 w-full lg:w-[140px] overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
      <button
        onClick={() => onSelect('overview')}
        className={clsx(
          'flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors shrink-0',
          active === 'overview'
            ? 'bg-accent/15 text-accent border border-accent/30'
            : 'text-gray-500 hover:text-gray-200 hover:bg-surface-3 border border-transparent',
        )}
      >
        <Layers size={12} />
        <span className="font-medium">Overview</span>
      </button>
      <div className="hidden lg:block h-px bg-border my-1" />
      {LAYERS.map((layer) => (
        <button
          key={layer.id}
          onClick={() => onSelect(layer.id)}
          className={clsx(
            'flex items-center lg:items-start gap-2 px-2 py-1.5 rounded text-left transition-colors border shrink-0 max-w-[160px] lg:max-w-none',
            active === layer.id
              ? clsx(layer.accentBg, layer.accent, layer.accentBorder)
              : 'text-gray-500 hover:text-gray-200 hover:bg-surface-3 border-transparent',
          )}
        >
          <layer.Icon size={12} className="mt-0 lg:mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-xs font-medium leading-tight truncate">{layer.label}</span>
            <span className="hidden lg:block text-[10px] opacity-70 truncate mt-0.5">{layer.title}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function StackDiagram({ onSelect }: { onSelect: (id: LayerId) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {LAYERS.filter((l) => l.id !== 'loop').map((layer, i) => (
        <button
          key={layer.id}
          onClick={() => onSelect(layer.id)}
          className={clsx(
            'group flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all',
            layer.accentBorder,
            'bg-surface-3/60 hover:bg-surface-3',
          )}
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <div className={clsx('flex items-center justify-center w-8 h-8 rounded-md shrink-0', layer.accentBg)}>
            <layer.Icon size={14} className={layer.accent} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className={clsx('text-xs font-semibold', layer.accent)}>{layer.label}</span>
              <span className="text-xs text-gray-400 truncate">{layer.title}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{layer.question}</p>
          </div>
          <ChevronRight size={12} className="text-gray-600 group-hover:text-gray-400 shrink-0 transition-colors" />
        </button>
      ))}
      <button
        onClick={() => onSelect('loop')}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-teal-400/30 bg-teal-400/5 hover:bg-teal-400/10 text-left transition-all mt-1"
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-md shrink-0 bg-teal-400/10">
          <RefreshCw size={14} className="text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-teal-400">Flow & approvals</span>
            <span className="text-xs text-gray-400 truncate">Keeping work moving safely</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Lessons feed the next cycle · people approve where it matters
          </p>
        </div>
        <ChevronRight size={12} className="text-gray-600 shrink-0" />
      </button>
    </div>
  )
}

function StreamStrip() {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-center gap-1 min-w-max">
        {STREAM_STATES.map((state, i) => (
          <div key={state.id} className="flex items-center gap-1">
            <div className="px-2 py-1 rounded bg-surface-3 border border-border">
              <span className="text-[10px] text-gray-300">{state.label}</span>
            </div>
            {i < STREAM_STATES.length - 1 && (
              <ArrowRight size={10} className="text-gray-600 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

type OverviewMode = 'concept' | 'platform'

type JourneyStep = {
  Icon: LucideIcon
  label: string
  title: string
  whatHappens: string
  today: string
  withAep: string
  youGet: string
}

/** A simple, realistic path most teams already recognise. */
const JOURNEY: JourneyStep[] = [
  {
    Icon: MessageCircleQuestion,
    label: '1. Hear the problem',
    title: 'Customers keep saying the same thing',
    whatHappens:
      'Support tickets and sales notes mention the same issue — e.g. “disputes take too long.” Today that lives in Zendesk, Slack, and someone’s head.',
    today: 'Three people raise the same pain in three meetings. Nobody is sure how big it really is.',
    withAep: 'Those notes sit in one place, grouped as one problem. You can see how often it shows up.',
    youGet: 'You stop arguing about whether the problem is real.',
  },
  {
    Icon: Scale,
    label: '2. Make a clear bet',
    title: 'Agree what “better” means before building',
    whatHappens:
      'Before a sprint starts, someone writes: “We think dispute time drops from 5 days to 2.” That promise stays with the work.',
    today: 'The ticket says “improve disputes.” Six months later you shipped something — but nobody knows if it helped.',
    withAep: 'The bet is written down next to the feature. Later you can check if the number moved.',
    youGet: 'You know what you are trying to improve — not just what to build.',
  },
  {
    Icon: GitBranch,
    label: '3. See what will change',
    title: 'Find the real code and who else is affected',
    whatHappens:
      'The feature is linked to the services and files that handle disputes. You see what else might break before you commit the team.',
    today: 'Engineering guesses. Ops finds out after a release. Another team is surprised mid-sprint.',
    withAep: 'Related code and risky areas show up early. The right people are asked before work starts.',
    youGet: 'Fewer “we didn’t know that depended on this” moments.',
  },
  {
    Icon: Rocket,
    label: '4. Ship and keep the thread',
    title: 'Release without losing the original why',
    whatHappens:
      'Build and deploy still happen as usual — but they stay attached to the same problem and bet, not a separate tool trail.',
    today: 'By launch day, the original complaint is gone from the tools. Success = “we shipped.”',
    withAep: 'Anyone can open the feature and still see: problem → bet → what changed → when it went live.',
    youGet: 'One story from complaint to production — not five half-stories.',
  },
  {
    Icon: Eye,
    label: '5. Check if it worked',
    title: 'Look at the number you promised',
    whatHappens:
      'After go-live you compare: did dispute time actually drop? Yes, no, or “too early to say” — and that answer stays on the feature.',
    today: 'The roadmap moves on. The same pain comes back next quarter with a new ticket name.',
    withAep: 'You have a simple verdict. Next time you plan, you can see what worked last time.',
    youGet: 'You learn — instead of only shipping and hoping.',
  },
]

function OverviewToggle({
  mode,
  onChange,
}: {
  mode: OverviewMode
  onChange: (m: OverviewMode) => void
}) {
  return (
    <div className="inline-flex p-0.5 rounded-lg border border-border bg-surface-3/80">
      <button
        onClick={() => onChange('concept')}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
          mode === 'concept'
            ? 'bg-accent/20 text-accent'
            : 'text-gray-500 hover:text-gray-200',
        )}
      >
        <Lightbulb size={11} />
        The idea
      </button>
      <button
        onClick={() => onChange('platform')}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
          mode === 'platform'
            ? 'bg-accent/20 text-accent'
            : 'text-gray-500 hover:text-gray-200',
        )}
      >
        <Map size={11} />
        Platform map
      </button>
    </div>
  )
}

function ConceptOverview({ onExploreLayers }: { onExploreLayers: () => void }) {
  const [step, setStep] = useState(0)
  const [showToday, setShowToday] = useState(false)
  const current = JOURNEY[step]!

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <div className="rounded-xl border border-border bg-surface-3/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb size={14} className="text-accent" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent">The idea</span>
        </div>
        <h2 className="text-lg font-semibold text-gray-100 tracking-tight leading-snug">
          Keep one piece of work connected from “customers are complaining” to “did it help?”
        </h2>
        <p className="text-xs text-gray-400 mt-2.5 leading-relaxed max-w-2xl">
          Most teams already do these steps — just in different tools, with the “why” getting lost along the
          way. AEP is simply a shared place where that chain stays together. Click through a realistic example
          below.
        </p>
      </div>

      {/* Simple step picker */}
      <div className="flex flex-col gap-1.5">
        {JOURNEY.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setStep(i)
              setShowToday(false)
            }}
            className={clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors',
              i === step
                ? 'border-accent/40 bg-accent/10'
                : 'border-border bg-surface-3/30 hover:bg-surface-3/60',
            )}
          >
            <div
              className={clsx(
                'flex items-center justify-center w-7 h-7 rounded-md shrink-0',
                i === step ? 'bg-accent/20 text-accent' : 'bg-surface-2 text-gray-500',
              )}
            >
              <s.Icon size={13} />
            </div>
            <span
              className={clsx(
                'text-xs font-medium',
                i === step ? 'text-gray-100' : 'text-gray-400',
              )}
            >
              {s.label}
            </span>
            {i === step && <ChevronRight size={12} className="text-accent ml-auto shrink-0" />}
          </button>
        ))}
      </div>

      {/* Detail for selected step */}
      <div className="rounded-xl border border-border bg-surface-3/40 p-4 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{current.title}</h3>
          <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">{current.whatHappens}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowToday(false)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors',
              !showToday
                ? 'bg-accent-2/15 text-accent-2 border-accent-2/30'
                : 'bg-surface-2 text-gray-500 border-border hover:text-gray-300',
            )}
          >
            With AEP
          </button>
          <button
            type="button"
            onClick={() => setShowToday(true)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[10px] font-medium border transition-colors',
              showToday
                ? 'bg-danger/15 text-danger border-danger/30'
                : 'bg-surface-2 text-gray-500 border-border hover:text-gray-300',
            )}
          >
            How it usually goes
          </button>
        </div>

        <p
          className={clsx(
            'text-[11px] leading-relaxed px-3 py-2.5 rounded-lg border',
            showToday
              ? 'border-danger/20 bg-danger/5 text-gray-400'
              : 'border-accent-2/20 bg-accent-2/5 text-gray-400',
          )}
        >
          {showToday ? current.today : current.withAep}
        </p>

        <div className="flex gap-2 items-start px-3 py-2.5 rounded-lg border border-border bg-surface-2/40">
          <TrendingUp size={12} className="text-accent shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-300 leading-relaxed">
            <span className="text-gray-500">What you get: </span>
            {current.youGet}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => {
              setStep((s) => Math.max(0, s - 1))
              setShowToday(false)
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-gray-500 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
          >
            <ChevronLeft size={12} />
            Back
          </button>
          <button
            type="button"
            disabled={step === JOURNEY.length - 1}
            onClick={() => {
              setStep((s) => Math.min(JOURNEY.length - 1, s + 1))
              setShowToday(false)
            }}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-accent hover:text-accent/80 disabled:opacity-30 disabled:hover:text-accent transition-colors"
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-3/40 p-4">
        <div className="text-xs font-semibold text-gray-200 mb-2">In short</div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Same work you already do — hear a problem, decide what better looks like, change the right things,
          ship, then check the result. The difference is that those steps stay linked, so product, engineering,
          and ops are looking at the same story instead of rebuilding it in every tool.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 px-3 py-2.5 rounded-lg border border-accent/25 bg-accent/5">
        <p className="text-[11px] text-gray-400 leading-relaxed min-w-0 sm:max-w-md">
          Want how the stages fit together? Open{' '}
          <span className="text-gray-200 font-medium">Platform map</span>.
        </p>
        <button
          onClick={onExploreLayers}
          className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors shrink-0 w-full sm:w-auto"
        >
          <Map size={11} />
          View platform map
        </button>
      </div>
    </div>
  )
}

function PlatformOverview({ onSelect }: { onSelect: (id: LayerId) => void }) {
  return (
    <div className="flex flex-col gap-5 min-w-0">
      <div className="rounded-xl border border-border bg-surface-3/50 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Package size={14} className="text-accent" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-accent">How the stages fit</span>
        </div>
        <h2 className="text-base font-semibold text-gray-100 tracking-tight">
          From customer feedback to “did it help?”
        </h2>
        <p className="text-xs text-gray-400 mt-1.5 leading-relaxed max-w-xl">
          Each stage below is a familiar part of how organisations already work. Click one to see what it
          covers in plain language — and where to find it in the app.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Chip className="border-accent/30 text-accent/90">7 stages</Chip>
          <Chip>One shared story</Chip>
          <Chip>Human approvals</Chip>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Stages — click to explore
        </div>
        <StackDiagram onSelect={onSelect} />
      </div>

      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Where work sits as it moves
        </div>
        <StreamStrip />
        <p className="text-[11px] text-gray-600 mt-1.5">
          Every initiative has a clear stage. You advance it from the Value Stream panel when the previous
          evidence is ready.
        </p>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Suggested first run
        </div>
        <div className="grid gap-2 grid-cols-1">
          {QUICKSTART.map((step) => (
            <div
              key={step.n}
              className="flex gap-3 px-3 py-2.5 rounded-lg border border-border bg-surface-3/40"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/15 text-accent text-[10px] font-mono font-bold shrink-0">
                {step.n}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <step.Icon size={11} className="text-gray-500" />
                  <span className="text-xs font-medium text-gray-200">{step.title}</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 grid-cols-1 xl:grid-cols-3">
        {[
          {
            Icon: Shield,
            title: 'Safer change',
            detail: 'Regulated or fragile areas show up before release, with the right people asked to approve.',
          },
          {
            Icon: Lightbulb,
            title: 'Clear bets',
            detail: 'You write what should improve — and by how much — before anyone builds.',
          },
          {
            Icon: CircleDot,
            title: 'One thread',
            detail: 'Follow a single initiative from customer pain → change → release → result.',
          },
        ].map((card) => (
          <div key={card.title} className="px-3 py-2.5 rounded-lg border border-border bg-surface-3/30">
            <div className="flex items-center gap-1.5 mb-1">
              <card.Icon size={12} className="text-accent" />
              <span className="text-xs font-medium text-gray-200">{card.title}</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed">{card.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Overview({ onSelect }: { onSelect: (id: LayerId) => void }) {
  const [mode, setMode] = useState<OverviewMode>('concept')

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <OverviewToggle mode={mode} onChange={setMode} />
        <p className="text-[10px] text-gray-600 max-w-full sm:max-w-xs text-left sm:text-right leading-snug">
          {mode === 'concept'
            ? 'A simple example of how the work stays connected'
            : 'Stages of the workflow — in plain language'}
        </p>
      </div>
      {mode === 'concept' ? (
        <ConceptOverview onExploreLayers={() => setMode('platform')} />
      ) : (
        <PlatformOverview onSelect={onSelect} />
      )}
    </div>
  )
}

function LayerDetail({ layer }: { layer: LayerDef }) {
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className={clsx('rounded-xl border p-4', layer.accentBorder, layer.accentBg)}>
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-2/80 border border-border shrink-0">
            <layer.Icon size={18} className={layer.accent} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={clsx('text-xs font-semibold', layer.accent)}>{layer.label}</span>
              <h2 className="text-sm font-semibold text-gray-100">{layer.title}</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">{layer.question}</p>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          What happens here
        </div>
        <div className="flex flex-col gap-2">
          {layer.steps.map((step, i) => (
            <div key={step.title} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={clsx(
                    'flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono font-bold border',
                    layer.accentBg,
                    layer.accent,
                    layer.accentBorder,
                  )}
                >
                  {i + 1}
                </div>
                {i < layer.steps.length - 1 && <div className="w-px flex-1 bg-border my-1 min-h-[8px]" />}
              </div>
              <div className="pb-3 min-w-0">
                <div className="text-xs font-medium text-gray-200">{step.title}</div>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-3/40 p-3">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            What this stage tracks
          </div>
          <div className="flex flex-wrap gap-1">
            {layer.tracks.map((n) => (
              <Chip key={n}>{n}</Chip>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface-3/40 p-3">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Typical activities
          </div>
          <div className="flex flex-wrap gap-1">
            {layer.activities.map((a) => (
              <Chip key={a} className={clsx(layer.accentBorder, layer.accent)}>
                {a}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-3/40 p-3">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Where to look in the app
        </div>
        <div className="flex flex-wrap gap-1.5">
          {layer.panels.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-accent/10 text-accent border border-accent/20"
            >
              <ArrowRight size={10} />
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AepOnboarding() {
  const [active, setActive] = useState<LayerId>('overview')
  const layer = LAYERS.find((l) => l.id === active)

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 min-h-0 min-w-0 w-full">
      <LayerRail active={active} onSelect={setActive} />
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pr-0 lg:pr-1">
        {active === 'overview' || !layer ? (
          <Overview onSelect={setActive} />
        ) : (
          <LayerDetail layer={layer} />
        )}
      </div>
    </div>
  )
}
