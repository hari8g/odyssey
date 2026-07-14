// packages/main/src/aep/upstream/agents/artifactWriter.ts
import type Database from 'better-sqlite3'
import { upsertNode } from '../../graphWrite'

export type ArtifactKind =
  | 'BRIEF'
  | 'BUSINESS_IMPACT_ASSESSMENT'
  | 'GTM_NOTES'
  | 'DEV_IMPACT_ASSESSMENT'
  | 'DECISION_RECORD'
  | 'PORTFOLIO_PACKET'

export interface ArtifactInput {
  kind: ArtifactKind
  label: string
  description: string
  agentId: string
  agentVersion?: string
  derivedFrom: number[]
  confidence?: number
  approvedByRole?: string | null
}

export interface ArtifactRecord {
  nodeId: number
  kind: ArtifactKind
  label: string
}

export class ArtifactWriter {
  constructor(private readonly db: Database.Database) {}

  write(input: ArtifactInput): ArtifactRecord {
    return this.db.transaction((): ArtifactRecord => {
      const nodeId = upsertNode(this.db, {
        kind: input.kind,
        label: input.label,
        description: input.description.slice(0, 2000),
        source_type: 'aep_agent',
        source_ref: input.agentId,
      })

      this.db
        .prepare(
          `INSERT OR REPLACE INTO artifact_provenance
           (artifact_node_id, agent_id, agent_version, derived_from_json,
            confidence, approved_by_role, approved_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          nodeId,
          input.agentId,
          input.agentVersion ?? '1.0',
          JSON.stringify(input.derivedFrom),
          input.confidence ?? 0.7,
          input.approvedByRole ?? null,
        )

      return { nodeId, kind: input.kind, label: input.label }
    })()
  }

  /** Write a stub artifact when LLM fails, so the flow can continue. */
  writeStub(kind: ArtifactKind, label: string, agentId: string, derivedFrom: number[]): ArtifactRecord {
    return this.write({
      kind,
      label,
      description: `[stub] Auto-generated stub — LLM unavailable at generation time.`,
      agentId,
      derivedFrom,
      confidence: 0.0,
    })
  }
}
