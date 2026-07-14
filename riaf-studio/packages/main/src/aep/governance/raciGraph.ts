// packages/main/src/aep/governance/raciGraph.ts
import type Database from 'better-sqlite3'

const DEFAULT_APPROVAL_SET = ['Product Owner', 'Engineering Lead'] as const

const RACI_EDGE_KINDS = ['OWNED_BY', 'CONSULTED_BY', 'INFORMED_BY'] as const

/**
 * Derive the approval set for a feature from its RACI graph edges.
 *
 * Collects roles from OWNED_BY / CONSULTED_BY / INFORMED_BY edges, then
 * boosts (prepends) any GOVERNED_BY roles. Falls back to the default set
 * when no edges are present.
 */
export function getApprovalSet(db: Database.Database, featureId: number): string[] {
  const raciRoles = db
    .prepare<[number], { role: string }>(
      `SELECT DISTINCT gn.label AS role
       FROM graph_edges ge
       JOIN graph_nodes gn ON gn.id = ge.to_node_id
       WHERE ge.from_node_id = ?
         AND ge.kind IN ('OWNED_BY', 'CONSULTED_BY', 'INFORMED_BY')
       ORDER BY gn.label`,
    )
    .all(featureId)
    .map((r) => r.role)

  const governedRoles = db
    .prepare<[number], { role: string }>(
      `SELECT DISTINCT gn.label AS role
       FROM graph_edges ge
       JOIN graph_nodes gn ON gn.id = ge.to_node_id
       WHERE ge.from_node_id = ?
         AND ge.kind = 'GOVERNED_BY'
       ORDER BY gn.label`,
    )
    .all(featureId)
    .map((r) => r.role)

  // GOVERNED_BY roles come first as boosted approvers
  const combined = [...new Set([...governedRoles, ...raciRoles])]

  if (combined.length === 0) {
    return [...DEFAULT_APPROVAL_SET]
  }

  // Always ensure the defaults are present
  for (const def of DEFAULT_APPROVAL_SET) {
    if (!combined.includes(def)) {
      combined.push(def)
    }
  }

  return combined
}

// Re-export for callers that want the edge-kind list
export { RACI_EDGE_KINDS }
