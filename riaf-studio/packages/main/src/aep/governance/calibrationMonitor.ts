// packages/main/src/aep/governance/calibrationMonitor.ts
import type Database from 'better-sqlite3'

export interface CalibrationCycleInput {
  agentId: string
  predictions: number
  verified: number
  meanErrorPct?: number | null
  notes?: Record<string, unknown> | null
}

export interface CalibrationRow {
  id: number
  agentId: string
  cycleEndDate: string
  predictions: number
  verified: number
  meanErrorPct: number | null
  calibrationScore: number | null
  notes: Record<string, unknown> | null
}

/**
 * Record one calibration cycle for an agent.
 * calibration_score = verified / predictions (accuracy ratio), clamped to [0, 1].
 */
export function recordCycle(db: Database.Database, input: CalibrationCycleInput): number {
  const cycleEndDate = new Date().toISOString().slice(0, 10)
  const calibrationScore =
    input.predictions > 0
      ? Math.min(1, Math.max(0, input.verified / input.predictions))
      : null

  const result = db
    .prepare(
      `INSERT INTO agent_calibration
       (agent_id, cycle_end_date, predictions, verified,
        mean_error_pct, calibration_score, notes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.agentId,
      cycleEndDate,
      input.predictions,
      input.verified,
      input.meanErrorPct ?? null,
      calibrationScore,
      input.notes ? JSON.stringify(input.notes) : null,
    )

  return result.lastInsertRowid as number
}

/**
 * Retrieve all calibration rows, most recent first.
 */
export function getReport(db: Database.Database, agentId?: string): CalibrationRow[] {
  const rows = agentId
    ? db
        .prepare<
          [string],
          {
            id: number
            agent_id: string
            cycle_end_date: string
            predictions: number
            verified: number
            mean_error_pct: number | null
            calibration_score: number | null
            notes_json: string | null
          }
        >(
          `SELECT id, agent_id, cycle_end_date, predictions, verified,
                  mean_error_pct, calibration_score, notes_json
           FROM agent_calibration
           WHERE agent_id = ?
           ORDER BY cycle_end_date DESC, id DESC`,
        )
        .all(agentId)
    : db
        .prepare<
          [],
          {
            id: number
            agent_id: string
            cycle_end_date: string
            predictions: number
            verified: number
            mean_error_pct: number | null
            calibration_score: number | null
            notes_json: string | null
          }
        >(
          `SELECT id, agent_id, cycle_end_date, predictions, verified,
                  mean_error_pct, calibration_score, notes_json
           FROM agent_calibration
           ORDER BY cycle_end_date DESC, id DESC`,
        )
        .all()

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    cycleEndDate: r.cycle_end_date,
    predictions: r.predictions,
    verified: r.verified,
    meanErrorPct: r.mean_error_pct,
    calibrationScore: r.calibration_score,
    notes: r.notes_json ? (JSON.parse(r.notes_json) as Record<string, unknown>) : null,
  }))
}

/**
 * After Pass G completes, seed a calibration row for A2/A12 by comparing
 * the hypothesis prior_confidence against the actual outcome.
 *
 * Only inserts when there are committed hypotheses with actual deltas for the feature.
 */
export function seedPassGRow(db: Database.Database, featureId: number): void {
  const hypotheses = db
    .prepare<
      [number],
      {
        hypothesis_node_id: number
        prior_confidence: number
        actual_delta_pct: number | null
        magnitude_pct: number
        verdict_node_id: number | null
      }
    >(
      `SELECT vh.hypothesis_node_id, vh.prior_confidence, vh.actual_delta_pct,
              vh.magnitude_pct, vh.verdict_node_id
       FROM value_hypotheses vh
       JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id
       WHERE ge.from_node_id = ?
         AND ge.kind = 'HAS_HYPOTHESIS'
         AND vh.registered_at > 0`,
    )
    .all(featureId)

  if (!hypotheses.length) return

  const withVerdict = hypotheses.filter((h) => h.verdict_node_id !== null)
  if (!withVerdict.length) return

  // Mean absolute error between predicted magnitude and actual delta (as a %)
  const errorPcts = withVerdict
    .filter((h) => h.actual_delta_pct !== null)
    .map((h) => Math.abs((h.magnitude_pct - (h.actual_delta_pct ?? 0)) / (h.magnitude_pct || 1)) * 100)

  const meanErrorPct =
    errorPcts.length > 0 ? errorPcts.reduce((s, v) => s + v, 0) / errorPcts.length : null

  // A2 calibration: predictions = total hypotheses, verified = those with a verdict
  recordCycle(db, {
    agentId: 'a2_business_impact',
    predictions: hypotheses.length,
    verified: withVerdict.length,
    meanErrorPct,
    notes: { featureId, source: 'pass_g_seed' },
  })

  // A12 calibration (KPI attribution)
  recordCycle(db, {
    agentId: 'a12_kpi_snapshot',
    predictions: hypotheses.length,
    verified: withVerdict.length,
    meanErrorPct,
    notes: { featureId, source: 'pass_g_seed' },
  })
}
