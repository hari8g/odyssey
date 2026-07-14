// packages/main/src/cycle/demoSimulator.ts
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import { CustomerSignalIngester } from '../aep/upstream/passE/customerSignalIngester'
import { CicdIngester } from '../aep/downstream/passF/cicdIngester'
import { KpiObservationIngester } from '../aep/downstream/passF/kpiObservationIngester'

export class DemoSimulator {
  constructor(private readonly db: Database.Database) {}

  private assertDemo(runId: number): void {
    const r = this.db
      .prepare<[number], { mode: string }>(`SELECT mode FROM cycle_runs WHERE id=?`)
      .get(runId)
    if (r?.mode !== 'demo') throw new Error('simulation is only allowed on demo runs')
  }

  /** Stage 0: load the bundled sample signal CSV. */
  simulateSignals(runId: number): number {
    this.assertDemo(runId)
    const candidates = [
      path.join(__dirname, '../../../resources/demo/sample_signals.csv'),
      path.join(app.getAppPath(), 'resources', 'demo', 'sample_signals.csv'),
      path.join(process.cwd(), 'resources', 'demo', 'sample_signals.csv'),
    ]
    const fp = candidates.find((p) => fs.existsSync(p))
    if (!fp) throw new Error('demo sample_signals.csv not found')
    const result = new CustomerSignalIngester(this.db).ingestFile(fp, 'demo')
    return result.inserted + result.signalNodeIds.length
  }

  /**
   * Stage 6: fabricate a CI build linked to the feature's traced files
   * (and the feature itself) plus a RELEASE_CANDIDATE.
   */
  simulateCI(runId: number): { buildId: number; releaseCandidateId: number | null } {
    this.assertDemo(runId)
    const run = this.db
      .prepare<[number], { feature_node_id: number | null }>(
        `SELECT feature_node_id FROM cycle_runs WHERE id=?`,
      )
      .get(runId)
    if (!run?.feature_node_id) {
      throw new Error('no feature token yet — pass the portfolio gate first')
    }

    const traced = this.db
      .prepare<[number], { file_path: string | null }>(
        `
      SELECT gn.file_path
      FROM feature_traces ft
      JOIN graph_nodes gn ON gn.id = ft.code_node_id
      WHERE ft.feature_node_id = ? AND gn.file_path IS NOT NULL
      LIMIT 20
    `,
      )
      .all(run.feature_node_id)
      .map((r) => r.file_path!)
      .filter(Boolean)

    const files =
      traced.length > 0
        ? traced
        : this.db
            .prepare<[], { file_path: string }>(
              `SELECT file_path FROM graph_nodes
               WHERE kind IN ('CLASS','MODULE','FUNCTION') AND file_path IS NOT NULL
               LIMIT 5`,
            )
            .all()
            .map((r) => r.file_path)

    const sha = `demo${Date.now().toString(16)}`
    const result = new CicdIngester(this.db).ingest({
      sha,
      runId: `demo-run-${runId}-${Date.now()}`,
      conclusion: 'success',
      files,
      featureId: run.feature_node_id,
      releaseCandidateLabel: `RC demo cycle-${runId}`,
    })

    if (result.releaseCandidateId) {
      this.db
        .prepare(
          `UPDATE cycle_runs SET rc_id=?, updated_at=unixepoch()*1000 WHERE id=?`,
        )
        .run(result.releaseCandidateId, runId)
    }

    return result
  }

  /**
   * Stage 10: record KPI observations for committed hypotheses.
   * drift ∈ [0,1]: 1.0 = lands on prediction, 0.0 = no movement.
   */
  simulateKpi(runId: number, drift: number): number {
    this.assertDemo(runId)
    const ing = new KpiObservationIngester(this.db)
    const hyps = this.db
      .prepare<
        [],
        {
          kpi_id: number
          baseline: number | null
          direction: string
          magnitude: number
        }
      >(
        `
      SELECT vh.kpi_node_id kpi_id, kr.baseline_value baseline,
             vh.direction, vh.magnitude_pct magnitude
      FROM value_hypotheses vh
      JOIN graph_nodes h ON h.id=vh.hypothesis_node_id AND h.source_type='committed'
      LEFT JOIN kpi_registry kr ON kr.kpi_node_id=vh.kpi_node_id
      WHERE vh.verdict_node_id IS NULL
    `,
      )
      .all()

    for (const h of hyps) {
      const base = h.baseline ?? 100
      const sign = h.direction === 'decrease' ? -1 : 1
      const value = base * (1 + sign * (h.magnitude / 100) * drift)
      ing.recordManual(h.kpi_id, Number(value.toFixed(3)), 'demo_snapshot')
    }
    return hyps.length
  }
}
