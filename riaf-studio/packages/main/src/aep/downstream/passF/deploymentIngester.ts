// packages/main/src/aep/downstream/passF/deploymentIngester.ts
import type Database from 'better-sqlite3'
import { upsertNode, insertEdge, ensureValueStreamState } from '../../graphWrite'

export interface DeploymentPayload {
  buildId: number
  environmentLabel: string
  /** Optional human-readable label for the deployment */
  deploymentLabel?: string
  deployedAt?: number
  deployedBy?: string
  version?: string
}

export interface DeploymentIngestResult {
  deploymentId: number
  environmentId: number
  featuresAdvanced: number[]
}

export class DeploymentIngester {
  constructor(private readonly db: Database.Database) {}

  ingest(payload: DeploymentPayload): DeploymentIngestResult {
    return this.db.transaction((): DeploymentIngestResult => {
      const ts = payload.deployedAt ?? Date.now()
      const label =
        payload.deploymentLabel ??
        `Deploy to ${payload.environmentLabel}${payload.version ? ` v${payload.version}` : ''} @ ${new Date(ts).toISOString()}`

      const deploymentId = upsertNode(this.db, {
        kind: 'DEPLOYMENT',
        label,
        description:
          `Build ${payload.buildId} → ${payload.environmentLabel}` +
          (payload.deployedBy ? ` by ${payload.deployedBy}` : '') +
          (payload.version ? ` (${payload.version})` : ''),
        source_type: 'cicd',
        source_ref: String(payload.buildId),
      })

      try {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO deployment_registry
             (deployment_node_id, build_node_id, environment, deployed_by, version, deployed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            deploymentId,
            payload.buildId,
            payload.environmentLabel,
            payload.deployedBy ?? null,
            payload.version ?? null,
            ts,
          )
      } catch {
        // non-fatal if table doesn't exist
      }

      // DEPLOYMENT → BUILD (via source_ref, captured in metadata)
      insertEdge(this.db, deploymentId, payload.buildId, 'EVIDENCED_BY', 1.0, {
        role: 'deployment_build',
      })

      // ENVIRONMENT node
      const environmentId = upsertNode(this.db, {
        kind: 'ENVIRONMENT',
        label: payload.environmentLabel,
        source_type: 'cicd',
      })

      insertEdge(this.db, deploymentId, environmentId, 'DEPLOYED_TO')

      // Advance related features to OBSERVE
      const featuresAdvanced = this.advanceRelatedFeatures(payload.buildId, deploymentId)

      return { deploymentId, environmentId, featuresAdvanced }
    })()
  }

  /**
   * Walk BUILD → PACKAGED_IN (reverse) to find code nodes,
   * then find FEATUREs linked to those code nodes via IMPLEMENTS,
   * and advance their value_stream_state to OBSERVE.
   */
  private advanceRelatedFeatures(buildId: number, deploymentId: number): number[] {
    // Features directly linked to the build via IMPLEMENTS (set by cicdIngester)
    const directFeatures = this.db
      .prepare<[number], { id: number }>(
        `SELECT DISTINCT from_node_id AS id
         FROM graph_edges
         WHERE to_node_id = ? AND kind = 'IMPLEMENTS'`,
      )
      .all(buildId)
      .map((r) => r.id)

    // Features whose code nodes are PACKAGED_IN this build
    const packagedFeatures = this.db
      .prepare<[number], { id: number }>(
        `SELECT DISTINCT fn.id
         FROM graph_edges ge_pkg
         JOIN graph_nodes code ON code.id = ge_pkg.from_node_id
         JOIN graph_edges ge_impl ON ge_impl.to_node_id = code.id AND ge_impl.kind = 'IMPLEMENTS'
         JOIN graph_nodes fn ON fn.id = ge_impl.from_node_id AND fn.kind = 'FEATURE'
         WHERE ge_pkg.to_node_id = ? AND ge_pkg.kind = 'PACKAGED_IN'`,
      )
      .all(buildId)
      .map((r) => r.id)

    const featureIds = [...new Set([...directFeatures, ...packagedFeatures])].filter(
      (id) => this.isFeatureNode(id),
    )

    for (const fId of featureIds) {
      ensureValueStreamState(this.db, fId, 'OBSERVE')
      insertEdge(this.db, deploymentId, fId, 'DEPLOYED_TO', 1.0, {
        advanced_to: 'OBSERVE',
      })
    }

    return featureIds
  }

  private isFeatureNode(nodeId: number): boolean {
    const row = this.db
      .prepare<[number], { kind: string }>('SELECT kind FROM graph_nodes WHERE id = ?')
      .get(nodeId)
    return row?.kind === 'FEATURE'
  }
}
