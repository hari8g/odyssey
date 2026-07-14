// packages/main/src/aep/downstream/passF/kpiObservationIngester.ts
import type Database from 'better-sqlite3'
import { upsertNode, insertEdge } from '../../graphWrite'

export interface KpiObservationResult {
  observationId: number
  kpiId: number
}

export interface KpiSnapshotResult {
  snapshots: KpiObservationResult[]
  skipped: number
}

export class KpiObservationIngester {
  constructor(private readonly db: Database.Database) {}

  /**
   * Record a single manual KPI observation and link it to the KPI node.
   * Creates: KPI_OBSERVATION node + OBSERVED_AS edge from KPI → KPI_OBSERVATION.
   */
  recordManual(
    kpiNodeId: number,
    value: number,
    window: string,
    memo?: string,
  ): KpiObservationResult {
    return this.db.transaction((): KpiObservationResult => {
      const kpiRow = this.db
        .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
        .get(kpiNodeId)
      const kpiLabel = kpiRow?.label ?? `KPI#${kpiNodeId}`

      const obsLabel = `Obs: ${kpiLabel} = ${value} [${window}]`
      const observationId = upsertNode(this.db, {
        kind: 'KPI_OBSERVATION',
        label: obsLabel,
        description: memo ?? `Observed value ${value} for window ${window}`,
        source_type: 'manual',
        source_ref: String(kpiNodeId),
      })

      try {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO kpi_observations
             (observation_node_id, kpi_node_id, observed_value, measurement_window, observed_at)
             VALUES (?, ?, ?, ?, unixepoch() * 1000)`,
          )
          .run(observationId, kpiNodeId, value, window)
      } catch {
        // non-fatal if table doesn't exist
      }

      insertEdge(this.db, kpiNodeId, observationId, 'OBSERVED_AS', 1.0, {
        value,
        window,
      })

      return { observationId, kpiId: kpiNodeId }
    })()
  }

  /**
   * Snapshot all KPIs that have a baseline in kpi_registry by recording
   * the baseline as a KPI_OBSERVATION (useful as a starting point for attribution).
   */
  snapshotKPIs(): KpiSnapshotResult {
    const kpiRows = this.db
      .prepare<[], { id: number; label: string; baseline: number | null }>(
        `SELECT id, label, baseline FROM kpi_registry`,
      )
      .all()

    const snapshots: KpiObservationResult[] = []
    let skipped = 0

    for (const row of kpiRows) {
      if (row.baseline === null) { skipped++; continue }

      const kpiNodeId = upsertNode(this.db, {
        kind: 'KPI',
        label: row.label,
        source_type: 'kpi_registry',
        source_ref: String(row.id),
      })

      const result = this.recordManual(
        kpiNodeId,
        row.baseline,
        'snapshot_baseline',
        `Baseline snapshot from kpi_registry for ${row.label}`,
      )
      snapshots.push(result)
    }

    return { snapshots, skipped }
  }

  /**
   * Get recent observations for a KPI node.
   */
  getRecent(kpiNodeId: number, limit = 10): { value: number; window: string; observedAt: number }[] {
    try {
      return this.db
        .prepare<[number, number], { observed_value: number; measurement_window: string; observed_at: number }>(
          `SELECT observed_value, measurement_window, observed_at
           FROM kpi_observations
           WHERE kpi_node_id = ?
           ORDER BY observed_at DESC
           LIMIT ?`,
        )
        .all(kpiNodeId, limit)
        .map((r) => ({
          value: r.observed_value,
          window: r.measurement_window,
          observedAt: r.observed_at,
        }))
    } catch {
      return []
    }
  }
}
