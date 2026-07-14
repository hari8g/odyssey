// packages/main/src/aep/upstream/agents/a2BusinessImpactAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { upsertNode, insertEdge } from '../../graphWrite'
import { ArtifactWriter } from './artifactWriter'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

type Direction = 'increase' | 'decrease' | 'stabilize'
type AttributionMethod = 'ab_flag' | 'canary' | 'before_after' | 'holdout'

interface HypothesisDraft {
  kpiLabel: string
  direction: Direction
  magnitudePct: number
  timeframeDays: number
  priorConfidence: number
  attributionMethod: AttributionMethod
}

export interface A2Result {
  assessmentId: number
  hypothesisIds: number[]
}

export class A2BusinessImpactAgent {
  private readonly writer: ArtifactWriter

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.writer = new ArtifactWriter(db)
  }

  async run(briefId: number, featureId: number): Promise<A2Result> {
    const brief = this.db
      .prepare<[number], { label: string; description: string | null }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?',
      )
      .get(briefId)
    if (!brief) throw new Error(`Brief node ${briefId} not found`)

    const kpis = this.getAvailableKPIs()
    const assessment = await this.generateAssessment(brief.label, brief.description, kpis)

    return this.db.transaction((): A2Result => {
      const artifact = this.writer.write({
        kind: 'BUSINESS_IMPACT_ASSESSMENT',
        label: `BIA: ${brief.label.replace(/^Brief:\s*/i, '').slice(0, 150)}`,
        description: assessment.markdownText,
        agentId: 'a2_business_impact',
        derivedFrom: [briefId],
        confidence: assessment.isStub ? 0.0 : 0.65,
      })

      // MOTIVATES edge from assessment to feature
      insertEdge(this.db, artifact.nodeId, featureId, 'MOTIVATES', 0.9)

      const hypothesisIds: number[] = []

      for (const h of assessment.hypotheses) {
        const kpiId = upsertNode(this.db, {
          kind: 'KPI',
          label: h.kpiLabel,
          source_type: 'aep_a2',
        })

        const hypothesisLabel = `H: ${h.direction} ${h.kpiLabel} by ${h.magnitudePct}%`
        const hypothesisId = upsertNode(this.db, {
          kind: 'VALUE_HYPOTHESIS',
          label: hypothesisLabel,
          description:
            `${h.direction} ${h.kpiLabel} by ~${h.magnitudePct}% ` +
            `within ${h.timeframeDays}d (confidence ${h.priorConfidence})`,
          source_type: 'aep_a2',
          source_ref: String(featureId),
        })

        // Draft row in value_hypotheses — registered_at = 0 sentinel (uncommitted)
        this.db
          .prepare(
            `INSERT OR IGNORE INTO value_hypotheses
             (hypothesis_node_id, kpi_node_id, direction, magnitude_pct,
              timeframe_days, prior_confidence, attribution_method, registered_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          )
          .run(
            hypothesisId,
            kpiId,
            h.direction,
            h.magnitudePct,
            h.timeframeDays,
            h.priorConfidence,
            h.attributionMethod,
          )

        insertEdge(this.db, hypothesisId, kpiId, 'PREDICTS', h.priorConfidence)
        insertEdge(this.db, featureId, hypothesisId, 'HAS_HYPOTHESIS')
        hypothesisIds.push(hypothesisId)
      }

      return { assessmentId: artifact.nodeId, hypothesisIds }
    })()
  }

  private getAvailableKPIs(): string[] {
    return this.db
      .prepare<[], { label: string }>(`SELECT label FROM graph_nodes WHERE kind = 'KPI' LIMIT 20`)
      .all()
      .map((r) => r.label)
  }

  private async generateAssessment(
    briefLabel: string,
    briefDesc: string | null,
    kpis: string[],
  ): Promise<{ markdownText: string; hypotheses: HypothesisDraft[]; isStub: boolean }> {
    if (!this.llm) return this.stubAssessment(briefLabel, kpis)
    try {
      const kpiContext = kpis.length
        ? `Available KPIs: ${kpis.join(', ')}`
        : 'No KPIs defined yet — propose generic ones.'
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system:
          'You are a business analyst writing impact assessments. ' +
          'Return ONLY valid JSON, no prose outside the JSON.',
        messages: [
          {
            role: 'user',
            content:
              `Feature brief: "${briefLabel}"\n${briefDesc ?? ''}\n\n${kpiContext}\n\n` +
              `Return JSON:\n` +
              `{"markdownText":"<200-400 word assessment>","hypotheses":[` +
              `{"kpiLabel":"...","direction":"increase|decrease|stabilize",` +
              `"magnitudePct":10,"timeframeDays":90,"priorConfidence":0.6,` +
              `"attributionMethod":"ab_flag|canary|before_after|holdout"}]}`,
          },
        ],
        max_tokens: 1000,
      })
      const text = llmText(resp).replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text) as {
        markdownText: string
        hypotheses: HypothesisDraft[]
      }
      return { ...parsed, isStub: false }
    } catch {
      return this.stubAssessment(briefLabel, kpis)
    }
  }

  private stubAssessment(
    briefLabel: string,
    kpis: string[],
  ): { markdownText: string; hypotheses: HypothesisDraft[]; isStub: boolean } {
    const kpiLabel = kpis[0] ?? 'engagement_rate'
    return {
      markdownText:
        `# Business Impact Assessment (stub)\n\n` +
        `**Feature:** ${briefLabel}\n\n` +
        `*LLM was unavailable — stub assessment generated.*\n\n` +
        `Expected to positively impact ${kpiLabel}.`,
      hypotheses: [
        {
          kpiLabel,
          direction: 'increase',
          magnitudePct: 5,
          timeframeDays: 90,
          priorConfidence: 0.5,
          attributionMethod: 'before_after',
        },
      ],
      isStub: true,
    }
  }
}
