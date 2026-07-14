// packages/main/src/aep/governance/blackboard.ts
import type Database from 'better-sqlite3'
import type { ValueStreamState } from '@shared/index'

/** Ordered next-state map for the 9 value-stream states. LEARN is terminal. */
export const NEXT_STATE: Partial<Record<ValueStreamState, ValueStreamState>> = {
  INTAKE: 'QUALIFY',
  QUALIFY: 'PRIORITIZE',
  PRIORITIZE: 'DEFINE',
  DEFINE: 'BUILD',
  BUILD: 'CONSOLIDATE',
  CONSOLIDATE: 'RELEASE',
  RELEASE: 'OBSERVE',
  OBSERVE: 'LEARN',
}

type Predicate = {
  name: string
  check: (db: Database.Database, featureId: number) => boolean
}

/** Predicates keyed by the SOURCE state (the state a feature is currently IN). */
const PREDICATES: Partial<Record<ValueStreamState, Predicate[]>> = {
  INTAKE: [
    {
      name: 'HAS_BRIEF',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             JOIN graph_edges ge ON ge.from_node_id = gn.id
             WHERE gn.kind = 'BRIEF'
               AND ge.to_node_id = ?
               AND ge.kind = 'MOTIVATES'
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],

  QUALIFY: [
    {
      name: 'HAS_BUSINESS_IMPACT_ASSESSMENT',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             JOIN graph_edges ge ON ge.from_node_id = gn.id
             WHERE gn.kind = 'BUSINESS_IMPACT_ASSESSMENT'
               AND ge.to_node_id = ?
               AND ge.kind = 'MOTIVATES'
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
    {
      name: 'HAS_DEV_IMPACT_ASSESSMENT',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             JOIN graph_edges ge ON ge.from_node_id = gn.id
             WHERE gn.kind = 'DEV_IMPACT_ASSESSMENT'
               AND ge.to_node_id = ?
               AND ge.kind = 'MOTIVATES'
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],

  PRIORITIZE: [
    {
      name: 'HAS_DECISION_RECORD_ADMIT',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             JOIN graph_edges ge ON ge.to_node_id = gn.id
             WHERE ge.from_node_id = ?
               AND ge.kind = 'HAS_DECISION'
               AND gn.kind = 'DECISION_RECORD'
               AND (gn.label LIKE '%ADMIT%' OR gn.description LIKE '%admit%')
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],

  DEFINE: [
    {
      name: 'HAS_COMMITTED_VALUE_HYPOTHESIS',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT vh.hypothesis_node_id AS id
             FROM value_hypotheses vh
             JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id
             WHERE ge.from_node_id = ?
               AND ge.kind = 'HAS_HYPOTHESIS'
               AND vh.registered_at > 0
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],

  BUILD: [
    {
      name: 'HAS_PACKAGED_BUILD',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             WHERE gn.kind = 'BUILD'
               AND EXISTS (
                 SELECT 1 FROM graph_edges ge
                 WHERE ge.from_node_id = ? AND ge.to_node_id = gn.id
               )
               AND EXISTS (
                 SELECT 1 FROM graph_edges pe
                 WHERE pe.from_node_id = gn.id AND pe.kind = 'PACKAGED_IN'
               )
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],

  CONSOLIDATE: [
    {
      name: 'HAS_RELEASE_READINESS_REPORT',
      check(db, featureId) {
        return !!db
          .prepare<[number, number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             WHERE gn.kind = 'RELEASE_READINESS_REPORT'
               AND EXISTS (
                 SELECT 1 FROM graph_edges ge
                 WHERE (ge.from_node_id = ? AND ge.to_node_id = gn.id)
                    OR (ge.from_node_id = gn.id AND ge.to_node_id = ?)
               )
             LIMIT 1`,
          )
          .get(featureId, featureId)
      },
    },
  ],

  RELEASE: [
    {
      name: 'HAS_DEPLOYMENT',
      check(db, featureId) {
        return !!db
          .prepare<[number, number], { id: number }>(
            `SELECT gn.id FROM graph_nodes gn
             WHERE gn.kind = 'DEPLOYMENT'
               AND EXISTS (
                 SELECT 1 FROM graph_edges ge
                 WHERE (ge.from_node_id = ? AND ge.to_node_id = gn.id)
                    OR (ge.from_node_id = gn.id AND ge.to_node_id = ?)
               )
             LIMIT 1`,
          )
          .get(featureId, featureId)
      },
    },
  ],

  OBSERVE: [
    {
      name: 'HAS_HYPOTHESIS_VERDICT',
      check(db, featureId) {
        return !!db
          .prepare<[number], { id: number }>(
            `SELECT vh.hypothesis_node_id AS id
             FROM value_hypotheses vh
             JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id
             WHERE ge.from_node_id = ?
               AND ge.kind = 'HAS_HYPOTHESIS'
               AND vh.verdict_node_id IS NOT NULL
             LIMIT 1`,
          )
          .get(featureId)
      },
    },
  ],
}

export class PredicateEvaluationEngine {
  constructor(private readonly db: Database.Database) {}

  /**
   * Returns the names of predicates that are not yet satisfied for the
   * transition out of the feature's current state.
   * Returns [] when all predicates pass (feature can advance).
   * Returns [] for LEARN (terminal state — no transition to evaluate).
   */
  evaluateFeature(featureId: number): string[] {
    const row = this.db
      .prepare<[number], { stream_state: ValueStreamState }>(
        'SELECT stream_state FROM value_stream_state WHERE feature_node_id = ? LIMIT 1',
      )
      .get(featureId)

    if (!row) return [`FEATURE_NOT_IN_VALUE_STREAM`]

    const preds = PREDICATES[row.stream_state]
    if (!preds) return [] // terminal or no predicates for this state

    const unmet: string[] = []
    for (const pred of preds) {
      try {
        if (!pred.check(this.db, featureId)) {
          unmet.push(pred.name)
        }
      } catch {
        unmet.push(`${pred.name}_ERROR`)
      }
    }
    return unmet
  }

  /**
   * Returns true when the feature can advance to targetState.
   * Validates that targetState is the legitimate next state first.
   */
  canAdvance(featureId: number, targetState: ValueStreamState): boolean {
    const row = this.db
      .prepare<[number], { stream_state: ValueStreamState }>(
        'SELECT stream_state FROM value_stream_state WHERE feature_node_id = ? LIMIT 1',
      )
      .get(featureId)

    if (!row) return false
    if (NEXT_STATE[row.stream_state] !== targetState) return false

    return this.evaluateFeature(featureId).length === 0
  }
}
