// packages/main/src/aep/governance/humanGateManager.ts
import type Database from 'better-sqlite3'
import type { ValueStreamState } from '@shared/index'
import { upsertNode, insertEdge, ensureValueStreamState } from '../graphWrite'
import { NEXT_STATE } from './blackboard'

export interface PendingGate {
  featureId: number
  featureLabel: string
  streamState: ValueStreamState
  blockedReasons: string[]
}

export interface ApprovalInput {
  featureId: number
  role: string
  decision: 'admit' | 'defer' | 'reject' | 'approve'
  reason: string
}

export interface ApprovalResult {
  decisionRecordId: number
  advanced: boolean
  newState: ValueStreamState | null
}

/**
 * States that require an explicit DECISION_RECORD before advancing.
 * PRIORITIZE needs a human admit decision; CONSOLIDATE needs a release sign-off.
 */
const GATE_STATES: ReadonlySet<ValueStreamState> = new Set<ValueStreamState>([
  'PRIORITIZE',
  'CONSOLIDATE',
])

export class HumanGateManager {
  constructor(private readonly db: Database.Database) {}

  /**
   * Returns features that are waiting for human attention:
   * - Features with a non-null blocked_on_json, OR
   * - Features in a gated state (PRIORITIZE / CONSOLIDATE) that have no
   *   DECISION_RECORD linked via HAS_DECISION.
   */
  listPending(): PendingGate[] {
    const rows = this.db
      .prepare<
        [],
        {
          feature_node_id: number
          feature_label: string
          stream_state: ValueStreamState
          blocked_on_json: string | null
        }
      >(
        `SELECT
           vss.feature_node_id,
           gn.label      AS feature_label,
           vss.stream_state,
           vss.blocked_on_json
         FROM value_stream_state vss
         JOIN graph_nodes gn ON gn.id = vss.feature_node_id
         WHERE vss.blocked_on_json IS NOT NULL
            OR (
               vss.stream_state IN ('PRIORITIZE', 'CONSOLIDATE')
               AND NOT EXISTS (
                 SELECT 1 FROM graph_edges ge
                 JOIN graph_nodes dr ON dr.id = ge.to_node_id
                 WHERE ge.from_node_id = vss.feature_node_id
                   AND ge.kind = 'HAS_DECISION'
                   AND dr.kind = 'DECISION_RECORD'
               )
            )`,
      )
      .all()

    return rows.map((r) => {
      let blockedReasons: string[] = []
      if (r.blocked_on_json) {
        try {
          const parsed = JSON.parse(r.blocked_on_json) as { reasons?: string[] }
          blockedReasons = parsed.reasons ?? []
        } catch {
          blockedReasons = [r.blocked_on_json]
        }
      }
      if (GATE_STATES.has(r.stream_state)) {
        blockedReasons = blockedReasons.length
          ? blockedReasons
          : [`Awaiting human gate in ${r.stream_state}`]
      }
      return {
        featureId: r.feature_node_id,
        featureLabel: r.feature_label,
        streamState: r.stream_state,
        blockedReasons,
      }
    })
  }

  /**
   * Record a human approval decision for a feature gate.
   * - Writes a DECISION_RECORD node.
   * - Updates artifact_provenance with the approver role.
   * - Clears blocked_on_json.
   * - Advances the stream state when decision is 'admit' or 'approve'.
   */
  approve(input: ApprovalInput): ApprovalResult {
    return this.db.transaction((): ApprovalResult => {
      const featureLabel =
        this.db
          .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
          .get(input.featureId)?.label ?? `Feature #${input.featureId}`

      const currentState = this.db
        .prepare<[number], { stream_state: ValueStreamState }>(
          'SELECT stream_state FROM value_stream_state WHERE feature_node_id = ?',
        )
        .get(input.featureId)?.stream_state

      const drId = upsertNode(this.db, {
        kind: 'DECISION_RECORD',
        label: `Gate ${input.decision.toUpperCase()} by ${input.role}: ${featureLabel.slice(0, 80)}`,
        description:
          `# Human Gate Decision Record\n\n` +
          `**Feature:** ${featureLabel} (id: ${input.featureId})\n` +
          `**Decision:** ${input.decision.toUpperCase()}\n` +
          `**Role:** ${input.role}\n` +
          `**Reason:** ${input.reason}\n` +
          `*Recorded at ${new Date().toISOString()}*`,
        source_type: 'human_gate',
      })

      // Upsert provenance for the decision record itself
      this.db
        .prepare(
          `INSERT OR REPLACE INTO artifact_provenance
           (artifact_node_id, agent_id, agent_version, derived_from_json,
            confidence, approved_by_role, approved_at)
           VALUES (?, 'human_gate', '1.0', ?, 1.0, ?, unixepoch() * 1000)`,
        )
        .run(drId, JSON.stringify([input.featureId]), input.role)

      insertEdge(this.db, input.featureId, drId, 'HAS_DECISION')

      // Clear the blocked state
      this.db
        .prepare(
          `UPDATE value_stream_state
           SET blocked_on_json = NULL,
               last_transition_record = ?
           WHERE feature_node_id = ?`,
        )
        .run(drId, input.featureId)

      // Advance if approved
      const shouldAdvance = input.decision === 'admit' || input.decision === 'approve'
      let advanced = false
      let newState: ValueStreamState | null = null

      if (shouldAdvance && currentState) {
        const next = NEXT_STATE[currentState]
        if (next) {
          ensureValueStreamState(this.db, input.featureId, next)
          this.db
            .prepare(
              `UPDATE value_stream_state
               SET last_transition_record = ?
               WHERE feature_node_id = ?`,
            )
            .run(drId, input.featureId)
          advanced = true
          newState = next
        }
      }

      return { decisionRecordId: drId, advanced, newState }
    })()
  }
}
