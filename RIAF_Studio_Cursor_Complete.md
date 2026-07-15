# RIAF Studio — Complete Cursor Implementation Guide
## Repo: https://github.com/hari8g/odyssey.git · Working directory: `riaf-studio/`

> **How to use this file**: Hand each numbered prompt to Cursor in order.
> Every prompt is self-contained: it tells Cursor exactly which files to read,
> what to write, and what the acceptance gate is. Do not skip prompts — each
> one assumes the previous is complete.
>
> **What already exists** (do not rewrite unless a prompt says so):
> - Full Electron + Vite monorepo scaffold (pnpm workspaces, electron-forge)
> - SQLite schema V1–V4 with all AEP/ISS/cycle tables
> - All 14 agent classes (A1–A14) with LLM + graceful stub fallback
> - Cycle orchestrator, stage definitions, demo simulator
> - Design system: tokens, primitives, dictionary (all in `packages/renderer/src/design/`)
> - Shell: AppShell, JourneyBar, LeftRail (all updated for plain-English navigation)
> - 6 Journey screens (PersonaHome, JourneyCanvas, FeatureStory, ActionsInbox,
>   DecideRoom, LearnHub) — partially implemented, need completion
> - CycleRunnerPanel — fully rewritten with plain-English labels and agent names
> - UX read models (`packages/main/src/ux/uxReadModels.ts`)
>
> **What needs to be built** (covered by this guide):
> - Completing the Journey screens with full interactivity
> - Completing the AEP panels (CustomerSignal, BusinessValue, Consolidation, Outcomes)
> - Wiring the learning loop so lessons inform the next cycle
> - ISS panels (Feature, PO Workbench, Impact) connected to domain layer
> - End-to-end demo flow validation

---

## Prerequisites (run once before any prompt)

```bash
cd riaf-studio

# Node 20 LTS required (better-sqlite3 prebuilt binaries)
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"  # macOS Homebrew
# OR: nvm use 20

node -v    # must be v20.x

# pnpm 9 required (project pins pnpm@9.15.9)
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm -v   # must be 9.x

pnpm install
pnpm dev   # open the app — you should see the shell with journey bar
```

---

## Ground rules for Cursor (read these before every prompt)

1. **Never delete existing logic** — only add to or replace what the prompt
   explicitly targets. Every agent already has a working LLM + stub fallback;
   do not remove it.
2. **Import from `@/design/primitives`** for all UI components (Button, Card,
   Badge, StatTile, EvidenceChip, etc). Never write local inline styles for
   colors — use Tailwind token classes (`text-ink-1`, `bg-surface-2`, etc).
3. **Plain language only in UI** — no raw graph kind strings visible to users.
   Use `t(kind)` from `@/design/dictionary` for any graph node kind label.
   Use `agentName(id)` from `@/store/cycle.store` for any agent reference.
4. **Every number is a button** — any count, percentage, or score rendered in
   the UI must be a `<button>` or have an `onClick` that drills one level deeper.
5. **The `eAPI` pattern** — all IPC calls in renderer use
   `const eAPI = window.electronAPI as any` and call `eAPI.methodName?.()`.
   Always use optional chaining (`?.`) so the renderer doesn't crash if a
   handler isn't registered yet.

---

## PROMPT 1 — Complete JourneyCanvas

**Read first:** `packages/renderer/src/screens/journey/JourneyCanvas.tsx` (234 lines),
`packages/renderer/src/store/ux/ux.store.ts`, `packages/renderer/src/design/tokens.ts`

**What to build:** The JourneyCanvas currently renders the six-column board but
the LISTEN column only shows a static placeholder and cards don't animate between
columns. Complete the following:

### 1a — LISTEN column (pain points as problem cards)
Replace the LISTEN column body with real data from `eAPI.aepGetPainPoints?.()`.
Each pain point renders as a card showing:
- Problem label (truncated to 2 lines)
- Signal count badge (e.g. "34 voices")
- A "↑ 12 this week" velocity indicator (if available)
- On click: call `eAPI.cycleStart?.({ label: pp.label, mode: 'demo', painPointIds: [pp.id] })`
  then navigate to `/room/cycle`

Below the pain point list, show a "+ Start from scratch" button that navigates to `/room/cycle`.

### 1b — Initiative cards
Each card in DECIDE/DEFINE/BUILD/SHIP/LEARN columns must show:
- Initiative title
- Plain-English status line (use `statusLine` from the board item)
- Days in stage (e.g. "3d in stage")
- If `needsHuman === true`: amber ring border + "⭐ Needs a decision" line
- If status is `bounced` or `halted`: 3px red left border
- If status is `completed` and in LEARN: 3px teal left border + "✓ Bet paid off"
- On click: navigate to `/feature/${item.featureId ?? item.id}`

### 1c — Column headers
Each column header shows:
- Verb name + tagline (from `STAGE_META` in `@/store/cycle.store`)
- Live count
- Amber dot (●) if any card in that column has `needsHuman === true`

### 1d — Card movement animation
When `cycle:update` fires (wired in App.tsx), re-fetch the board and apply a
`transition-all duration-300` on card position changes. Use a keyed list so React
animates moves automatically.

### 1e — Filters + Presentation Mode
Filter bar (above canvas): a `<select>` for product area populated from
`eAPI.domainGetContexts?.()`. Filtering is client-side, no re-fetch needed.

Presentation Mode button: toggles `presentationMode` state which hides the
header bar, hides filters, and doubles font sizes. A floating "Exit" button appears.

### 1f — Empty states
If the board is empty overall, show a centered call-to-action:
```
Title: "Nothing in flight yet"
Body:  "Start a value cycle to see initiatives flow through the journey."
Action: "Start a cycle →" → navigate('/room/cycle')
```

**Acceptance gate:** Open the app, navigate to Journey. The six columns render.
Pain points from the demo seed appear in LISTEN. Clicking a pain point card
navigates to the Cycle Runner with that pain point pre-selected.

---

