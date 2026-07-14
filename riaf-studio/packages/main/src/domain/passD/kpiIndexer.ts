// packages/main/src/domain/passD/kpiIndexer.ts
import type Database from 'better-sqlite3'
import type { KPIDef } from '@shared/index'
import { upsertNode } from '../graphWrite'

/**
 * Index KPI nodes and upsert corresponding kpi_registry rows.
 */
export function indexKpis(db: Database.Database, kpis: KPIDef[]): void {
  if (kpis.length === 0) return

  const upsertRegistry = db.prepare(`
    INSERT OR REPLACE INTO kpi_registry
      (kpi_node_id, measurement_unit, measurement_window,
       telemetry_source, baseline_value, target_value, owner_org_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const kpi of kpis) {
      const nodeId = upsertNode(
        db,
        'KPI',
        kpi.name,
        kpi.description,
        null,
        { sourceType: 'manual', importanceScore: 0.7 },
      )

      upsertRegistry.run(
        nodeId,
        kpi.unit,
        kpi.measurementWindow,
        kpi.telemetrySource ?? null,
        kpi.baseline ?? null,
        kpi.target ?? null,
        kpi.owner ?? null,
      )
    }
  })

  tx()
}
