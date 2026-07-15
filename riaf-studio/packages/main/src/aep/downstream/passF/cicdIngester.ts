// packages/main/src/aep/downstream/passF/cicdIngester.ts
import type Database from 'better-sqlite3'
import { upsertNode, insertEdge } from '../../graphWrite'

export interface CicdPayload {
  sha: string
  runId: string
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | string
  files?: string[]
  /** Optional: label for the RELEASE_CANDIDATE to create */
  releaseCandidateLabel?: string
  /** Optional: link build to this feature node directly */
  featureId?: number
}

export interface CicdIngestResult {
  buildId: number
  releaseCandidateId: number | null
  packagedEdges: number
}

export class CicdIngester {
  constructor(private readonly db: Database.Database) {}

  ingest(payload: CicdPayload): CicdIngestResult {
    return this.db.transaction((): CicdIngestResult => {
      const buildLabel = `Build ${payload.sha.slice(0, 12)} (run ${payload.runId})`

      const buildId = upsertNode(this.db, {
        kind: 'BUILD',
        label: buildLabel,
        description: `CI/CD run ${payload.runId} — conclusion: ${payload.conclusion}`,
        source_type: 'cicd',
        source_ref: payload.runId,
      })

      this.db
        .prepare(
          `INSERT OR IGNORE INTO build_registry
           (build_node_id, sha, run_id, conclusion, built_at)
           VALUES (?, ?, ?, ?, unixepoch() * 1000)`,
        )
        .run(buildId, payload.sha, payload.runId, payload.conclusion)

      let packagedEdges = 0
      if (payload.files?.length) {
        for (const filePath of payload.files) {
          const fileNodeId = this.findFileNode(filePath)
          if (fileNodeId !== undefined) {
            insertEdge(this.db, fileNodeId, buildId, 'PACKAGED_IN')
            packagedEdges++
          }
        }
      }

      // If a featureId is given, link the build to the feature node for traceability
      if (payload.featureId !== undefined) {
        insertEdge(this.db, payload.featureId, buildId, 'IMPLEMENTS', 1.0, {
          via: 'cicd_build',
        })
      }

      let releaseCandidateId: number | null = null
      if (payload.releaseCandidateLabel) {
        releaseCandidateId = upsertNode(this.db, {
          kind: 'RELEASE_CANDIDATE',
          label: payload.releaseCandidateLabel,
          description: `RC containing build ${buildLabel}`,
          source_type: 'cicd',
          source_ref: payload.sha,
        })
        insertEdge(this.db, buildId, releaseCandidateId, 'PACKAGED_IN', 1.0, {
          sha: payload.sha,
        })
      }

      return { buildId, releaseCandidateId, packagedEdges }
    })()
  }

  private findFileNode(filePath: string): number | undefined {
    const row = this.db
      .prepare<[string, string, string], { id: number }>(
        `SELECT id FROM graph_nodes
         WHERE file_path = ? OR source_ref = ? OR label = ?
         LIMIT 1`,
      )
      .get(filePath, filePath, filePath)
    return row?.id
  }
}