## PROMPT 2 — Complete FeatureStory

**Read first:** `packages/renderer/src/screens/story/FeatureStory.tsx` (366 lines),
`packages/renderer/src/store/cycle.store.ts` (STAGE_META with plain-English titles),
`packages/main/src/ux/uxReadModels.ts` (the `UX_GET_FEATURE_STORY` handler)

**What to build:** The story screen renders a timeline but lacks interactivity.
Complete the following:

### 2a — Header enhancements
Below the title, show the origin problem sentence in italic quotes:
`"Fleet operators cannot dispute charges in bulk" — 65 voices`
The voice count is a button that opens a Peek drawer listing up to 10 sample
signal labels fetched from `eAPI.uxGetFeatureStory?.({ featureId })`.

Show the committed bets as small rose-colored pills below the quote, using
`DICT.phrases.betLine` (or inline: `"Cut dispute_rate by 15% in 90d"`).

### 2b — Timeline stage rows
Each stage row has three visual states:

**Done (collapsed):** Step indicator shows a green ✓. Title in past tense
(use the `DONE_LINES` map already in the file). Any artifact nodes
attached to this stage render as `EvidenceChip` components. Clicking a chip
calls `eAPI.uxGetGraphNode?.({ nodeId })` and shows the JSON in a Peek drawer
with a human-readable title (use `t(node.kind)` from the dictionary).

**Active (expanded):** Step indicator glows with the verb color. Title stays
present-tense. Below the title: the `description` from `STAGE_META`. Below that,
the operational block:
- If `run.status === 'running'`: show `ProgressRibbon` with `agentName` + "working…"
- If `run.status === 'waiting_gate'`: show amber block with "Needs a decision" and
  a `Button` labeled "Go to decision room →" that navigates to
  `/gate/${run.id}/${run.current_stage}`
- If `run.status === 'waiting_external'`: show the `run.error` reason (if any)
  plus simulate buttons (demo mode only, same as CycleRunnerPanel)
- If `run.status === 'error'`: show red error block with `run.error` + Retry button

**Locked (dimmed):** Title only, 40% opacity, lock icon.

### 2c — Bounce annotations
When the timeline log has a `bounced` event, render an inline red connector
between the two affected stage rows:
```
↩ Sent back from Ship — 1 file had no test coverage — fixed in 2 days
```
Fetch the `detail_json` from the timeline row to populate this.

### 2d — Right rail
Wire all three sections to real data from `eAPI.uxGetFeatureStory?.({ featureId })`:
- **The bets**: render each hypothesis with `DICT.phrases.betLine`, confidence %, and verdict
  status (⏳/✅/~) from the `bets` array in the story payload
- **Regulations**: render each regulation label with a ⚠ icon; clicking navigates to
  `/room/domain` with the regulation pre-selected
- **Who's involved**: render each role as a rounded pill

### 2e — Engineering view toggle
When `isEngineer` state is true (toggled by "Engineering view" button), show two
additional sections in the right rail:
- **Top traced files**: list from `story.code` (max 8), each with FIS score and SDLC phase badge
- **Impact analysis**: a "Run FIS" button that calls `eAPI.aepDomainFis?.({ query: story.title })`
  and shows results inline

**Acceptance gate:** Navigate to any Feature Story. The timeline renders all 12
stages with correct states. Clicking an evidence chip opens a Peek with readable
content. The "Go to decision room" button is visible when the cycle is at a gate.

---

## PROMPT 3 — Complete DecideRoom (both gates)

**Read first:** `packages/renderer/src/screens/gates/DecideRoom.tsx` (378 lines),
`packages/main/src/cycle/cycleOrchestrator.ts` (`approvePortfolioGate`, `signReleaseGate`),
`packages/renderer/src/design/primitives` (`GateSeal`, `ConfirmDialog`)

The DecideRoom already has the layout scaffolded. Complete the following:

### 3a — Portfolio Gate: evidence panel

Fetch the portfolio packet by calling:
```typescript
const run = await eAPI.cycleGet?.(runId)
const packet = run?.packet_id
  ? await eAPI.uxGetGraphNode?.({ nodeId: run.packet_id })
  : null
const desc = packet ? JSON.parse(packet.description) : {}
```

Render three evidence blocks:
1. **The problem** — `desc.summary` with evidence strength as a small confidence bar
2. **Worth** — `$${desc.value_range?.low_usd?.toLocaleString()} – $${desc.value_range?.high_usd?.toLocaleString()}` with a "Assumptions ▸" toggle that expands the list
3. **Bets being locked** — each hypothesis as a card with `DICT.phrases.betLine`, confidence, attribution method. Render these with amber border to visually emphasize their permanence.
4. **Recommendation** — A5's recommendation in accent color (`desc.recommendation` + score)

### 3b — Portfolio Gate: decision panel

Three radio cards (Admit / Not now / No) — not checkboxes. Each card shows a consequence sentence:
- Admit: "Bets are committed and permanently locked before any code exists."
- Not now: "Returns to Listen. More data can be gathered before re-presenting."
- No: "Closes this initiative. The reason is recorded for learning."

Role selector: populate from a hardcoded list `['CPO', 'CTO', 'CBO', 'VP Product', 'VP Engineering', 'Finance Lead', 'Product Owner']`.

Rationale textarea: minimum 10 characters enforced client-side. Label: "Why — this is permanently recorded and cannot be changed."

On submit: show `ConfirmDialog` if decision is "admit" (warn about permanence). On confirm, call `eAPI.cyclePortfolioGate?.(runId, { decision, approvedByRole: role, rationale, featureNodeId: run.feature_node_id })`. On success, show a 2-second confirmation toast then navigate to `/feature/${run.feature_node_id}`.

### 3c — Release Gate: scope summaries

Fetch the readiness report:
```typescript
const run = await eAPI.cycleGet?.(runId)
const report = run?.readiness_report_id
  ? JSON.parse((await eAPI.uxGetGraphNode?.({ nodeId: run.readiness_report_id }))?.description ?? '{}')
  : {}
```

