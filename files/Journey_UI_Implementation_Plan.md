# Journey UI — Enterprise Experience Implementation Plan
### Making the L−2 → L+5 value stream intuitive and operable for the whole organization

> **Pre-conditions**: RIAF Studio + ISS v2 + AEP/OVG + Cycle Runner backend are implemented.
> All data and actions this UI needs already exist as `aep:*`, `domain:*`, and `cycle:*` IPC
> channels. This plan is a *presentation and interaction* layer — it adds no new backend
> capability except a handful of read-model queries (§13).
>
> **The problem this plan solves**: the current 11 panels are engineer workbenches.
> A GTM lead, compliance officer, or CPO opening the app today sees SQLite vocabulary
> (`VALUE_HYPOTHESIS`, `PACKAGED_IN`, FIS scores) and 11 undifferentiated sidebar icons.
> The workflow exists, but it is *discoverable only by people who already know it*.
>
> **The thesis**: one journey, six verbs, many doorways. The entire stack collapses into
> six plain-language stages — LISTEN → DECIDE → DEFINE → BUILD → SHIP → LEARN — rendered
> as a persistent Journey Bar. Every persona gets a role-aware home that opens onto the
> same journey at the point where their work lives. Every number is clickable down to its
> evidence. Every technical term has a human name first and the graph name on hover.

---

## Table of Contents

