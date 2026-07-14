/**
 * Plain-language dictionary — single source of every user-facing graph term.
 * Nothing in Journey UI should render a raw kind string; go through t() / <Term>.
 */

export const DICT = {
  CUSTOMER_SIGNAL: { human: 'Customer voice', hint: 'A single piece of raw feedback (CUSTOMER_SIGNAL)' },
  PAIN_POINT: { human: 'Problem', hint: 'Many voices, one named problem (PAIN_POINT)' },
  BRIEF: { human: 'Case for action', hint: 'A1 intake brief (BRIEF)' },
  VALUE_HYPOTHESIS: {
    human: 'The bet',
    hint: 'A falsifiable prediction on a KPI, locked before code (VALUE_HYPOTHESIS)',
  },
  BUSINESS_OBJECTIVE: { human: 'Company goal', hint: 'BUSINESS_OBJECTIVE' },
  COST_ESTIMATE: { human: 'Effort estimate', hint: 'Range, never a point (COST_ESTIMATE)' },
  FEATURE: {
    human: 'Initiative',
    hint: 'The unit of commitment flowing through the journey (FEATURE)',
  },
  BOUNDED_CONTEXT: { human: 'Product area', hint: 'BOUNDED_CONTEXT' },
  BUSINESS_RULE: { human: 'Rule', hint: 'Formal, enforceable (BUSINESS_RULE)' },
  REGULATION: { human: 'Regulation', hint: 'External obligation with clause reference (REGULATION)' },
  KPI: { human: 'Metric', hint: 'Measured, owned, targeted (KPI)' },
  RELEASE_CANDIDATE: { human: 'Release', hint: 'RELEASE_CANDIDATE' },
  RELEASE_READINESS_REPORT: {
    human: 'Readiness check',
    hint: 'Computed, not asserted (RELEASE_READINESS_REPORT)',
  },
  DEPLOYMENT: { human: 'Go-live', hint: 'DEPLOYMENT' },
  KPI_OBSERVATION: { human: 'Measurement', hint: 'KPI_OBSERVATION' },
  HYPOTHESIS_VERDICT: {
    human: 'Verdict',
    hint: 'Did the bet pay off? (HYPOTHESIS_VERDICT)',
  },
  IMPACT_ASSESSMENT: {
    human: 'Impact for your team',
    hint: 'IMPACT_ASSESSMENT, one per org unit',
  },
  LEARNING: {
    human: 'Lesson',
    hint: 'Distilled, wired back upstream (LEARNING)',
  },
  DECISION_RECORD: {
    human: 'Decision',
    hint: 'Who decided, why, when (DECISION_RECORD)',
  },
  INCIDENT: { human: 'Incident', hint: 'INCIDENT' },
  BUSINESS_IMPACT_ASSESSMENT: { human: 'Worth assessment', hint: 'BUSINESS_IMPACT_ASSESSMENT' },
  DEV_IMPACT_ASSESSMENT: { human: 'Effort assessment', hint: 'DEV_IMPACT_ASSESSMENT' },
  PORTFOLIO_PACKET: { human: 'Decision packet', hint: 'PORTFOLIO_PACKET' },
  GTM_NOTES: { human: 'GTM notes', hint: 'GTM_NOTES' },

  stage: {
    LISTEN: { title: 'Listen', tag: 'Hear the customer' },
    DECIDE: { title: 'Decide', tag: 'Place the bet' },
    DEFINE: { title: 'Define', tag: 'Agree what it means' },
    BUILD: { title: 'Build', tag: 'Make it real' },
    SHIP: { title: 'Ship', tag: 'Release with eyes open' },
    LEARN: { title: 'Learn', tag: 'Judge the bet, keep the lesson' },
  },
  status: {
    waiting_gate: 'Needs a decision',
    waiting_external: 'Waiting on the world',
    running: 'Agents working',
    completed: 'Cycle complete',
    error: 'Needs attention',
    bounced: 'Sent back to fix',
    halted: 'Rollout halted automatically',
    aborted: 'Cycle aborted',
  },
  phrases: {
    betLine: (kpi: string, dir: string, mag: number, days: number) =>
      `${dir === 'decrease' ? 'Cut' : dir === 'increase' ? 'Lift' : 'Hold'} ${kpi} by ${mag}% within ${days} days`,
    verdictValidated: (kpi: string, actual: number) =>
      `The bet paid off — ${kpi} moved ${actual.toFixed(1)}%`,
    verdictRefuted: (kpi: string, actual: number) =>
      `The bet did not pay off — ${kpi} moved only ${actual.toFixed(1)}%. That is a lesson, not a failure.`,
    gateWaiting: (roles: string[]) => `Waiting on ${roles.join(', ')} to sign`,
  },
} as const

export const t = (kind: string): string => {
  const entry = (DICT as Record<string, unknown>)[kind]
  if (entry && typeof entry === 'object' && entry !== null && 'human' in entry) {
    return (entry as { human: string }).human
  }
  return kind
}

export const hint = (kind: string): string | undefined => {
  const entry = (DICT as Record<string, unknown>)[kind]
  if (entry && typeof entry === 'object' && entry !== null && 'hint' in entry) {
    return (entry as { hint?: string }).hint
  }
  return undefined
}

export const statusLabel = (status: string): string =>
  (DICT.status as Record<string, string>)[status] ?? status