Four scope cards using plain sentences (not technical terms):
- **Scope 1 — Code**: "${scope1_code.filter(direct).length} files are changing. ${cochange.length} more usually change alongside them."
- **Scope 2 — Tests**: Green if `scope2_gaps.length === 0`: "Everything changed is covered by tests ✓". Red if gaps exist: "${n} changed file(s) have no test — this is blocking."
- **Scope 3 — Operations**: "${scope3_ops.length} events and contexts that other teams use are affected." List them.
- **Scope 4 — Your responsibility**: The regulation plain-English sentence explaining WHY this role is required.

### 3d — Release Gate: signatures

Render `GateSeal` with `required = report.approvalSet` and `signed` computed from existing DECISION_RECORD nodes. Show per-role sign buttons (only for unsigned roles). On sign: call `eAPI.cycleSignRelease?.(runId, role, rationale)`. After all signatures are present, show "✓ All signatures present — rollout will start automatically" in green.

**Acceptance gate:** Start a demo cycle, advance to PORTFOLIO_GATE. The gate shows the packet evidence. Select "Admit", write a rationale, click confirm. The cycle advances. Navigate to the release gate — the four scope cards show real data from the readiness report.

---

## PROMPT 4 — Complete LearnHub

**Read first:** `packages/renderer/src/screens/learn/LearnHub.tsx` (176 lines),
`packages/renderer/src/store/ux/ux.store.ts` (learnings, verdicts arrays),
`packages/main/src/aep/aepIpcHandlers.ts` (the `AEP_GET_LEARNINGS` handler added in latest session)

### 4a — Verdicts tab
Fetch verdicts from `eAPI.aepGetOutcomes?.()` (returns HYPOTHESIS_VERDICT nodes).
Parse each node's `description` JSON. Render as `VerdictCard`:
- **Validated** (teal left border, ✓ icon): `DICT.phrases.verdictValidated(kpi, actualDelta)`
- **Refuted** (grey left border, ~ icon): `DICT.phrases.verdictRefuted(kpi, actualDelta)` — never red, never "failure"
- Below each card: "Predicted ${predicted}% · actual ${actual}% · ${attributionMethod}"
- Clicking the card navigates to `/feature/${featureId}` (from description.hypothesisId lookup)

**Critical UX rule:** Refuted verdicts must have identical visual prominence to validated ones. The only difference is the icon (~ vs ✓) and the grey vs teal border. The copy explicitly says "that is a lesson, not a failure."

### 4b — Your team tab
Fetch from `eAPI.aepGetGoldenThread?.({ featureId })` for the most recent completed cycle's feature.
Render one impact card per org unit from `eAPI.aepGetCalibration?.()`.
Each card: org unit name, sentiment badge (positive/neutral/mixed/negative), 2-3 sentence summary, action items as bullet points.
Auto-filter to show the current role's org unit first, others collapsed.

### 4c — Lessons tab
Fetch from `eAPI.aepGetLearnings?.()` (the handler added in latest session).
Each lesson renders as `LessonCard`:
- 💡 icon + lesson label
- Adjustment sentence (from `description.adjustment`)
- INFORMS chips: "Updates: ${target}" for each target in `description.targets`
  - These chips are buttons that navigate to the relevant screen
  - "informs: A2 fleet estimates" → clicking navigates to `/room/bizvalue`
  - "informs: Pain point: Fleet pricing" → clicking navigates to `/room/signals`
  - "informs: Business objective" → clicking navigates to `/journey?verb=DECIDE`

### 4d — Getting better? tab
Fetch from `eAPI.aepGetCalibration?.()`.
One row per agent. Use `agentName(agentId)` from `@/store/cycle.store`. Show:
- Agent name (plain English, not A-code)
- Trend arrow: ↓ improving (green), → stable (grey), ↑ degrading (red)
- Mean error % with a small sparkline (last 4 cycles, use `Sparkline` primitive)
- Recommendation sentence from the calibration data
- If `trend === 'improving'` and first row: a banner: "Your estimates are improving. The learning loop is working."

### 4e — Cycle review mode
A "📊 Cycle review" button in the header that sets `reviewMode` state.
In review mode: render the four tabs as vertically stacked full-width sections,
hide the tab bar. A floating "Exit review" button. This is the quarterly-meeting mode.

**Acceptance gate:** Complete a full demo cycle. Navigate to Learn Hub.
Verdicts tab shows at least one verdict with plain-language sentences.
Lessons tab shows at least one lesson with INFORMS chips.
Getting better tab shows all agents with plain names (not A-codes).

---

## PROMPT 5 — Complete CustomerSignalPanel

**Read first:** `packages/renderer/src/panels/aep/CustomerSignalPanel/index.tsx`,
`packages/main/src/aep/upstream/passE/customerSignalIngester.ts`

### 5a — Signal ingestion form
The panel has two tabs: "Customer Feedback" and "Problems Found".

**Customer Feedback tab** — a signal ingestion form:
- Source selector: CSV / Zendesk JSON / NPS JSON / Plain text (one signal per line)
- Large textarea for pasting raw data
- Format hint below textarea (changes per source)
- "Add feedback" button calling `eAPI.aepIngestSignals?.({ source, content })`
- After ingestion: show "✓ ${count} feedback items added" toast + refresh problem list

**CSV format hint:**
```
date,cohort,type,text
2026-07-01,enterprise,feature_request,We need bulk operations
```

**Plain text:** each line becomes one signal, cohort="manual", type="feature_request"

### 5b — Problems Found tab
Real data from `eAPI.aepGetPainPoints?.()`.
Each problem card:
- Problem label (full, not truncated)
- Signal count: "${n} voices" as a button (clicking opens Peek with up to 5 sample signal texts)
- Importance bar: a thin horizontal bar filled proportionally to `importance_score`
- "Start an initiative →" button (accent outline) that calls `cycleStart` with this pain point
  then navigates to `/room/cycle`

