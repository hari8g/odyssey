// packages/main/src/aep/downstream/agents/a14LearningAgent.ts
import type Database from 'better-sqlite3'
import { upsertNode, insertEdge } from '../../graphWrite'
import { recordCycle } from '../../governance/calibrationMonitor'

export interface VerdictSummary {
  hypothesisNodeId: number
  label: string
  /** 'confirmed' | 'refuted' | 'inconclusive' */
  outcome: string
  actualDeltaPct?: number | null
  priorConfidence?: number | null
}

export interface OutcomeReport {
  featureId: number
  featureLabel?: string
  verdicts: VerdictSummary[]
  /** Free-form learning text to capture */
  learningNotes?: string
}

export interface A14Result {
  learningNodeIds: number[]
  edgesCreated: number
}

/**
 * A14 Learning Agent — converts hypothesis verdicts and outcome reports into
 * durable LEARNING nodes, then wires INFORMS edges back to the originating
 * PAIN_POINT and BUSINESS_OBJECTIVE nodes so the golden thread stays live.
 *
 * Also records a calibration cycle for A2 (business impact) based on how
 * well the predicted hypotheses matched the observed outcomes.
 */
export class A14LearningAgent {
  constructor(private readonly db: Database.Database) {}

  run(report: OutcomeReport): A14Result {
    return this.db.transaction((): A14Result => {
      const learningNodeIds: number[] = []
      let edgesCreated = 0

      const { featureId, verdicts, learningNotes } = report

      const featureLabel =
        report.featureLabel ??
        this.db
          .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
          .get(featureId)?.label ??
        `Feature #${featureId}`

      // ── 1. Write a top-level LEARNING node for this feature ───────────────
      const topLearningId = upsertNode(this.db, {
        kind: 'LEARNING',
        label: `Learning: ${featureLabel.slice(0, 120)}`,
        description:
          learningNotes ??
          `Automated learning record after ${verdicts.length} hypothesis verdict(s).`,
        source_type: 'aep_a14',
      })

      this.db
        .prepare(
          `INSERT OR REPLACE INTO artifact_provenance
           (artifact_node_id, agent_id, agent_version, derived_from_json, confidence)
           VALUES (?, 'a14_learning', '1.0', ?, 0.9)`,
        )
        .run(topLearningId, JSON.stringify([featureId]))

      insertEdge(this.db, featureId, topLearningId, 'HAS_LEARNING')
      learningNodeIds.push(topLearningId)
      edgesCreated++

      // ── 2. Per-verdict LEARNING nodes ─────────────────────────────────────
      for (const verdict of verdicts) {
        const verdictLabel = `Learning (${verdict.outcome}): ${verdict.label.slice(0, 100)}`
        const verdictLearningId = upsertNode(this.db, {
          kind: 'LEARNING',
          label: verdictLabel,
          description:
            `Hypothesis verdict: ${verdict.outcome}` +
            (verdict.actualDeltaPct != null
              ? ` | actual Δ ${verdict.actualDeltaPct.toFixed(1)}%`
              : ''),
          source_type: 'aep_a14',
        })

        this.db
          .prepare(
            `INSERT OR REPLACE INTO artifact_provenance
             (artifact_node_id, agent_id, agent_version, derived_from_json, confidence)
             VALUES (?, 'a14_learning', '1.0', ?, 0.85)`,
          )
          .run(verdictLearningId, JSON.stringify([featureId, verdict.hypothesisNodeId]))

        insertEdge(this.db, topLearningId, verdictLearningId, 'INFORMS')
        learningNodeIds.push(verdictLearningId)
        edgesCreated++

        // Wire INFORMS back to hypothesis
        insertEdge(this.db, verdictLearningId, verdict.hypothesisNodeId, 'INFORMS')
        edgesCreated++
      }

      // ── 3. INFORMS edges to PAIN_POINT nodes upstream of the feature ──────
      const painPoints = this.db
        .prepare<[number], { id: number }>(
          `SELECT ge.from_node_id AS id FROM graph_edges ge
           JOIN graph_nodes gn ON gn.id = ge.from_node_id
           WHERE ge.to_node_id = ?
             AND gn.kind = 'PAIN_POINT'`,
        )
        .all(featureId)

      for (const { id: ppId } of painPoints) {
        insertEdge(this.db, topLearningId, ppId, 'INFORMS')
        edgesCreated++
      }

      // ── 4. INFORMS edges to BUSINESS_OBJECTIVE nodes ──────────────────────
      const bizObjs = this.db
        .prepare<[number], { id: number }>(
          `SELECT DISTINCT ge2.to_node_id AS id
           FROM graph_edges ge1
           JOIN graph_edges ge2 ON ge2.from_node_id = ge1.to_node_id
           JOIN graph_nodes gn ON gn.id = ge2.to_node_id
           WHERE ge1.from_node_id = ?
             AND ge1.kind = 'HAS_HYPOTHESIS'
             AND gn.kind = 'BUSINESS_OBJECTIVE'`,
        )
        .all(featureId)

      // Also look for ADVANCES edges from the feature to BUSINESS_OBJECTIVE
      const directBizObjs = this.db
        .prepare<[number], { id: number }>(
          `SELECT ge.to_node_id AS id
           FROM graph_edges ge
           JOIN graph_nodes gn ON gn.id = ge.to_node_id
           WHERE ge.from_node_id = ?
             AND ge.kind = 'ADVANCES'
             AND gn.kind = 'BUSINESS_OBJECTIVE'`,
        )
        .all(featureId)

      const allBizObjIds = [...new Set([...bizObjs, ...directBizObjs].map((r) => r.id))]
      for (const bizObjId of allBizObjIds) {
        insertEdge(this.db, topLearningId, bizObjId, 'INFORMS')
        edgesCreated++
      }

      // ── 5. Calibration cycle for A2 ───────────────────────────────────────
      if (verdicts.length > 0) {
        const confirmedCount = verdicts.filter(
          (v) => v.outcome === 'confirmed',
        ).length

        const errorPcts = verdicts
          .filter((v) => v.actualDeltaPct != null && v.priorConfidence != null)
          .map((v) => {
            const predicted = (v.priorConfidence ?? 0) * 100
            const actual = v.actualDeltaPct ?? 0
            return Math.abs(predicted - actual)
          })

        const meanErrorPct =
          errorPcts.length > 0
            ? errorPcts.reduce((s, v) => s + v, 0) / errorPcts.length
            : null

        recordCycle(this.db, {
          agentId: 'a2_business_impact',
          predictions: verdicts.length,
          verified: confirmedCount,
          meanErrorPct,
          notes: { featureId, source: 'a14_learning' },
        })
      }

      return { learningNodeIds, edgesCreated }
    })()
  }
}
