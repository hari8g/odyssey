// packages/main/src/aep/governance/agentCapabilityMatrix.ts
import type Database from 'better-sqlite3'

export interface AgentCapabilityRow {
  agent_id: string
  layer: string
  node_kinds: string[]
  edge_kinds: string[]
  requires_gate: boolean
}

interface SeedEntry {
  agentId: string
  layer: string
  nodeKinds: string[]
  edgeKinds: string[]
  requiresGate?: boolean
}

const DEFAULT_CAPABILITIES: SeedEntry[] = [
  // ── Upstream agents ──────────────────────────────────────────────────────
  {
    agentId: 'a1_intake',
    layer: 'upstream',
    nodeKinds: ['FEATURE', 'BRIEF'],
    edgeKinds: ['MOTIVATES'],
  },
  {
    agentId: 'a2_business_impact',
    layer: 'upstream',
    nodeKinds: ['BUSINESS_IMPACT_ASSESSMENT', 'VALUE_HYPOTHESIS', 'KPI'],
    edgeKinds: ['MOTIVATES', 'HAS_HYPOTHESIS', 'PREDICTS'],
  },
  {
    agentId: 'a3_gtm_alignment',
    layer: 'upstream',
    nodeKinds: ['GTM_NOTES'],
    edgeKinds: ['MOTIVATES', 'ADVANCES', 'TARGETS'],
  },
  {
    agentId: 'a4_dev_impact',
    layer: 'upstream',
    nodeKinds: ['DEV_IMPACT_ASSESSMENT'],
    edgeKinds: ['MOTIVATES', 'IMPACTS'],
  },
  {
    agentId: 'a5_portfolio',
    layer: 'upstream',
    nodeKinds: ['DECISION_RECORD', 'PORTFOLIO_PACKET'],
    edgeKinds: ['HAS_DECISION'],
    requiresGate: true,
  },

  // ── Downstream agents ────────────────────────────────────────────────────
  {
    agentId: 'a10_blast_radius',
    layer: 'downstream',
    nodeKinds: ['BLAST_RADIUS_REPORT'],
    edgeKinds: ['IMPACTS', 'CO_CHANGES_WITH'],
  },
  {
    agentId: 'a11_build_ingest',
    layer: 'downstream',
    nodeKinds: ['BUILD'],
    edgeKinds: ['IMPLEMENTS', 'PACKAGED_IN'],
  },
  {
    agentId: 'a12_kpi_snapshot',
    layer: 'downstream',
    nodeKinds: ['KPI_SNAPSHOT', 'HYPOTHESIS_VERDICT'],
    edgeKinds: ['MEASURED_BY', 'VALIDATES'],
  },
  {
    agentId: 'a13_deployment',
    layer: 'downstream',
    nodeKinds: ['DEPLOYMENT', 'RELEASE_READINESS_REPORT'],
    edgeKinds: ['DEPLOYS', 'RELEASES'],
  },
  {
    agentId: 'a14_learning',
    layer: 'downstream',
    nodeKinds: ['LEARNING'],
    edgeKinds: ['INFORMS'],
  },
]

/**
 * Idempotent seed: INSERT OR IGNORE so re-running is safe.
 */
export function seed(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO agent_capabilities
     (agent_id, layer, node_kinds_json, edge_kinds_json, requires_gate)
     VALUES (?, ?, ?, ?, ?)`,
  )

  const seedAll = db.transaction(() => {
    for (const entry of DEFAULT_CAPABILITIES) {
      insert.run(
        entry.agentId,
        entry.layer,
        JSON.stringify(entry.nodeKinds),
        JSON.stringify(entry.edgeKinds),
        entry.requiresGate ? 1 : 0,
      )
    }
  })

  seedAll()
}

/**
 * Returns all capability rows for an agent, parsed from JSON columns.
 */
export function getCapabilities(
  db: Database.Database,
  agentId: string,
): AgentCapabilityRow[] {
  return db
    .prepare<
      [string],
      { agent_id: string; layer: string; node_kinds_json: string; edge_kinds_json: string; requires_gate: number }
    >(
      `SELECT agent_id, layer, node_kinds_json, edge_kinds_json, requires_gate
       FROM agent_capabilities
       WHERE agent_id = ?`,
    )
    .all(agentId)
    .map((row) => ({
      agent_id: row.agent_id,
      layer: row.layer,
      node_kinds: JSON.parse(row.node_kinds_json) as string[],
      edge_kinds: JSON.parse(row.edge_kinds_json) as string[],
      requires_gate: row.requires_gate === 1,
    }))
}
