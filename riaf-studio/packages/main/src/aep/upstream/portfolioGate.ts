// packages/main/src/aep/upstream/portfolioGate.ts
import type Database from 'better-sqlite3'
import type { PortfolioDecision, ValueStreamState } from '@shared/index'
import { upsertNode, insertEdge, ensureValueStreamState } from '../graphWrite'
import { ArtifactWriter } from './agents/artifactWriter'
import { HypothesisRegistry } from './hypothesisRegistry'

export interface GateResult {
  decision: PortfolioDecision['decision']
  decisionRecordId: number
  hypothesesCommitted: number
  newState: ValueStreamState
}

/**
 * Execute the portfolio gate for a feature.
 * - admit  → stream_state DEFINE, DECISION_RECORD node, commit hypotheses
 * - defer  → stream_state QUALIFY
 * - reject → stream_state QUALIFY (blocked)
 */
export function executePortfolioGate(
  db: Database.Database,
  decision: PortfolioDecision,
): GateResult {
  const writer = new ArtifactWriter(db)
  const registry = new HypothesisRegistry(db)

  return db.transaction((): GateResult => {
    const featureLabel = db
      .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
      .get(decision.featureId)?.label ?? `Feature #${decision.featureId}`

    // DECISION_RECORD artifact
    const decisionText = buildDecisionText(featureLabel, decision)
    const artifact = writer.write({
      kind: 'DECISION_RECORD',
      label: `Decision: ${decision.decision.toUpperCase()} — ${featureLabel.slice(0, 100)}`,
      description: decisionText,
      agentId: 'portfolio_gate',
      derivedFrom: [
        decision.featureId,
        decision.briefId,
        decision.bizAssessmentId,
        decision.devAssessmentId,
      ].filter((id): id is number => id !== undefined),
      confidence: 1.0,
      approvedByRole: decision.approvedByRole ?? null,
    })

    // Edge: FEATURE → DECISION_RECORD
    insertEdge(db, decision.featureId, artifact.nodeId, 'HAS_DECISION')

    let hypothesesCommitted = 0
    let newState: ValueStreamState

    if (decision.decision === 'admit') {
      newState = 'DEFINE'
      hypothesesCommitted = registry.commitForFeature(decision.featureId)
      ensureValueStreamState(db, decision.featureId, 'DEFINE')

      // Link decision record to the stream state transition
      db.prepare(
        `UPDATE value_stream_state
         SET last_transition_record = ?
         WHERE feature_node_id = ?`,
      ).run(artifact.nodeId, decision.featureId)

    } else if (decision.decision === 'reject') {
      newState = 'QUALIFY'
      db.prepare(
        `UPDATE value_stream_state
         SET stream_state = 'QUALIFY',
             entered_state_at = unixepoch() * 1000,
             blocked_on_json = ?,
             last_transition_record = ?
         WHERE feature_node_id = ?`,
      ).run(
        JSON.stringify({ reason: decision.reason, decision: 'reject' }),
        artifact.nodeId,
        decision.featureId,
      )

    } else {
      // defer
      newState = 'QUALIFY'
      db.prepare(
        `UPDATE value_stream_state
         SET stream_state = 'QUALIFY',
             entered_state_at = unixepoch() * 1000,
             blocked_on_json = ?,
             last_transition_record = ?
         WHERE feature_node_id = ?`,
      ).run(
        JSON.stringify({ reason: decision.reason, decision: 'defer' }),
        artifact.nodeId,
        decision.featureId,
      )
    }

    return {
      decision: decision.decision,
      decisionRecordId: artifact.nodeId,
      hypothesesCommitted,
      newState,
    }
  })()
}

function buildDecisionText(featureLabel: string, decision: PortfolioDecision): string {
  const lines = [
    `# Portfolio Decision Record`,
    ``,
    `**Feature:** ${featureLabel} (id: ${decision.featureId})`,
    `**Decision:** ${decision.decision.toUpperCase()}`,
    `**Reason:** ${decision.reason}`,
  ]
  if (decision.approvedByRole) lines.push(`**Approved by:** ${decision.approvedByRole}`)
  if (decision.briefId) lines.push(`**Brief:** node #${decision.briefId}`)
  if (decision.bizAssessmentId) lines.push(`**BIA:** node #${decision.bizAssessmentId}`)
  if (decision.devAssessmentId) lines.push(`**DevImpact:** node #${decision.devAssessmentId}`)
  lines.push(``, `*Recorded at ${new Date().toISOString()}*`)
  return lines.join('\n')
}
