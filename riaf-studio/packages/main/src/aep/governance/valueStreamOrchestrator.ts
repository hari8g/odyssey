// packages/main/src/aep/governance/valueStreamOrchestrator.ts
import type Database from 'better-sqlite3'
import type { ValueStreamState } from '@shared/index'
import { PredicateEvaluationEngine, NEXT_STATE } from './blackboard'
import { upsertNode, insertEdge, ensureValueStreamState } from '../graphWrite'

export interface TickResult {
  advanced: number
  blocked: { featureId: number; reasons: string[] }[]
}

export interface ForceAdvanceResult {
  decisionRecordId: number
  previousState: ValueStreamState
  newState: ValueStreamState
}

export class ValueStreamOrchestrator {
  private readonly engine: PredicateEvaluationEngine

  constructor(private readonly db: Database.Database) {
    this.engine = new PredicateEvaluationEngine(db)
  }

  /**
   * Evaluate every feature in the value stream.
   * - Features whose predicates all pass → advance to next state + write auto DECISION_RECORD.
   * - Features with unmet predicates → update blocked_on_json; no state change.
   * Returns counts and blocked details for the caller to relay over IPC.
   */
  tick(): TickResult {
    const features = this.db
      .prepare<[], { feature_node_id: number; stream_state: ValueStreamState }>(
        'SELECT feature_node_id, stream_state FROM value_stream_state',
      )
      .all()

    let advanced = 0
    const blocked: { featureId: number; reasons: string[] }[] = []

    for (const { feature_node_id, stream_state } of features) {
      const next = NEXT_STATE[stream_state]
      if (!next) continue // LEARN is terminal

      const unmet = this.engine.evaluateFeature(feature_node_id)

      if (unmet.length === 0) {
        this.advanceInternal(feature_node_id, next, 'auto-tick')
        advanced++
      } else {
        this.db
          .prepare(
            `UPDATE value_stream_state
             SET blocked_on_json = ?
             WHERE feature_node_id = ?`,
          )
          .run(JSON.stringify({ reasons: unmet, checkedAt: Date.now() }), feature_node_id)
        blocked.push({ featureId: feature_node_id, reasons: unmet })
      }
    }

    return { advanced, blocked }
  }

  /**
   * Bypass predicate checks and move a feature to an arbitrary target state.
   * Records a DECISION_RECORD explaining the override.
   */
  forceAdvance(
    featureId: number,
    targetState: ValueStreamState,
    reason: string,
  ): ForceAdvanceResult {
    const row = this.db
      .prepare<[number], { stream_state: ValueStreamState }>(
        'SELECT stream_state FROM value_stream_state WHERE feature_node_id = ?',
      )
      .get(featureId)

    const previousState: ValueStreamState = row?.stream_state ?? 'INTAKE'
    const decisionRecordId = this.advanceInternal(featureId, targetState, reason)
    return { decisionRecordId, previousState, newState: targetState }
  }

  private advanceInternal(
    featureId: number,
    targetState: ValueStreamState,
    reason: string,
  ): number {
    return this.db.transaction((): number => {
      const featureLabel =
        this.db
          .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
          .get(featureId)?.label ?? `Feature #${featureId}`

      const drId = upsertNode(this.db, {
        kind: 'DECISION_RECORD',
        label: `Auto-transition → ${targetState}: ${featureLabel.slice(0, 80)}`,
        description:
          `# Auto-transition Decision Record\n\n` +
          `**Target state:** ${targetState}\n` +
          `**Reason:** ${reason}\n` +
          `*Recorded at ${new Date().toISOString()}*`,
        source_type: 'aep_orchestrator',
      })

      insertEdge(this.db, featureId, drId, 'HAS_DECISION')
      ensureValueStreamState(this.db, featureId, targetState)

      this.db
        .prepare(
          `UPDATE value_stream_state
           SET last_transition_record = ?
           WHERE feature_node_id = ?`,
        )
        .run(drId, featureId)

      return drId
    })()
  }
}
