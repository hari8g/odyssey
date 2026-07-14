// packages/main/src/aep/upstream/hypothesisRegistry.ts
import type Database from 'better-sqlite3'
import type { HypothesisPortfolioRow } from '@shared/index'
import { upsertNode, insertEdge } from '../graphWrite'

export interface DraftHypothesisInput {
  featureNodeId: number
  kpiLabel: string
  direction: 'increase' | 'decrease' | 'stabilize'
  magnitudePct: number
  timeframeDays: number
  priorConfidence: number
  attributionMethod: 'ab_flag' | 'canary' | 'before_after' | 'holdout'
}

export class HypothesisRegistry {
  constructor(private readonly db: Database.Database) {}

  /**
   * Register a draft hypothesis (registered_at = 0 sentinel).
   * Returns the hypothesis_node_id.
   */
  registerDraft(input: DraftHypothesisInput): number {
    const kpiId = upsertNode(this.db, {
      kind: 'KPI',
      label: input.kpiLabel,
      source_type: 'hypothesis_registry',
    })

    const hypothesisLabel = `H: ${input.direction} ${input.kpiLabel} by ${input.magnitudePct}%`
    const hypothesisId = upsertNode(this.db, {
      kind: 'VALUE_HYPOTHESIS',
      label: hypothesisLabel,
      description:
        `${input.direction} ${input.kpiLabel} by ~${input.magnitudePct}% within ` +
        `${input.timeframeDays}d (prior confidence ${input.priorConfidence})`,
      source_type: 'hypothesis_registry',
      source_ref: String(input.featureNodeId),
    })

    this.db
      .prepare(
        `INSERT OR IGNORE INTO value_hypotheses
         (hypothesis_node_id, kpi_node_id, direction, magnitude_pct,
          timeframe_days, prior_confidence, attribution_method, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        hypothesisId,
        kpiId,
        input.direction,
        input.magnitudePct,
        input.timeframeDays,
        input.priorConfidence,
        input.attributionMethod,
      )

    insertEdge(this.db, input.featureNodeId, hypothesisId, 'HAS_HYPOTHESIS')
    insertEdge(this.db, hypothesisId, kpiId, 'PREDICTS', input.priorConfidence)

    return hypothesisId
  }

  /**
   * Commit all draft hypotheses for a feature (set registered_at to now).
   * Called by the portfolio gate on admit.
   */
  commitForFeature(featureNodeId: number): number {
    const hypothesisIds = this.db
      .prepare<[number], { id: number }>(
        `SELECT gn.id FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id = ? AND ge.kind = 'HAS_HYPOTHESIS'`,
      )
      .all(featureNodeId)
      .map((r) => r.id)

    if (!hypothesisIds.length) return 0

    const now = Date.now()
    const result = this.db
      .prepare(
        `UPDATE value_hypotheses SET registered_at = ?
         WHERE hypothesis_node_id IN (${hypothesisIds.map(() => '?').join(',')})
           AND registered_at = 0`,
      )
      .run(now, ...hypothesisIds)

    return result.changes
  }

  /**
   * Query all committed hypotheses (registered_at > 0) with KPI labels.
   */
  getPortfolio(featureNodeId?: number): HypothesisPortfolioRow[] {
    const baseWhere = featureNodeId !== undefined
      ? `AND ge.from_node_id = ${featureNodeId}`
      : ''

    return this.db
      .prepare<[], HypothesisPortfolioRow & { hypothesisNodeId: number }>(
        `SELECT
           vh.hypothesis_node_id AS hypothesisNodeId,
           hn.label              AS label,
           kn.label              AS kpiLabel,
           vh.direction,
           vh.magnitude_pct      AS magnitudePct,
           vh.timeframe_days     AS timeframeDays,
           vh.prior_confidence   AS priorConfidence,
           vh.attribution_method AS attributionMethod,
           vh.actual_delta_pct   AS actualDeltaPct,
           vn.label              AS verdict
         FROM value_hypotheses vh
         JOIN graph_nodes hn ON hn.id = vh.hypothesis_node_id
         JOIN graph_nodes kn ON kn.id = vh.kpi_node_id
         LEFT JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id AND ge.kind = 'HAS_HYPOTHESIS'
         LEFT JOIN graph_nodes vn ON vn.id = vh.verdict_node_id
         WHERE vh.registered_at > 0 ${baseWhere}
         ORDER BY vh.registered_at DESC`,
      )
      .all()
  }

  /** Get draft (uncommitted) hypotheses for a feature */
  getDrafts(featureNodeId: number): { hypothesisNodeId: number; label: string; kpiLabel: string }[] {
    return this.db
      .prepare<[number], { hypothesisNodeId: number; label: string; kpiLabel: string }>(
        `SELECT
           vh.hypothesis_node_id AS hypothesisNodeId,
           hn.label              AS label,
           kn.label              AS kpiLabel
         FROM value_hypotheses vh
         JOIN graph_nodes hn ON hn.id = vh.hypothesis_node_id
         JOIN graph_nodes kn ON kn.id = vh.kpi_node_id
         JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id AND ge.kind = 'HAS_HYPOTHESIS'
         WHERE ge.from_node_id = ? AND vh.registered_at = 0`,
      )
      .all(featureNodeId)
  }
}
