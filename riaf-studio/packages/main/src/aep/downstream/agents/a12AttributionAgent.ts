// packages/main/src/aep/downstream/agents/a12AttributionAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { upsertNode, insertEdge } from '../../graphWrite'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export interface A12Input {
  featureId: number
  /** Window label to look up observations in (e.g. 'post_deploy_7d') */
  observationWindow?: string
}

export interface HypothesisVerdictSummary {
  hypothesisId: number
  hypothesisLabel: string
  kpiLabel: string
  direction: string
  magnitudePct: number
  actualDeltaPct: number | null
  verdict: 'validated' | 'refuted' | 'inconclusive'
  verdictId: number
  confidence: number
}

export interface A12Result {
  verdicts: HypothesisVerdictSummary[]
  isStub: boolean
}

export class A12AttributionAgent {
  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {}

  async run(input: A12Input): Promise<A12Result> {
    const hypotheses = this.loadHypotheses(input.featureId)
    if (!hypotheses.length) return { verdicts: [], isStub: true }

    const verdicts: HypothesisVerdictSummary[] = []

    for (const hyp of hypotheses) {
      const obs = this.loadRelevantObservation(hyp.kpiNodeId, input.observationWindow)
      const actualDeltaPct = obs !== null ? this.computeDelta(hyp.kpiNodeId, obs) : null

      const verdict = this.determineVerdict(hyp, actualDeltaPct)
      const confidence = this.computeConfidence(hyp, actualDeltaPct, verdict)
      const rationale = await this.generateRationale(hyp, actualDeltaPct, verdict)

      const verdictSummary = this.db.transaction((): HypothesisVerdictSummary => {
        const verdictId = upsertNode(this.db, {
          kind: 'HYPOTHESIS_VERDICT',
          label: `Verdict: ${verdict.toUpperCase()} — ${hyp.label.slice(0, 100)}`,
          description: rationale,
          source_type: 'aep_agent',
          source_ref: 'a12_attribution',
        })

        // Link verdict to hypothesis
        const edgeKind = verdict === 'validated' ? 'VALIDATES_HYPOTHESIS' : 'REFUTES_HYPOTHESIS'
        insertEdge(this.db, verdictId, hyp.hypothesisId, edgeKind, confidence)

        // Update value_hypotheses actual_delta_pct and verdict_node_id
        if (actualDeltaPct !== null) {
          this.db
            .prepare(
              `UPDATE value_hypotheses
               SET actual_delta_pct = ?, verdict_node_id = ?
               WHERE hypothesis_node_id = ?`,
            )
            .run(actualDeltaPct, verdictId, hyp.hypothesisId)
        } else {
          this.db
            .prepare(
              `UPDATE value_hypotheses SET verdict_node_id = ? WHERE hypothesis_node_id = ?`,
            )
            .run(verdictId, hyp.hypothesisId)
        }

        // Link verdict to observed KPI observations via ATTRIBUTED_TO
        if (obs !== null) {
          insertEdge(this.db, verdictId, obs.observationNodeId, 'ATTRIBUTED_TO', confidence)
        }

        return {
          hypothesisId: hyp.hypothesisId,
          hypothesisLabel: hyp.label,
          kpiLabel: hyp.kpiLabel,
          direction: hyp.direction,
          magnitudePct: hyp.magnitudePct,
          actualDeltaPct,
          verdict,
          verdictId,
          confidence,
        }
      })()

      verdicts.push(verdictSummary)
    }

    return { verdicts, isStub: false }
  }

  private loadHypotheses(featureId: number): {
    hypothesisId: number
    label: string
    kpiNodeId: number
    kpiLabel: string
    direction: string
    magnitudePct: number
    timeframeDays: number
    priorConfidence: number
    attributionMethod: string
  }[] {
    return this.db
      .prepare<[number], {
        hypothesisId: number
        label: string
        kpiNodeId: number
        kpiLabel: string
        direction: string
        magnitudePct: number
        timeframeDays: number
        priorConfidence: number
        attributionMethod: string
      }>(
        `SELECT
           vh.hypothesis_node_id AS hypothesisId,
           hn.label              AS label,
           vh.kpi_node_id        AS kpiNodeId,
           kn.label              AS kpiLabel,
           vh.direction,
           vh.magnitude_pct      AS magnitudePct,
           vh.timeframe_days     AS timeframeDays,
           vh.prior_confidence   AS priorConfidence,
           vh.attribution_method AS attributionMethod
         FROM value_hypotheses vh
         JOIN graph_nodes hn ON hn.id = vh.hypothesis_node_id
         JOIN graph_nodes kn ON kn.id = vh.kpi_node_id
         JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id AND ge.kind = 'HAS_HYPOTHESIS'
         WHERE ge.from_node_id = ? AND vh.registered_at > 0`,
      )
      .all(featureId)
  }