"Run clustering" button in the header triggers `eAPI.aepClusterPainPoints?.()` with
a loading spinner. Shows count result as a toast.

### 5c — Empty state
If no signals and no problems:
```
Icon: 👂
Title: "No customer feedback yet"
Body: "Paste support tickets, survey comments, or interview notes — the system
       will find the patterns."
Action: "Add feedback" → scrolls to the ingestion form
```

**Acceptance gate:** Navigate to Customer Feedback room. Paste 5+ lines of plain text.
Click "Add feedback". Switch to "Problems Found" tab. Click "Run clustering".
At least one problem card appears. Clicking "Start an initiative" opens the Cycle Runner
with that problem pre-selected.

---

## PROMPT 6 — Complete BusinessValuePanel

**Read first:** `packages/renderer/src/panels/aep/BusinessValuePanel/index.tsx`,
`packages/renderer/src/store/cycle.store.ts` (AGENT_NAMES, agentName),
`packages/main/src/aep/upstream/agents/a2BusinessImpactAgent.ts`

The panel has three tabs: Problems, Ingest Signals, and Bets.
Rename the tab headers to: "Problems", "Add Feedback", "Bets & Predictions".

### 6a — Problems tab
Reuse the same rendering as CustomerSignalPanel's "Problems Found" tab.
Add a multi-select checkbox per card. Show "Run advisors on ${n} selected →"
button (enabled when ≥1 selected) that triggers:
1. `eAPI.aepRunA1?.({ painPointIds: selectedIds })` → gets `briefId`
2. Show "Signal Analyst working…" spinner
3. `eAPI.aepRunA2?.({ briefId })` and `eAPI.aepRunA4?.({ briefId })` in parallel
4. Show "Value Estimator + Engineering Estimator working…"
5. `eAPI.aepRunA5?.({ featureId })` → gets packet
6. Show "Portfolio Advisor working…" then "Decision packet ready →"
7. Navigate to `/gate/${runId}/PORTFOLIO_GATE`

Show each agent step with its plain name (never A-codes) and a small spinner
during execution. When done, show a green summary:
"Ready for leadership review → [Open decision room]"

### 6b — Bets & Predictions tab
Fetch from `eAPI.aepGetHypotheses?.()`.
Each bet renders as:
- Status icon: ⏳ pending / ✅ validated / ~ refuted (not ❌)
- Bet label using `DICT.phrases.betLine(kpi, direction, magnitude, days)`
- Confidence: "We're ${(priorConf*100).toFixed(0)}% confident before measuring"
- If verdict exists: actual delta vs predicted delta, method
- If refuted: "The bet didn't pay off — ${actualDelta}% vs ${predicted}% predicted. That's a lesson."

Sort: pending first, then validated, then refuted. No filtering by default.

**Acceptance gate:** Select 2+ problems, click "Run advisors". All three agent names
appear in sequence (not A-codes). Navigate to the decision room. The evidence panel
shows the packet content.

---

## PROMPT 7 — Complete ConsolidationPanel

**Read first:** `packages/renderer/src/panels/aep/ConsolidationPanel/index.tsx`,
`packages/main/src/aep/downstream/blastRadiusEngine.ts`

### 7a — RC input + A10 trigger
Replace the current RC ID text input with a smart dropdown populated by:
```typescript
eAPI.aepGetValueStream?.()
// filter where stream_state = 'CONSOLIDATE'
```
Each option shows the initiative title + days in stage.

A "Run safety check" button calls:
`eAPI.aepRunA10?.({ featureId: selectedFeatureId })`

Show the "Release Checker" (not "A10") working with a progress bar.

### 7b — Four scope cards (plain language)
Already has ScopeLine component — ensure the text generation is:

**Scope 1:** "**${direct} files** are changing. ${cochange} more often change at the same time — their owners should be aware."

**Scope 2:** Green if no gaps: "**All changed files have test coverage** — nothing is going out untested ✓"
Red if gaps: "**${n} changed file${s} have no test** — this blocks release until covered:" then list files.

**Scope 3:** If empty: "No downstream dependencies affected." Otherwise: "**${n} event${s} or service${s}** that other teams depend on are in the blast radius:" then list each as "Event: ${label} — ${detail}"