1. [Experience Principles](#1-experience-principles)
2. [The Six-Verb Model](#2-the-six-verb-model)
3. [Information Architecture & Navigation](#3-information-architecture)
4. [Design System Foundation](#4-design-system-foundation)
5. [Plain-Language Layer](#5-plain-language-layer)
6. [Screen 1 — Persona Home](#6-persona-home)
7. [Screen 2 — Journey Canvas](#7-journey-canvas)
8. [Screen 3 — Feature Story](#8-feature-story)
9. [Screen 4 — My Actions Inbox](#9-my-actions-inbox)
10. [Screen 5 — Decide Room (Gates)](#10-decide-room)
11. [Screen 6 — Learn Hub](#11-learn-hub)
12. [Workbench Refresh](#12-workbench-refresh)
13. [Read-Model Queries (only backend additions)](#13-read-model-queries)
14. [Onboarding, Empty States, Motion](#14-onboarding-empty-states-motion)
15. [Accessibility & Enterprise Requirements](#15-accessibility)
16. [File Structure](#16-file-structure)
17. [Milestones & Acceptance Gates](#17-milestones)
18. [Cursor Prompt Pack](#18-cursor-prompt-pack)

---

## 1. Experience Principles

**E1 — The journey is the interface.** Navigation is organized around the flow of value,
not around tools. The persistent Journey Bar (LISTEN→LEARN) is the app's spine; panels
become rooms you enter *from* the journey, never destinations you must memorize.

**E2 — Plain language first, graph language on demand.** Nobody outside engineering
should ever need to read `VALUE_HYPOTHESIS`. The UI says "the bet"; hovering shows
`VALUE_HYPOTHESIS · pre-registered, committed 12 Jun`. One dictionary file governs every
label (§5), so terminology is consistent and changeable in one place.

**E3 — Every number opens its evidence.** Any count, score, percentage, or verdict is a
button. Clicking walks one level down the graph: pain point count → the signals;
readiness → the blast radius; verdict → the observations. Trust in an evidence-based
system is built by letting people touch the evidence.

**E4 — Role-aware, never role-locked.** The home screen adapts to the selected role,
but nothing is hidden — a support agent can open the Learn Hub, a CPO can read code
traces. Personalization is a starting point, not a permission wall (real permissions,
if needed later, are an auth concern, not a UX one).

**E5 — Calm enterprise surface.** Generous whitespace, one accent color, semantic status
colors used sparingly, 150–250 ms motion, no gamification. The excitement comes from
the content (a validated bet, a closed loop), not from the chrome.

**E6 — Zero-training operability.** Every screen answers three questions without a
manual: *Where am I in the journey? What is the system waiting for? What can I do right
now?* Empty states teach; the first-run tour is skippable and replayable.

---

## 2. The Six-Verb Model

The 8 layers, 12 runner stages, and 9 FSM states are correct engineering but hostile
onboarding. The UI collapses them into six verbs that any employee understands in one
reading. This is a *presentation* mapping only — nothing in the backend changes.

| Verb | Tagline | Layers | Runner stages | Primary personas |
|---|---|---|---|---|
| **LISTEN** | Hear the customer | L−2 | SIGNALS, CLUSTER | Support, PM |
| **DECIDE** | Place the bet | L−1 | INTAKE, QUALIFY, PACKET, PORTFOLIO_GATE | Exec, PM, GTM, Finance |
| **DEFINE** | Agree what it means | L0, L1 | (DEFINE portion of BUILD) | PM, Domain experts, Eng |
| **BUILD** | Make it real | L2, L3 | BUILD | Engineering |
| **SHIP** | Release with eyes open | L+4 | CONSOLIDATE, RELEASE_GATE, ROLLOUT | Eng lead, Compliance, GTM |
| **LEARN** | Judge the bet, keep the lesson | L+5 ↺ | OBSERVE, LEARN, DONE | Everyone |

Verb colors (the only place layer colors survive into the new UI — everything else is
neutral + one accent):

```
LISTEN #E24B4A (coral) · DECIDE #D4537E (rose) · DEFINE #639922 (green)
BUILD  #7F77DD (violet) · SHIP   #378ADD (blue) · LEARN  #1D9E75 (teal)
```

Used at 12 % opacity for surfaces, full strength only for the 3 px stage indicator and
icons. This keeps the app calm while making "where am I" always answerable by color.

---

## 3. Information Architecture & Navigation

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TopBar:  [Workspace ▾]   JOURNEY BAR (six verbs, live)      [Role ▾] [⌘K] │
├──────────┬─────────────────────────────────────────────────────────────────┤
│ LeftRail │                                                                 │
│  Home    │                     CONTENT AREA                                │
│  Actions │   (Persona Home · Journey Canvas · Feature Story ·             │
│  Journeys│    Decide Room · Learn Hub · Workbench rooms)                  │
│  ────────│                                                                 │
│  Rooms ▾ │                                                                 │
│   Listen │                                                                 │
│   Decide │                                                                 │
│   Define │                                                                 │
│   Build  │                                                                 │
│   Ship   │                                                                 │
│   Learn  │                                                                 │
│  ────────│                                                                 │
│  Settings│                                                                 │
└──────────┴─────────────────────────────────────────────────────────────────┘
```

**Navigation rules:**

- **Journey Bar** (always visible): six verb pills, each showing a live count of features
  currently in that phase plus an amber dot if anything there needs a human. Clicking a
  pill opens the Journey Canvas scrolled/zoomed to that verb.
- **LeftRail → Rooms**: the existing 11 panels regrouped under their verb (Listen:
  CustomerSignal; Decide: BusinessValue; Define: DomainBrowser, FeaturePanel, PO
  Workbench; Build: UCG, Search, Symbols, RIAF, Impact; Ship: Consolidation; Learn:
  OutcomeDashboard). The Cycle Runner stepper lives inside each Feature Story.
- **⌘K command palette**: fuzzy jump to any feature, pain point, KPI, regulation, room,
  or action ("sign release for Fleet Dispute", "show the bet on dispute rate").
- **Deep-link contract**: every entity has a route —
  `/journey`, `/feature/:id`, `/actions`, `/room/:roomId`, `/gate/:runId/:gateType`,
  `/kpi/:id`, `/learning/:id`. Notifications, chips, and drill-downs all navigate by
  route; nothing opens dead-end modals for primary content (modals are reserved for
  confirmation and quick-peek).

**Role selector** (header): Executive · Product · Engineering · Compliance · GTM ·
Support. Persisted per user in localStorage-equivalent (electron store). Changes Home
composition and Actions filtering defaults only (E4).

---

## 4. Design System Foundation

Built on the existing React 18 + Tailwind stack. One new package:
`packages/renderer/src/design/` containing tokens, primitives, and patterns. All new
screens use only these primitives; workbench refresh (§12) migrates old panels onto them.

### 4.1 Tokens (Tailwind theme extension)

```typescript
// packages/renderer/tailwind.config.ts — theme.extend
export const journeyTheme = {
  colors: {
    // neutral scale (slightly warm, enterprise)
    canvas:  { DEFAULT: '#0B0C0E', light: '#F7F7F8' },
    surface: { 1: '#131417', 2: '#1B1D21', 3: '#24262B',
               l1: '#FFFFFF', l2: '#F1F1F3', l3: '#E7E7EA' },
    line:    { DEFAULT: '#2A2D33', strong: '#3D4149',
               l: '#E3E4E8', lstrong: '#CFD1D7' },
    ink:     { 1: '#F2F3F5', 2: '#A9ADB6', 3: '#6F747E',
               l1: '#17181B', l2: '#4E535D', l3: '#8A8F99' },
    accent:  { DEFAULT: '#6E5BFF', hover: '#5A47EB', soft: '#6E5BFF1F' },
    // semantic status
    ok:      { DEFAULT: '#2FBF8F', soft: '#2FBF8F1A' },
    warn:    { DEFAULT: '#E8A13C', soft: '#E8A13C1A' },
    danger:  { DEFAULT: '#E25C5C', soft: '#E25C5C1A' },
    info:    { DEFAULT: '#4C9AE8', soft: '#4C9AE81A' },
    // six verbs
    listen:  '#E24B4A', decide: '#D4537E', define: '#639922',
    build:   '#7F77DD', ship:   '#378ADD', learn:  '#1D9E75',
  },
  fontFamily: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
  },
  fontSize: {
    // 4-step scale only — enforced by lint rule
    display: ['22px', { lineHeight: '28px', fontWeight: '600' }],
    title:   ['15px', { lineHeight: '22px', fontWeight: '600' }],
    body:    ['13px', { lineHeight: '20px', fontWeight: '400' }],
    micro:   ['11px', { lineHeight: '16px', fontWeight: '500' }],
  },
  borderRadius: { card: '12px', control: '8px', pill: '999px' },
  boxShadow: {
    raise: '0 1px 2px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.20)',
    pop:   '0 8px 32px rgba(0,0,0,.35)',
  },
  transitionDuration: { fast: '150ms', base: '200ms', slow: '250ms' },
}
```

Light/dark via `class` strategy; default follows OS, toggle in Settings. Density toggle
(comfortable 8-pt grid / compact 6-pt) applied via a root class scaling paddings.

### 4.2 Primitive inventory (build once, reuse everywhere)

| Primitive | Notes |
|---|---|
| `Button` | primary / secondary / ghost / danger; loading state built in |
| `Card` | surface-2, radius-card, optional verb color top-border (3 px) |
| `StatTile` | big number + label + delta arrow + onClick (E3: always a button) |
| `Badge` | status + verb variants; dot-only compact mode |
| `EvidenceChip` | entity chip (icon + human label); click → route or Peek |
| `Peek` | right-side drawer, 420 px, for quick-view of any graph node |
| `DataTable` | sortable, sticky header, row → route; virtualized >100 rows |
| `Timeline` | vertical event list (used by Feature Story + Actions log) |
| `ProgressRibbon` | thin bar for pass/agent progress; indeterminate mode |
| `GateSeal` | the human-gate visual: amber ring, roles as avatars, ★ |
| `VerbPill` | Journey Bar unit: color dot, verb, count, attention dot |
| `EmptyState` | illustration slot + one-sentence teach + primary action |
| `Toast` / `Banner` | transient vs persistent messaging |
| `Sparkline` | 90-day inline trend for KPI tiles (SVG, no chart lib) |
| `ConfirmDialog` | destructive/gate confirmations, requires typed reason where specified |

### 4.3 Iconography & illustration

Lucide icons only (already available). Six verb glyphs: ear (LISTEN), scale (DECIDE),
book-open (DEFINE), hammer (BUILD), rocket (SHIP), refresh-ccw (LEARN). Empty-state
illustrations: simple two-tone line SVGs generated once, stored in `design/illustrations/`.

---

## 5. Plain-Language Layer

One file is the single source of every user-facing term. Nothing renders a graph kind
directly; everything goes through `t()`.

```typescript
// packages/renderer/src/design/dictionary.ts
export const DICT = {
  // entities — { human, hint } · hint shows on hover with the technical name
  CUSTOMER_SIGNAL:    { human: 'Customer voice',      hint: 'A single piece of raw feedback (CUSTOMER_SIGNAL)' },
  PAIN_POINT:         { human: 'Problem',             hint: 'Many voices, one named problem (PAIN_POINT)' },
  BRIEF:              { human: 'Case for action',     hint: 'A1 intake brief (BRIEF)' },
  VALUE_HYPOTHESIS:   { human: 'The bet',             hint: 'A falsifiable prediction on a KPI, locked before code (VALUE_HYPOTHESIS)' },
  BUSINESS_OBJECTIVE: { human: 'Company goal',        hint: 'BUSINESS_OBJECTIVE' },
  COST_ESTIMATE:      { human: 'Effort estimate',     hint: 'Range, never a point (COST_ESTIMATE)' },
  FEATURE:            { human: 'Initiative',          hint: 'The unit of commitment flowing through the journey (FEATURE)' },
  BOUNDED_CONTEXT:    { human: 'Product area',        hint: 'BOUNDED_CONTEXT' },
  BUSINESS_RULE:      { human: 'Rule',                hint: 'Formal, enforceable (BUSINESS_RULE)' },
  REGULATION:         { human: 'Regulation',          hint: 'External obligation with clause reference (REGULATION)' },
  KPI:                { human: 'Metric',              hint: 'Measured, owned, targeted (KPI)' },
  RELEASE_CANDIDATE:  { human: 'Release',             hint: 'RELEASE_CANDIDATE' },
  RELEASE_READINESS_REPORT: { human: 'Readiness check', hint: 'Computed, not asserted (RELEASE_READINESS_REPORT)' },
  DEPLOYMENT:         { human: 'Go-live',             hint: 'DEPLOYMENT' },
  KPI_OBSERVATION:    { human: 'Measurement',         hint: 'KPI_OBSERVATION' },
  HYPOTHESIS_VERDICT: { human: 'Verdict',             hint: 'Did the bet pay off? (HYPOTHESIS_VERDICT)' },
  IMPACT_ASSESSMENT:  { human: 'Impact for your team', hint: 'IMPACT_ASSESSMENT, one per org unit' },
  LEARNING:           { human: 'Lesson',              hint: 'Distilled, wired back upstream (LEARNING)' },
  DECISION_RECORD:    { human: 'Decision',            hint: 'Who decided, why, when (DECISION_RECORD)' },
  INCIDENT:           { human: 'Incident',            hint: 'INCIDENT' },

  // stages / statuses
  stage: {
    LISTEN: { title: 'Listen',  tag: 'Hear the customer' },
    DECIDE: { title: 'Decide',  tag: 'Place the bet' },
    DEFINE: { title: 'Define',  tag: 'Agree what it means' },
    BUILD:  { title: 'Build',   tag: 'Make it real' },
    SHIP:   { title: 'Ship',    tag: 'Release with eyes open' },
    LEARN:  { title: 'Learn',   tag: 'Judge the bet, keep the lesson' },
  },
  status: {
    waiting_gate:     'Needs a decision',
    waiting_external: 'Waiting on the world',
    running:          'Agents working',
    completed:        'Cycle complete',
    error:            'Needs attention',
    bounced:          'Sent back to fix',
    halted:           'Rollout halted automatically',
  },

  // phrase templates (keep verbs active, subject-first)
  phrases: {
    betLine: (kpi: string, dir: string, mag: number, days: number) =>
      `${dir === 'decrease' ? 'Cut' : dir === 'increase' ? 'Lift' : 'Hold'} ${kpi} by ${mag}% within ${days} days`,
    verdictValidated: (kpi: string, actual: number) =>
      `The bet paid off — ${kpi} moved ${actual.toFixed(1)}%`,
    verdictRefuted: (kpi: string, actual: number) =>
      `The bet did not pay off — ${kpi} moved only ${actual.toFixed(1)}%. That is a lesson, not a failure.`,
    gateWaiting: (roles: string[]) =>
      `Waiting on ${roles.join(', ')} to sign`,
  },
} as const

export const t = (kind: keyof typeof DICT | string) =>
  (DICT as Record<string, { human: string }>)[kind]?.human ?? kind
export const hint = (kind: string) =>
  (DICT as Record<string, { hint?: string }>)[kind]?.hint
```

Rendered via a `<Term kind="VALUE_HYPOTHESIS" />` component: shows `t()`, hover shows
`hint()` in a tooltip, ⌥-click copies the technical name. Engineers lose nothing;
everyone else gains a readable product.

---

## 6. Screen 1 — Persona Home

Route `/`. Composition driven by a config, not six hardcoded pages:

```typescript
// packages/renderer/src/screens/home/personaConfig.ts
export type HomeWidget =
  | 'actionsPreview'      // top 3 items from My Actions
  | 'journeyMini'         // compressed journey bar with counts
  | 'betsScoreboard'      // committed bets: pending/validated/refuted
  | 'painPointTrends'     // top problems by signal velocity
  | 'buildHealth'         // features in BUILD: traces, builds, blockers
  | 'complianceExposure'  // governed changes in flight + pending signatures
  | 'segmentImpact'       // outcomes by customer segment
  | 'signalIntake'        // ingest form + unclustered count
  | 'calibration'         // are our estimates getting better?
  | 'learningsFeed'       // latest lessons

export const PERSONA_HOME: Record<Role, HomeWidget[]> = {
  executive:   ['journeyMini', 'betsScoreboard', 'actionsPreview', 'calibration', 'learningsFeed'],
  product:     ['actionsPreview', 'painPointTrends', 'journeyMini', 'betsScoreboard'],
  engineering: ['actionsPreview', 'buildHealth', 'journeyMini', 'calibration'],
  compliance:  ['complianceExposure', 'actionsPreview', 'journeyMini'],
  gtm:         ['segmentImpact', 'betsScoreboard', 'painPointTrends', 'actionsPreview'],
  support:     ['signalIntake', 'painPointTrends', 'learningsFeed'],
}
```

Wireframe (executive):

```
┌─────────────────────────────────────────────────────────────────────┐
│ Good morning. 2 decisions are waiting on you.        [Go to Actions] │
│                                                                     │
│ ┌ Journey ────────────────────────────────────────────────────────┐ │
│ │ ●Listen 34  ●Decide 2!  ●Define 3  ●Build 8  ●Ship 1!  ●Learn 5 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ ┌ Bets scoreboard ───────────┐  ┌ Are we getting better? ─────────┐ │
│ │  6 committed               │  │  Estimate error, 4 cycles       │ │
│ │  ✓ 3 paid off  ✗ 1 lesson  │  │  38% → 31% → 27% → 24%  ↘ good │ │
│ │  ⏳ 2 still measuring       │  │  [See calibration]              │ │
│ │  [Open Learn Hub]          │  └─────────────────────────────────┘ │
│ └────────────────────────────┘                                      │
│ ┌ Latest lessons ─────────────────────────────────────────────────┐ │
│ │ 💡 Fleet churn is pricing-driven, not dispute UX  → informs …   │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

Every tile is a `StatTile`/`Card` composed from §4 primitives; every number routes
somewhere (E3). Greeting line = computed from Actions count; no motivational fluff.

---

## 7. Screen 2 — Journey Canvas

Route `/journey`. The org-wide living map — the six verbs as horizontal swim-columns,
initiatives as cards flowing left→right. This is the screen you put on the office TV.

```
┌ LISTEN ──────┬ DECIDE ─────┬ DEFINE ─────┬ BUILD ──────┬ SHIP ───────┬ LEARN ──────┐
│ 34 voices    │             │             │             │             │             │
│ 4 problems   │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │
│              │ │Bulk     │ │ │Fleet    │ │ │Recurring│ │ │OTP Login│ │ │Dispute  │ │
│ ↑12 this wk  │ │Dispute  │ │ │Dispute  │ │ │Billing  │ │ │  ★gate  │ │ │Speedup ✓│ │
│ [Problems]   │ │ ★forum  │ │ │2 bets   │ │ │ 8d      │ │ │2/3 signed│ │ │bet paid │ │
│              │ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │
└──────────────┴─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
   coral           rose          green         violet         blue          teal
```

**Spec:**

- Column header: verb, tagline (micro), live aggregate for that verb (LISTEN shows
  voices/problems; others show initiative count). Amber attention dot when any card
  inside needs a human.
- **InitiativeCard** (the unit): title, one status line in plain language
  (`Needs a decision` / `Agents working — A10 readiness` / `Waiting on the world —
  no build yet` / `Bet paid off`), days-in-stage, ★ GateSeal miniature when parked at a
  gate, red left-edge when bounced/halted. Click → Feature Story.
- Card *movement* between columns animates (200 ms translate + fade) when
  `cycle:update` pushes a stage change — the org literally watches value move.
- Filters row: by product area (bounded context), by owner org unit, by mode
  (live/demo hidden by default). Presentation Mode toggle (larger type, hides chrome,
  auto-cycles attention items) for the office display.
- LISTEN column is special: no initiative cards; instead top problems by signal count
  with sparkline of signal velocity, plus "Start an initiative from this problem"
  action (→ starts a cycle run pre-seeded with that pain point → jumps to its Story).

Data: one read-model query `ux:getJourneyBoard` (§13) — a single SQL pass returning
initiatives with verb, status line inputs, and attention flags.

---

## 8. Screen 3 — Feature Story

Route `/feature/:id`. The single most important comprehension screen: one initiative's
whole life told as a narrative timeline — the golden thread made human. Three zones:

```
┌ Fleet Dispute Management                                    ● BUILD 8d ┐
│ "Fleet operators cannot dispute charges in bulk" → 65 voices           │
│ Bets: Cut charge_dispute_rate by 15% in 90d (conf 55%) · +1 more       │
├──────────────────────────┬──────────────────────────────────────────────┤
│ THE STORY (timeline)     │  RIGHT RAIL (context)                       │
│ ● 65 customers said…     │  ┌ The bets ───────────────┐                │
│   [3 sample voices]      │  │ ⏳ dispute_rate −15%/90d │                │
│ ● We made the case  📄   │  │ ⏳ resolution_p95 −50%   │                │
│ ● We sized it: 6–9 wks   │  └──────────────────────────┘                │
│ ● ★ Forum admitted it    │  ┌ Rules & regulations ────┐                │
│   CPO · "clear churn…"   │  │ ⚠ NHAI-MLFF-SPEC-4.2    │                │
│ ● Building — 14 files    │  │   compliance will sign   │                │
│   traced, 3 builds       │  └──────────────────────────┘                │
│ ○ Readiness check        │  ┌ Who's involved ─────────┐                │
│ ○ Release sign-off       │  │ Eng Lead · Compliance ·  │                │
│ ○ Go-live                │  │ Customer Success         │                │
│ ○ Measuring the bet      │  └──────────────────────────┘                │
│ ○ Verdict & lesson       │  [Open engineering view]                     │
└──────────────────────────┴──────────────────────────────────────────────┘
```

**Spec:**

- **Header**: title, verb badge with days-in-stage, the origin problem sentence with
  voice count (click → Peek listing signals), bets as one-line phrases
  (`DICT.phrases.betLine`).
- **The Story timeline** = the Cycle Runner stepper, re-skinned as narrative. Same
  12 stages; done items are past-tense sentences with EvidenceChips; the active item
  is the expanded operative card (AgentProgress / Wait / Gate — reusing Cycle Runner
  blocks restyled on §4 primitives); future items are quiet one-liners. Bounces render
  inline: `↩ Sent back — 1 file had no test (view) — fixed in 2 days`.
- **Right rail**: bets card (live verdict status), rules/regulations touched
  (compliance sees themselves here *before* the gate), involved roles (from computed
  approval set + RACI), and an "Open engineering view" link into the Build rooms
  filtered to this feature.
- Non-engineering default hides file paths and FIS scores behind the engineering-view
  link; nothing is more than one click deep (E4).

---

## 9. Screen 4 — My Actions Inbox

Route `/actions`. The answer to "what does the system need from *me*?" — the screen
that makes the whole org feel the flow needs them.

**Item sources (all existing queries):** pending gates where my role ∈ unmet roles
(`aep:getPendingGates` + portfolio-gate parked runs), bounced/halted runs owned by my
unit, error-status runs (engineering), problems above signal threshold with no
initiative (product), hypotheses whose measurement window just closed (executive).

```
┌ My actions — Compliance Officer                          [All roles ▾] ┐
│ ● SIGN   Fleet Dispute release touches NHAI-MLFF-SPEC-4.2              │
│          2 of 3 signed · waiting 26h            [Review & sign →]      │
│ ● REVIEW Post-window reversal count drifting on governed code          │
│                                                  [Open metric →]       │
│ ✓ Done this week (3)                                       [expand]    │
└─────────────────────────────────────────────────────────────────────────┘
```

Rows are verb-first (`SIGN`, `DECIDE`, `FIX`, `REVIEW`, `START`), age-sorted, each with
exactly one primary action routing to the Decide Room or Story. Badge count on the
LeftRail Actions item; native OS notification (Electron) on new gate items — deep-links
via the route contract. Snooze (1d/1w) stored locally; no item can be dismissed without
either acting or snoozing — accountability without nagging.

---

## 10. Screen 5 — Decide Room (Gates)

Route `/gate/:runId/:gateType`. Gates are the moments the org actually touches the
system; they deserve a designed room, not a form. Both gates share a layout: evidence
left, decision right, consequences explicit.

**Portfolio gate:**

```
┌ Decide: admit "Fleet Dispute Management"?                              ┐
│ EVIDENCE                              │ YOUR DECISION                  │
│ Problem: 65 voices, ↑12/wk [hear 3]   │ ○ Admit — start building       │
│ Worth: $180–420k/yr (assumptions ▸)   │ ○ Defer — revisit later        │
│ Costs: 6–9 dev-weeks (basis ▸)        │ ○ Reject — close with reason   │
│ The bets you are locking:             │ Deciding as [CPO ▾]            │
│  · Cut dispute_rate 15%/90d (55%)     │ Why (required, recorded):      │
│  · Cut resolution_p95 50%/90d (70%)   │ [________________________]     │
│ Risks: 2 (▸) · Conflicts: none        │                                │
│ A5 recommends: ADMIT (score 7.2/10)   │ Locking these bets is permanent │
│                                       │ — they will be judged as-is.   │
│                                       │        [Record decision]       │
└─────────────────────────────────────────────────────────────────────────┘
```

**Release gate:** left = the four scopes as plain sentences ("14 files change; 3 more
usually change with them", "Everything changed is covered by tests ✓", "2 events other
teams consume", "Touches regulation NHAI-MLFF-SPEC-4.2 — that is why you're here"),
each expandable to the raw ScopeCard. Right = signature checklist with GateSeal,
per-role sign button enabled only for the selected role, rationale required.

Shared mechanics: `ConfirmDialog` with typed rationale (writes the DECISION_RECORD);
after deciding, a 2-second inline confirmation shows *what just happened* ("Bets locked.
Fleet Dispute moved to DEFINE.") then routes to the Story. Force-advance lives here too,
visually heavier (danger tone, typed reason ≥ 20 chars).

---

## 11. Screen 6 — Learn Hub

Route `/room/learn`. Reframes the Outcome Dashboard from analyst tool to organizational
ritual — the place the company reads its own report card.

Sections: **Verdicts** as sentence cards (`DICT.phrases.verdict*` — refutations styled
with identical weight to validations, teal vs slate, never red: a lesson is not an
error); **Impact for your team** auto-filtered to the selected role's org unit first,
others collapsed; **Lessons** feed where each lesson shows its INFORMS chips ("now
informing: A2's fleet estimates · Problem: fleet pricing") — the loop made visible;
**Are we getting better?** — the calibration trend as one honest line chart with a
plain caption ("Our value estimates were off by 38% four cycles ago; last cycle, 24%").
A "Cycle review" presentation mode renders these four sections as auto-paged slides for
the quarterly meeting — the app *is* the deck.

---

## 12. Workbench Refresh

The 11 existing panels are demoted to "rooms" and migrated onto §4 primitives — visual
consistency only, features untouched. Per-panel effort is mechanical: replace local
styles with `Card`/`DataTable`/`Badge`/`EmptyState`, route entity clicks through
`EvidenceChip`/`Peek`, wrap kinds in `<Term>`. Order of migration (by org visibility):
CustomerSignal → BusinessValue → Consolidation → OutcomeDashboard → DomainBrowser →
ValueStream (absorbed into Journey Canvas + Story; its Kanban is retired) → the five
engineering rooms last.

---

## 13. Read-Model Queries (only backend additions)

Three new IPC handlers in one new file `packages/main/src/ux/uxReadModels.ts` — pure
SELECTs, no writes, no new tables:

- `ux:getJourneyBoard` → initiatives with: id, title, verb (derived from runner stage /
  FSM state via the §2 mapping), plain status line inputs (status, unmet reason, days in
  stage, gate flag, bounce/halt flag), origin problem label + voice count, bet count.
  One query joining `cycle_runs` ⋈ `value_stream_state` ⋈ anchors.
- `ux:getFeatureStory` → the golden-thread query (already exists) + cycle timeline +
  approval roles + governed regulations, in one payload.
- `ux:getActions` → union of the §9 item sources with role filter param.

Each ships with a 5-second renderer-side cache invalidated by `cycle:update` /
`aep:streamStateChanged` pushes.

---

## 14. Onboarding, Empty States, Motion

**First-run tour** (5 stops, skippable, replayable from Settings): Journey Bar → a card
on the Canvas → a Story timeline → Actions → the role selector. Implemented as a
spotlight overlay (`design/tour.tsx`), content from `dictionary.ts`.

**Empty states teach the verb**: LISTEN empty = "No customer voices yet" + ingest/demo
actions; DECIDE empty = "Nothing to decide — that means Listen has no ripe problems"
with a link left. Every EmptyState names the upstream verb that feeds it, so the flow
teaches itself.

**Motion budget**: column-to-column card moves 200 ms; Peek slide 200 ms; gate seal
fills on final signature 250 ms; ProgressRibbon shimmer for agent work. Everything
respects `prefers-reduced-motion`. Nothing bounces, nothing loops for attention except
the single amber dot.

---

## 15. Accessibility & Enterprise Requirements

WCAG 2.1 AA contrast on all token pairs (verify in P0 with automated check); full
keyboard operability (Journey Bar arrow-navigable, cards Enter-to-open, gates
tab-complete); focus rings on accent; all EvidenceChips real `<button>`s with labels;
verb colors never the sole carrier of meaning (always paired with text/glyph);
timeline announced via `aria-live` on stage change; screen-reader strings from the
dictionary. Enterprise: audit visibility (every Decide Room shows prior
DECISION_RECORDs), Presentation Mode redacts nothing but hides actions, error states
always carry a Retry and a copyable diagnostic.

---

## 16. File Structure

```
packages/renderer/src/
├── design/
│   ├── tokens.ts · dictionary.ts · tour.tsx
│   ├── primitives/ (Button, Card, StatTile, Badge, EvidenceChip, Peek,
│   │                DataTable, Timeline, ProgressRibbon, GateSeal, VerbPill,
│   │                EmptyState, Toast, Sparkline, ConfirmDialog, Term)
│   └── illustrations/
├── shell/ (TopBar, JourneyBar, LeftRail, RoleSelector, CommandPalette, router.tsx)
├── screens/
│   ├── home/       (PersonaHome, personaConfig, widgets/)
│   ├── journey/    (JourneyCanvas, InitiativeCard, columns/)
│   ├── story/      (FeatureStory, StoryTimeline, RightRail)
│   ├── actions/    (ActionsInbox, ActionRow)
│   ├── gates/      (DecideRoom, PortfolioGateView, ReleaseGateView)
│   └── learn/      (LearnHub, VerdictCard, LessonCard, CalibrationChart)
├── store/ux/ux.store.ts
└── panels/… (existing rooms, migrated in place)

packages/main/src/ux/uxReadModels.ts        ← only backend file
```

**New files ≈ 45 renderer + 1 main. Modified: App.tsx (replaced by shell/router), the
11 panels (styling migration only), aepOrchestrator (register uxReadModels — 1 line).**

---

## 17. Milestones & Acceptance Gates

| Milestone | Scope | Acceptance gate |
|---|---|---|
| **M-UX0** | Tokens + primitives + Term/dictionary | Storybook-style gallery route renders all primitives in light/dark/compact; contrast check passes |
| **M-UX1** | Shell: router, TopBar, JourneyBar (static), LeftRail, RoleSelector, ⌘K | Deep-links resolve; role persists; old panels reachable as rooms |
| **M-UX2** | `uxReadModels.ts` + ux.store | Board/story/actions payloads correct against a seeded demo DB |
| **M-UX3** | Journey Canvas | Live counts; card animates between columns on cycle:update; presentation mode |
| **M-UX4** | Feature Story | Full demo-cycle feature renders all 12 narrative states incl. bounce; evidence chips peek correctly |
| **M-UX5** | Actions Inbox + notifications | Role-filtered items; gate deep-link; badge count; snooze persists |
| **M-UX6** | Decide Room (both gates) | Portfolio + release flows complete end-to-end from the room alone; DECISION_RECORDs carry rationale |
| **M-UX7** | Learn Hub | Verdict sentences, per-unit impact, lessons with INFORMS chips, calibration chart, cycle-review mode |
| **M-UX8** | Persona Homes ×6 | Config-driven; every widget number routes; executive home matches wireframe |
| **M-UX9** | Workbench migration + tour + empty states | All 11 rooms on primitives; tour replayable; zero raw kind-names visible anywhere (lint rule enforces `<Term>`) |
| **M-UX10** | A11y + polish pass | Keyboard-only full demo cycle possible; reduced-motion honored; axe audit clean |

**Definition of done for the whole plan**: a person from GTM who has never seen the app
completes this in under five minutes with no help: open app → pick role → see a problem
in LISTEN → open its Story → understand where it is and why → find their one pending
action → act on it.

---

## 18. Cursor Prompt Pack

**Prompt 1 (M-UX0):**
> Read §4–5 of `Journey_UI_Implementation_Plan.md`. Extend tailwind.config with
> journeyTheme, create `design/tokens.ts`, `design/dictionary.ts` with the Term
> component, and all primitives in `design/primitives/` per the inventory table.
> Add a `/gallery` dev route rendering every primitive in every variant, light and dark.
> Add an ESLint rule (no-restricted-syntax) flagging raw graph kind strings in JSX
> outside dictionary.ts.

**Prompt 2 (M-UX1):**
> Build the shell per §3 and §16: react-router with the deep-link contract, TopBar with
> JourneyBar (static counts for now), LeftRail with verb-grouped rooms mapping to the
> existing 11 panels, RoleSelector persisted via electron store, and a ⌘K palette
> (cmdk) indexing routes + features + KPIs. Replace App.tsx composition with the shell;
> keep all existing panels mounted as room routes unchanged.

**Prompt 3 (M-UX2):**
> Create `packages/main/src/ux/uxReadModels.ts` with the three handlers specified in
> §13, register in aepOrchestrator, and build `store/ux/ux.store.ts` with 5 s caches
> invalidated by cycle:update and aep:streamStateChanged. Write a vitest against the
> demo-seeded DB asserting the JourneyBoard verb derivation table from §2.

**Prompt 4 (M-UX3):** Journey Canvas per §7 including InitiativeCard states, move
animation on cycle:update, filters, LISTEN column special-case, presentation mode.

**Prompt 5 (M-UX4):** Feature Story per §8, reusing Cycle Runner stage blocks restyled
on primitives; narrative past-tense lines generated from cycle_stage_log; right rail;
engineering-view link.

**Prompt 6 (M-UX5/6):** Actions Inbox per §9 with OS notifications and snooze; Decide
Room per §10 for both gates, wired to cycle:portfolioGate / cycle:signRelease, with
typed-rationale ConfirmDialog and post-decision confirmation + routing.

**Prompt 7 (M-UX7/8):** Learn Hub per §11 including cycle-review presentation mode;
Persona Homes per §6 driven by personaConfig with all ten widgets.

**Prompt 8 (M-UX9/10):** Migrate the 11 panels onto primitives in the §12 order,
retire ValueStreamPanel into Canvas+Story, implement the 5-stop tour and all
empty states, then run the a11y pass: keyboard map, aria-live on timeline, axe clean,
reduced-motion.

---

*End of plan. The backend already speaks in evidence; this plan makes the whole
organization able to read it — six verbs, one journey, every number one click from
its proof.*