  private loadRelevantObservation(
    kpiNodeId: number,
    window?: string,
  ): { observationNodeId: number; value: number } | null {
    try {
      const row = window
        ? this.db
            .prepare<[number, string], { observation_node_id: number; observed_value: number }>(
              `SELECT observation_node_id, observed_value
               FROM kpi_observations
               WHERE kpi_node_id = ? AND measurement_window = ?
               ORDER BY observed_at DESC LIMIT 1`,
            )
            .get(kpiNodeId, window)
        : this.db
            .prepare<[number], { observation_node_id: number; observed_value: number }>(
              `SELECT observation_node_id, observed_value
               FROM kpi_observations
               WHERE kpi_node_id = ?
               ORDER BY observed_at DESC LIMIT 1`,
            )
            .get(kpiNodeId)

      if (!row) return null
      return { observationNodeId: row.observation_node_id, value: row.observed_value }
    } catch {
      return null
    }
  }

  private computeDelta(kpiNodeId: number, current: { value: number }): number | null {
    try {
      const baseline = this.db
        .prepare<[number], { observed_value: number }>(
          `SELECT observed_value FROM kpi_observations
           WHERE kpi_node_id = ? AND measurement_window = 'snapshot_baseline'
           ORDER BY observed_at ASC LIMIT 1`,
        )
        .get(kpiNodeId)

      if (!baseline || baseline.observed_value === 0) return null
      return ((current.value - baseline.observed_value) / Math.abs(baseline.observed_value)) * 100
    } catch {
      return null
    }
  }

  private determineVerdict(
    hyp: { direction: string; magnitudePct: number },
    actualDeltaPct: number | null,
  ): 'validated' | 'refuted' | 'inconclusive' {
    if (actualDeltaPct === null) return 'inconclusive'

    const sign = actualDeltaPct >= 0 ? 'increase' : 'decrease'
    const magnitude = Math.abs(actualDeltaPct)
    const directionMatch = sign === hyp.direction || hyp.direction === 'stabilize'
    const magnitudeMatch = magnitude >= hyp.magnitudePct * 0.5

    if (directionMatch && magnitudeMatch) return 'validated'
    if (!directionMatch) return 'refuted'
    return 'inconclusive'
  }

  private computeConfidence(
    hyp: { priorConfidence: number },
    actualDeltaPct: number | null,
    verdict: string,
  ): number {
    if (actualDeltaPct === null) return 0.3
    if (verdict === 'validated') return Math.min(0.95, hyp.priorConfidence + 0.2)
    if (verdict === 'refuted') return Math.max(0.05, hyp.priorConfidence - 0.3)
    return 0.4
  }

  private async generateRationale(
    hyp: { label: string; direction: string; magnitudePct: number; kpiLabel: string },
    actualDeltaPct: number | null,
    verdict: string,
  ): Promise<string> {
    if (!this.llm) return this.stubRationale(hyp, actualDeltaPct, verdict)
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system: 'You are a data analyst writing hypothesis verdict rationale. Be concise (100 words max).',
        messages: [
          {
            role: 'user',
            content:
              `Hypothesis: "${hyp.label}"\n` +
              `Expected: ${hyp.direction} ${hyp.kpiLabel} by ${hyp.magnitudePct}%\n` +
              `Actual delta: ${actualDeltaPct !== null ? `${actualDeltaPct.toFixed(1)}%` : 'no data'}\n` +
              `Verdict: ${verdict.toUpperCase()}\n\n` +
              `Write a 50-100 word rationale explaining this verdict.`,
          },
        ],
        max_tokens: 200,
      })
      return llmText(resp)
    } catch {
      return this.stubRationale(hyp, actualDeltaPct, verdict)
    }
  }

  private stubRationale(
    hyp: { direction: string; magnitudePct: number; kpiLabel: string },
    actualDeltaPct: number | null,
    verdict: string,
  ): string {
    return (
      `[stub] Verdict: ${verdict.toUpperCase()}. ` +
      `Expected ${hyp.direction} of ${hyp.magnitudePct}% on ${hyp.kpiLabel}. ` +
      (actualDeltaPct !== null
        ? `Observed actual delta: ${actualDeltaPct.toFixed(1)}%.`
        : `No observation data available.`)
    )
  }
}
