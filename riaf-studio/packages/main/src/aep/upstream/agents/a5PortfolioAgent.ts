// packages/main/src/aep/upstream/agents/a5PortfolioAgent.ts
import type Database from 'better-sqlite3'
import type { PortfolioDecision } from '@shared/index'
import { ArtifactWriter } from './artifactWriter'

export interface DecisionPacket {
  featureId: number
  featureLabel: string
  briefId: number | null
  bizAssessmentId: number | null
  devAssessmentId: number | null
  gtmNotesId: number | null
  hypothesisIds: number[]
  topFiles: string[]
  kpiLabels: string[]
  painPointCount: number
  streamState: string
  suggestedDecision: 'admit' | 'defer' | 'reject'
  rationale: string
}

export interface A5Result {
  packetNodeId: number
  packet: DecisionPacket
}

export class A5PortfolioAgent {
  private readonly writer: ArtifactWriter

  constructor(private readonly db: Database.Database) {
    this.writer = new ArtifactWriter(db)
  }

  run(featureId: number): A5Result {
    const packet = this.assemblePacket(featureId)

    const artifact = this.writer.write({
      kind: 'PORTFOLIO_PACKET',
      label: `Portfolio Packet: ${packet.featureLabel.slice(0, 120)}`,
      description: JSON.stringify(packet, null, 2),
      agentId: 'a5_portfolio',
      derivedFrom: [
        featureId,
        packet.briefId,
        packet.bizAssessmentId,
        packet.devAssessmentId,
        packet.gtmNotesId,
      ].filter((id): id is number => id !== null),
      confidence: 0.8,
    })

    return { packetNodeId: artifact.nodeId, packet }
  }

  private assemblePacket(featureId: number): DecisionPacket {
    const feature = this.db
      .prepare<[number], { label: string }>(
        'SELECT label FROM graph_nodes WHERE id = ?',
      )
      .get(featureId)

    const featureLabel = feature?.label ?? `Feature #${featureId}`

    const artifactKinds = ['BRIEF', 'BUSINESS_IMPACT_ASSESSMENT', 'DEV_IMPACT_ASSESSMENT', 'GTM_NOTES'] as const
    const artifacts = this.db
      .prepare<[number, ...string[]], { id: number; kind: string }>(
        `SELECT gn.id, gn.kind FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id
         WHERE ge.to_node_id = ? AND gn.kind IN (${artifactKinds.map(() => '?').join(',')})`,
      )
      .all(featureId, ...artifactKinds)

    const artifactMap = new Map<string, number>()
    for (const a of artifacts) artifactMap.set(a.kind, a.id)

    const hypothesisIds = this.db
      .prepare<[number], { id: number }>(
        `SELECT gn.id FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id = ? AND ge.kind = 'HAS_HYPOTHESIS'`,
      )
      .all(featureId)
      .map((r) => r.id)

    const kpiLabels = this.db
      .prepare<number[], { label: string }>(
        hypothesisIds.length
          ? `SELECT DISTINCT gn.label FROM graph_edges ge
             JOIN graph_nodes gn ON gn.id = ge.to_node_id
             WHERE ge.from_node_id IN (${hypothesisIds.map(() => '?').join(',')}) AND ge.kind = 'PREDICTS'`
          : 'SELECT label FROM graph_nodes WHERE kind = \'KPI\' LIMIT 0',
      )
      .all(...hypothesisIds)
      .map((r) => r.label)

    const painPointCount = this.db
      .prepare<[number], { cnt: number }>(
        `SELECT COUNT(*) as cnt FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id
         WHERE ge.to_node_id = ? AND gn.kind = 'PAIN_POINT'`,
      )
      .get(featureId)?.cnt ?? 0

    const streamState = this.db
      .prepare<[number], { stream_state: string }>(
        'SELECT stream_state FROM value_stream_state WHERE feature_node_id = ?',
      )
      .get(featureId)?.stream_state ?? 'INTAKE'

    // Read top files from dev assessment description
    const devDesc = artifactMap.has('DEV_IMPACT_ASSESSMENT')
      ? (this.db
          .prepare<[number], { description: string | null }>(
            'SELECT description FROM graph_nodes WHERE id = ?',
          )
          .get(artifactMap.get('DEV_IMPACT_ASSESSMENT')!)?.description ?? '')
      : ''
    const topFiles = (devDesc.match(/`([^`]+\.[a-z]+)`/g) ?? [])
      .map((m) => m.replace(/`/g, ''))
      .slice(0, 10)

    const suggestedDecision = this.suggestDecision(painPointCount, hypothesisIds.length)
    const rationale = this.buildRationale(suggestedDecision, painPointCount, hypothesisIds.length, kpiLabels)

    return {
      featureId,
      featureLabel,
      briefId: artifactMap.get('BRIEF') ?? null,
      bizAssessmentId: artifactMap.get('BUSINESS_IMPACT_ASSESSMENT') ?? null,
      devAssessmentId: artifactMap.get('DEV_IMPACT_ASSESSMENT') ?? null,
      gtmNotesId: artifactMap.get('GTM_NOTES') ?? null,
      hypothesisIds,
      topFiles,
      kpiLabels,
      painPointCount,
      streamState,
      suggestedDecision,
      rationale,
    }
  }

  private suggestDecision(painPointCount: number, hypothesisCount: number): 'admit' | 'defer' | 'reject' {
    if (painPointCount === 0 && hypothesisCount === 0) return 'defer'
    if (painPointCount >= 1 && hypothesisCount >= 1) return 'admit'
    return 'defer'
  }

  private buildRationale(
    decision: string,
    painPointCount: number,
    hypothesisCount: number,
    kpiLabels: string[],
  ): string {
    switch (decision) {
      case 'admit':
        return (
          `Feature backed by ${painPointCount} pain point(s) and ${hypothesisCount} value hypothesis/hypotheses ` +
          `targeting: ${kpiLabels.join(', ') || 'unspecified KPIs'}.`
        )
      case 'defer':
        return `Insufficient evidence: ${painPointCount} pain point(s), ${hypothesisCount} hypothesis/hypotheses. Gather more signal before admitting.`
      default:
        return 'Feature rejected: no supporting evidence found.'
    }
  }

  /** Build a PortfolioDecision from the assembled packet (convenience for gate) */
  toPortfolioDecision(packet: DecisionPacket, overrideDecision?: PortfolioDecision['decision']): PortfolioDecision {
    return {
      featureId: packet.featureId,
      decision: overrideDecision ?? packet.suggestedDecision,
      reason: packet.rationale,
      briefId: packet.briefId ?? undefined,
      bizAssessmentId: packet.bizAssessmentId ?? undefined,
      devAssessmentId: packet.devAssessmentId ?? undefined,
    }
  }
}