**Scope 4:** If no regulations: "No regulatory exposure in this release." If regulations: "**${reg}** applies here — this is why **${role}** is a required approver." One sentence per regulation. Use the regulation label directly (it's already human-readable from the YAML pack).

### 7c — Pending gates section
Above the scope cards, if `pendingGates.length > 0`, show a prominent amber card:
"**${n} approval${s} still needed before release**"
List each with: role name, pending since (calculate from `entered_state_at`), and a "Sign now →" button that navigates to `/gate/${runId}/RELEASE_GATE`.

When all gates are signed: replace this card with a green "✓ All approvals recorded — rollout will begin automatically" card.

### 7d — Computed approval set explanation
Below the scope cards, a grey box:
"**Who needs to approve this release** — derived from what's changing, not configured manually:"
Then a bulleted list: each role with a one-sentence explanation of why they're required.
- Engineering Lead → "Always required for any code change"
- Compliance Officer → "Required because ${regulation} governs ${n} files in this release"
- Customer Success Lead → "Required because this release affects the ${segment} customer segment"

**Acceptance gate:** Run a full demo cycle to CONSOLIDATE. The Release Checker runs
and shows results. All four scopes have plain-language text. The approval set explanation
shows why each role is needed.

---

## PROMPT 8 — Complete OutcomeDashboardPanel

**Read first:** `packages/renderer/src/panels/aep/OutcomeDashboardPanel/index.tsx`,
`packages/renderer/src/screens/learn/LearnHub.tsx` (for VerdictCard and LessonCard patterns)

The Outcome Dashboard and Learn Hub show similar data from different entry points.
The Dashboard is the raw data panel; the Hub is the curated narrative. Keep them distinct.

### 8a — Verdicts tab
Same data as LearnHub verdicts but presented as a sortable table using `DataTable`:
Columns: Initiative, Metric, We predicted, What happened, Verdict, When.
"What happened" cell: green if validated, muted grey if refuted (never red).
Row click navigates to `/feature/${featureId}`.

Show a summary stat row above the table:
`${validated} paid off · ${refuted} lesson${s} · ${pending} still measuring`

### 8b — Per-team impact tab
Fetch `eAPI.aepGetGoldenThread?.()` for all recent cycles.
Group by org unit (from impact assessment nodes).
Render a card per org unit:
- Unit name + sentiment badge
- 2-3 sentence impact summary
- Action items as `→ item` lines
- A "Share" button that copies the card text to clipboard

### 8c — Agent calibration tab
Same as LearnHub "Getting better?" but with a 4-cycle line chart using `Sparkline`
per agent. Add a plain-English interpretation below each sparkline:
- Improving: "Predictions getting more accurate — lessons are working"  
- Stable: "Consistent accuracy over ${n} cycles"
- Degrading: "Predictions getting less accurate — this agent's prompts may need review"

**Acceptance gate:** Complete a demo cycle. Navigate to Outcomes panel. All three tabs
show data. Verdicts table has at least one row with a plain-language verdict sentence.

---

## PROMPT 9 — Wire the Learning Loop (the most important prompt)

**Read first:**
- `packages/main/src/aep/downstream/agents/a14LearningAgent.ts`
- `packages/main/src/aep/downstream/passG/passGOrchestrator.ts`
- `packages/renderer/src/panels/aep/CycleRunnerPanel/index.tsx` (the LoopCard component)
- `packages/renderer/src/screens/home/PersonaHome.tsx`
- `packages/renderer/src/store/ux/ux.store.ts`

The learning loop is the system's most valuable feature: lessons from one cycle
inform the next. This prompt wires the visible evidence of that loop.

### 9a — LoopCard data (already scaffolded, needs real data)
The `LoopCard` in CycleRunnerPanel calls `eAPI.aepGetLearnings?.()`.
Verify this IPC call returns data after a LEARN stage completes. The `aep:getLearnings`
handler was added in the latest session — confirm it's working by:
1. Running a demo cycle to DONE
2. Checking `eAPI.aepGetLearnings?.()` returns an array
3. Each item should have `label`, `description` (with `targets`, `adjustment`),
   and `informs_count`

If it returns empty, check `packages/main/src/aep/downstream/agents/a14LearningAgent.ts`
— the `run()` method should be writing LEARNING nodes. If not, the issue is that
`passGOrchestrator.ts` may not be calling A14. Add the A14 call:

```typescript
// In PassGOrchestrator.run(), after A12 and A13 complete:
import { A14LearningAgent } from '../agents/a14LearningAgent'

const a14 = new A14LearningAgent(this.db)
const a14Result = a14.run({
  featureId: input.featureId,
  verdicts: verdictSummaries,
  learningNotes: `Cycle complete. ${validatedCount} bets validated, ${refutedCount} refuted.`,
})
// wire INFORMS edges back
```

### 9b — "Start next cycle" pre-populates from lessons
When the user clicks "Start next cycle →" in the LoopCard:
1. Fetch the INFORMS targets from the most recent LEARNING nodes
2. Extract any PAIN_POINT targets → pre-select them as `painPointIds` in the new cycle
3. Pass these as `{ label: 'Cycle 2 — informed by lessons', mode: run.mode, painPointIds: [...] }`
4. The cycle's SIGNALS stage will already have signal data to cluster

This closes the visible loop: lessons from cycle 1 → pain point selection for cycle 2.

### 9c — Home screen loop status widget
In `PersonaHome.tsx`, add a `learningsFeed` widget (already in PERSONA_HOME config
for executive and support roles). This widget:
- Title: "What we learned last cycle"
- Body: latest 3 LEARNING nodes from `eAPI.aepGetLearnings?.()` (populated from UX store)
- Each lesson shows: 💡 label, then small INFORMS chips showing what it updates
- A "See all lessons →" button navigating to `/room/learn`
- If no lessons yet: "Complete your first cycle to see lessons here"

### 9d — UX store: refresh learnings on cycle complete
In `packages/renderer/src/store/ux/ux.store.ts`, extend `refreshHome()`:
```typescript
const learnings = await eAPI.aepGetLearnings?.() ?? []
setLearnings(Array.isArray(learnings) ? learnings.slice(0, 10) : [])
```
This populates the `learnings` array used by the home widget.

### 9e — Journey bar: loop indicator
In `AppShell.tsx`, when the LEARN column has `completed` items (from the board),
the LEARN verb pill should show a subtle ↺ rotation animation on its dot indicator.
Use a CSS animation class `animate-spin-slow` (add to tailwind config: `animation: { 'spin-slow': 'spin 3s linear infinite' }`).
Only animate when at least one LEARN item is `completed` (the loop has closed).

**Acceptance gate:** Complete a full demo cycle. The LoopCard shows lessons with
INFORMS connections. Clicking "Start next cycle" opens the new cycle modal with the
pain points from lessons pre-selected. The home screen shows the latest lessons.

---

## PROMPT 10 — ISS Integration: Feature Panel + PO Workbench

**Read first:**
- `packages/renderer/src/panels/iss/FeaturePanel/index.tsx`
- `packages/renderer/src/panels/iss/POWorkbenchPanel/index.tsx`
- `packages/renderer/src/panels/iss/ImpactPanel/index.tsx`
- `packages/renderer/src/design/dictionary.ts`

The ISS panels are engineering workbenches. They need minor UX improvements to
integrate with the journey layer — no structural changes.

### 10a — FeaturePanel: link to story
In the feature list, add a "View story →" button per feature that navigates to
`/feature/${feature.id}`. This connects the engineering view to the narrative view.

Show a domain badge per feature: if the feature has `ABOUT` edges to a DOMAIN_CONCEPT,
show the concept label in a small green badge. Fetch via `eAPI.aepDomainFis?.({ query: feature.label })`.

### 10b — PO Workbench: plain-language tool names
The 6 PO tools currently show technical names. Rename in the UI (not in code):
- `trace_feature_to_code` → "Find the code"
- `impact_analysis` → "What else changes?"
- `feature_completion_status` → "How complete is this?"
- `find_similar_features` → "Are there duplicates?"
- `generate_acceptance_criteria` → "Write acceptance tests"
- `suggest_architecture` → "Architecture suggestions"

Each tool shows its plain name as the button label. The technical name shows in a
`title` tooltip (for engineers who know what they're looking for).

### 10c — Impact Panel: governed files highlight
In the FIS results list, any file that has a `GOVERNED_BY` edge to a REGULATION
should show a small amber badge: the regulation ID (e.g. "NHAI-MLFF-SPEC-4.2").
Fetch governed status from the FIS result's `isGoverned` field (already returned
by `DomainAwareFIS.scoreWithDomain`).

A tooltip on the badge: "This file is subject to ${regulation.label} — include
Compliance in the release approval."

**Acceptance gate:** Open the Feature panel. A feature card shows a domain badge
if it has domain connections. The PO tools show plain-English names. Clicking
"Find the code" on a feature shows the FIS results with governed file badges.

---

## PROMPT 11 — DomainBrowserPanel completion

**Read first:** `packages/renderer/src/panels/aep/DomainBrowserPanel/index.tsx`,
`packages/main/src/domain/domainOrchestrator.ts`

### 11a — Pack loading feedback
The "Load Domain Pack" button already opens a file picker. After loading:
- Show "✓ ${pack.name} loaded — ${nodes} concepts, rules, KPIs indexed" toast
- Reload all tabs automatically
- If validation errors exist, show each error in a red expandable list

### 11b — KPI tab: link to hypotheses
Each KPI card shows a "Bets" count (from `eAPI.aepGetHypotheses?.()` filtered by KPI name).
Clicking the count opens a Peek showing all bets on that KPI with their verdict status.

### 11c — Business Rules tab: enforcement gap
Each business rule shows whether it has an `ENFORCES` edge to a TEST_CASE.
If no enforcing test exists: show an amber "⚠ No enforcing test" badge.
Clicking the badge navigates to `/room/features` with a filter pre-applied
to show features in the rule's bounded context.

### 11d — Regulations tab: governed file list
Clicking any regulation card expands it to show:
- The regulation body text (first 200 chars + "show more")
- A list of governed files (from `eAPI.domainGetContextFiles?.({ contextId })`)
- "This regulation triggers Compliance sign-off on releases touching these files"

**Acceptance gate:** Load the `mlff-tolling.pack.yaml` from `resources/domain_packs/`.
All 6 tabs populate. KPIs show bet counts. Business rules show enforcement gap warnings
where applicable. Clicking a regulation shows its governed files.

---

## PROMPT 12 — End-to-end demo validation

**Read first:** All the files modified in prompts 1–11.

This prompt validates the entire flow works as a guided journey from end to end.
No new code is written — only fixes for anything broken.

### Demo script (run in the app)

1. **Open workspace** — pick any git repo. Let indexing complete.
2. **Go to home screen** — confirm the "Value Cycle" banner is prominent. Confirm "Nothing waiting on you" (or actions count if any).
3. **Navigate to Customer Feedback** (LISTEN → Customer Feedback in left rail). Paste this CSV:
```
2026-07-01,fleet-operators,feature_request,We manage 40 trucks and dispute each wrong charge one at a time. We need bulk dispute filing.
2026-07-02,fleet-operators,feature_request,Please add CSV upload for disputing multiple toll charges at once
2026-07-03,enterprise,churn_risk,Considering switching providers because dispute handling wastes 3 hours a week
2026-07-04,fleet-operators,defect,Charged twice on NH-48, dispute portal only lets me pick one transaction
2026-07-05,individual,usability,Dispute form asks for transaction ID which I cannot find anywhere
```
Click "Add feedback". Navigate to "Problems Found" tab. Click "Run clustering".
**Expected:** 1–3 problem cards appear.

4. **Start a cycle** — click "Start an initiative" on the top problem. Confirm demo mode. **Expected:** Cycle Runner opens, LISTEN stage active, "Simulate signals" button visible.

5. **Simulate through SIGNALS** — click "Add sample customer feedback". **Expected:** Stage advances to Pattern Finding (CLUSTER), then automatically to "Write the case for action" (INTAKE).

6. **Watch agents work** — QUALIFY shows "Value Estimator + Engineering Estimator working…". PACKET shows "Portfolio Advisor working…". **Expected:** All three stages complete automatically.

7. **Portfolio gate** — stage shows "Leadership decides" with amber ring. Click "Go to decision room". **Expected:** Evidence panel shows the problem summary, value range, and bets list. Select "Admit", pick "Product Owner" role, write a rationale. Click "Record decision". **Expected:** Routes to Feature Story.

8. **Feature Story** — shows the full timeline. Past stages show ✓. Current stage is "Design and build it" (BUILD). **Expected:** "Simulate a code change & CI run" button visible.

9. **Simulate BUILD** — click the simulate button. **Expected:** Stage advances to "Check if it is safe to ship" (CONSOLIDATE), Release Checker runs, then "Required approvers sign off" (RELEASE_GATE).

10. **Release gate** — click "Sign off as Engineering Lead". **Expected:** GateSeal shows Engineering Lead signed. If it's the only required role, stage advances to "Release to customers gradually" (ROLLOUT).

11. **Simulate observations** — at OBSERVE stage, click "Record a metric snapshot" twice. **Expected:** Stage advances to "Judge the bets" (LEARN), agents work, cycle reaches DONE.

12. **LoopCard** — **Expected:** Shows 1–3 lessons with INFORMS chips. "Start next cycle" button visible. Click it. **Expected:** New cycle modal opens with pre-populated pain points from lessons.

13. **Learn Hub** — navigate to Learn Hub. **Expected:** Verdicts tab shows the outcome. Lessons tab shows LEARNING nodes. Getting better tab shows agents with plain English names (not A-codes).

### Fix list (address any failures)

For each step that fails, identify the specific file and fix:

**If step 5 stalls at SIGNALS:** Check `packages/main/src/cycle/stageDefinitions.ts` —
the `SIGNALS` exit predicate requires `DEMO_SIGNAL_MIN = 5` unclustered signals.
`simulateSignals` injects from `resources/demo/sample_signals.csv`. If that file
doesn't exist, create it with 6+ lines in `date,cohort,type,text` format.

**If step 6 shows "A1" instead of "Signal Analyst":** Check `packages/renderer/src/store/cycle.store.ts`
— the `STAGE_META.INTAKE.agentName` must be `'Signal Analyst'` and the `StageCard`
component must render `meta.agentName` not `meta.title`.

**If step 7 portfolio gate shows no evidence:** The `run.packet_id` may be null.
Check `packages/main/src/cycle/cycleOrchestrator.ts` — after `case 'PACKET'`,
ensure `set('packet_id', packetId)` is called with the A5 result.

**If step 11 LoopCard shows empty lessons:** Check `packages/main/src/aep/downstream/passG/passGOrchestrator.ts`
— ensure A14 is called and returns learningNodeIds > 0. Check the A14 `run()` method
writes LEARNING nodes to graph_nodes table.

**If any agent name shows as "A1", "A2", etc in the UI:** Search the codebase for
hardcoded agent code strings in JSX and replace with `agentName(id)` from `@/store/cycle.store`.

**Acceptance gate:** All 13 steps complete without manual intervention except steps
7 and 10 (intentional human gates). The demo runs end-to-end in under 10 minutes.

---

## PROMPT 13 — Polish and accessibility

**This prompt is independent of order.** It can run in parallel with any other.

### 13a — Keyboard navigation
Add keyboard shortcuts (listed in the app's Settings panel):
- `⌘K` / `Ctrl+K` — command palette (already stubbed in AppShell — wire to a real modal
  that searches features, pain points, KPIs, and room names)
- `⌘J` / `Ctrl+J` — navigate to Journey Canvas
- `⌘I` / `Ctrl+I` — navigate to Actions Inbox
- `⌘/` — show keyboard shortcut reference

### 13b — Empty states for every panel
Every panel and screen must have a proper `EmptyState` component (from primitives) when:
- No workspace is open (show workspace picker CTA)
- Workspace open but not indexed (show "Indexing..." or "Start indexing" CTA)
- Data exists but relevant subset is empty (see each panel's empty state spec)

### 13c — Error recovery
Every IPC call result must be checked. If `result?.error` exists, show a `Toast`
with the error message and a Retry button. Never let the UI silently fail.

### 13d — Loading states
Every async data fetch should set a `loading` state that renders either:
- A `ProgressRibbon` with `pct={null}` (indeterminate shimmer) for lists
- A `Loader2` spinner for buttons

Loading must be dismissed on both success AND error — no infinite spinners.

### 13e — Reduced motion
Add `@media (prefers-reduced-motion: reduce)` to the Tailwind config:
```js
// tailwind.config.js
theme: {
  extend: {
    animation: {
      'spin-slow': 'spin 3s linear infinite',
    }
  }
}
```
Wrap all `animate-*` classes in a check:
```typescript
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
className={prefersReduced ? '' : 'animate-spin-slow'}
```

**Acceptance gate:** Tab through the entire app with keyboard only (no mouse).
Every interactive element is reachable and has a visible focus ring. Empty states
appear for every panel before a workspace is opened.

---

## Quick reference — IPC methods available in renderer

```typescript
const eAPI = window.electronAPI as any

// ── Workspace & indexing ───────────────────────────────────────
eAPI.openWorkspace?.()
eAPI.startIndexer?.()
eAPI.getSettings?.()
eAPI.saveSettings?.({ ...settings })

// ── Customer signals & pain points ────────────────────────────
eAPI.aepIngestSignals?.({ source: 'csv'|'json'|'nps'|'manual', content: string })
eAPI.aepClusterPainPoints?.()
eAPI.aepGetPainPoints?.()           // → { id, label, signal_count, importance_score }[]

// ── Agents (upstream) ─────────────────────────────────────────
eAPI.aepRunA1?.({ painPointIds: number[] })     // Signal Analyst
eAPI.aepRunA2?.({ briefId: number })             // Value Estimator
eAPI.aepRunA4?.({ briefId: number })             // Engineering Estimator
eAPI.aepRunA5?.({ featureId: number })           // Portfolio Advisor

// ── Gates ────────────────────────────────────────────────────
eAPI.cyclePortfolioGate?.(runId, {
  decision: 'admit'|'defer'|'reject',
  approvedByRole: string,
  rationale: string,
  featureNodeId: number,
})
eAPI.cycleSignRelease?.(runId, role, rationale)

// ── Cycle lifecycle ───────────────────────────────────────────
eAPI.cycleStart?.({ label, mode: 'live'|'demo', painPointIds?: number[] })
eAPI.cycleList?.()
eAPI.cycleGet?.(runId)
eAPI.cycleAdvance?.(runId)
eAPI.cycleAbort?.(runId)
eAPI.cycleTimeline?.(runId)
eAPI.cycleSimulateSignals?.(runId)
eAPI.cycleSimulateCI?.(runId)
eAPI.cycleSimulateKpi?.(runId, drift: number)   // drift 0.0–1.0

// ── Hypotheses & verdicts ─────────────────────────────────────
eAPI.aepGetHypotheses?.()           // all committed hypotheses with verdicts
eAPI.aepGetLearnings?.()            // LEARNING nodes with informs_count
eAPI.aepGetOutcomes?.()             // OUTCOME + HYPOTHESIS_VERDICT nodes
eAPI.aepGetCalibration?.(agentId?)  // calibration report per agent

// ── Blast radius & consolidation ─────────────────────────────
eAPI.aepGetBlastRadius?.({ featureId?, releaseCandidateId? })
eAPI.aepRunA10?.({ featureId: number })          // Release Checker

// ── Domain ontology ───────────────────────────────────────────
eAPI.domainListPacks?.()
eAPI.domainLoadPack?.({ filePath: string })
eAPI.domainGetKpis?.()
eAPI.domainGetContexts?.()
eAPI.domainGetRegulations?.()
eAPI.domainGetConcepts?.()
eAPI.domainGetContextFiles?.({ contextId: number })
eAPI.aepDomainFis?.({ query: string, mode?: string })

// ── UX read models ────────────────────────────────────────────
eAPI.uxGetJourneyBoard?.()
eAPI.uxGetFeatureStory?.({ featureId: number })
eAPI.uxGetActions?.({ role: string })
eAPI.uxGetGraphNode?.({ nodeId: number })

// ── Value stream ─────────────────────────────────────────────
eAPI.aepGetValueStream?.()
eAPI.aepGetPendingGates?.()
eAPI.aepGetApprovalSet?.(featureId)
eAPI.aepGetGoldenThread?.(featureId)
eAPI.aepTickOrchestrator?.()

// ── ISS ──────────────────────────────────────────────────────
eAPI.issRunPassC?.({ featureId: number })
eAPI.issGetFeatures?.()
eAPI.issGetFeatureTraces?.({ featureId: number })
```

---

## Quick reference — human-readable names (never show codes)

```typescript
// In any component, import:
import { agentName, STAGE_META } from '@/store/cycle.store'
import { t, hint, DICT } from '@/design/dictionary'

// Agent names (use these, never A1/A2/etc):
agentName('A1')   // "Signal Analyst"
agentName('A2')   // "Value Estimator"
agentName('A3')   // "GTM Advisor"
agentName('A4')   // "Engineering Estimator"
agentName('A5')   // "Portfolio Advisor"
agentName('A10')  // "Release Checker"
agentName('A11')  // "Deployment Pilot"
agentName('A12')  // "Outcome Analyst"
agentName('A13')  // "Impact Reporter"
agentName('A14')  // "Learning Distiller"

// Stage titles (use these, never CLUSTER/QUALIFY/etc):
STAGE_META['SIGNALS'].title     // "Hear from customers"
STAGE_META['CLUSTER'].title     // "Find the patterns"
STAGE_META['INTAKE'].title      // "Write the case for action"
STAGE_META['QUALIFY'].title     // "Size the opportunity"
STAGE_META['PACKET'].title      // "Prepare the decision packet"
STAGE_META['PORTFOLIO_GATE'].title // "Leadership decides"
STAGE_META['BUILD'].title       // "Design and build it"
STAGE_META['CONSOLIDATE'].title // "Check if it is safe to ship"
STAGE_META['RELEASE_GATE'].title // "Required approvers sign off"
STAGE_META['ROLLOUT'].title     // "Release to customers gradually"
STAGE_META['OBSERVE'].title     // "Watch the metrics move"
STAGE_META['LEARN'].title       // "Judge the bets and capture lessons"
STAGE_META['DONE'].title        // "Cycle complete — loop back smarter"

// Graph node kinds (use these, never raw kinds in JSX):
t('CUSTOMER_SIGNAL')   // "Customer voice"
t('PAIN_POINT')        // "Problem"
t('VALUE_HYPOTHESIS')  // "The bet"
t('FEATURE')           // "Initiative"
t('KPI')               // "Metric"
t('REGULATION')        // "Regulation"
t('LEARNING')          // "Lesson"
t('HYPOTHESIS_VERDICT')// "Verdict"
t('DEPLOYMENT')        // "Go-live"
t('BUSINESS_RULE')     // "Rule"
t('BOUNDED_CONTEXT')   // "Product area"

// Bet phrases (use these for hypothesis display):
DICT.phrases.betLine('dispute_rate', 'decrease', 15, 90)
// → "Cut dispute_rate by 15% within 90 days"

DICT.phrases.verdictValidated('dispute_rate', -64)
// → "The bet paid off — dispute_rate moved −64%"

DICT.phrases.verdictRefuted('fleet_churn', -0.7)
// → "The bet did not pay off — fleet_churn moved −0.7%. That is a lesson, not a failure."
```

---

## File map — what each prompt changes

| Prompt | Files modified |
|--------|---------------|
| 1 | `screens/journey/JourneyCanvas.tsx` |
| 2 | `screens/story/FeatureStory.tsx` |
| 3 | `screens/gates/DecideRoom.tsx` |
| 4 | `screens/learn/LearnHub.tsx` |
| 5 | `panels/aep/CustomerSignalPanel/index.tsx` |
| 6 | `panels/aep/BusinessValuePanel/index.tsx` |
| 7 | `panels/aep/ConsolidationPanel/index.tsx` |
| 8 | `panels/aep/OutcomeDashboardPanel/index.tsx` |
| 9 | `passG/passGOrchestrator.ts` · `store/ux/ux.store.ts` · `screens/home/PersonaHome.tsx` · `shell/AppShell.tsx` |
| 10 | `panels/iss/FeaturePanel/index.tsx` · `panels/iss/POWorkbenchPanel/index.tsx` · `panels/iss/ImpactPanel/index.tsx` |
| 11 | `panels/aep/DomainBrowserPanel/index.tsx` |
| 12 | Validation only — fixes in any file |
| 13 | `shell/AppShell.tsx` · `tailwind.config.js` · various panels |

**Total new lines across all prompts: ~2,500–3,000**
**Files modified: 16 renderer + 1 main process**
**Files created: 0** (all targets already exist)

---

*End of implementation guide. The complete value cycle — from hearing a customer
to learning from the outcome, and back again with better predictions — is a
single guided journey that any member of the organization can follow.*
