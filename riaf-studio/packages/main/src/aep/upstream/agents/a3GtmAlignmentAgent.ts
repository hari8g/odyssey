// packages/main/src/aep/upstream/agents/a3GtmAlignmentAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { insertEdge } from '../../graphWrite'
import { ArtifactWriter } from './artifactWriter'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export interface A3Result {
  gtmNotesId: number
  edgesWritten: number
}

export class A3GtmAlignmentAgent {
  private readonly writer: ArtifactWriter

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.writer = new ArtifactWriter(db)
  }

  async run(featureId: number, briefId: number): Promise<A3Result> {
    const feature = this.db
      .prepare<[number], { label: string; description: string | null }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?',
      )
      .get(featureId)
    if (!feature) throw new Error(`Feature node ${featureId} not found`)

    const notes = await this.generateNotes(feature.label, feature.description)

    return this.db.transaction((): A3Result => {
      const artifact = this.writer.write({
        kind: 'GTM_NOTES',
        label: `GTM: ${feature.label.slice(0, 150)}`,
        description: notes.markdownText,
        agentId: 'a3_gtm_alignment',
        derivedFrom: [briefId, featureId],
        confidence: notes.isStub ? 0.0 : 0.6,
      })

      let edgesWritten = 0

      // ADVANCES edges to matching BUSINESS_OBJECTIVE nodes
      const objectives = this.db
        .prepare<[], { id: number; label: string }>(
          `SELECT id, label FROM graph_nodes WHERE kind = 'BUSINESS_OBJECTIVE' LIMIT 10`,
        )
        .all()
      for (const obj of objectives) {
        if (notes.alignedObjectiveLabels.some((l) => obj.label.toLowerCase().includes(l.toLowerCase()))) {
          insertEdge(this.db, featureId, obj.id, 'ADVANCES', 0.7)
          edgesWritten++
        }
      }

      // TARGETS edges to ORG_UNIT segments (customer-facing)
      for (const segment of notes.targetSegments) {
        const segId = this.db
          .prepare<[string], { id: number }>(
            `SELECT id FROM graph_nodes WHERE kind = 'ORG_UNIT' AND label = ? LIMIT 1`,
          )
          .get(segment)?.id
        if (segId !== undefined) {
          insertEdge(this.db, featureId, segId, 'TARGETS', 0.7)
          edgesWritten++
        }
      }

      return { gtmNotesId: artifact.nodeId, edgesWritten }
    })()
  }

  private async generateNotes(
    featureLabel: string,
    featureDesc: string | null,
  ): Promise<{ markdownText: string; alignedObjectiveLabels: string[]; targetSegments: string[]; isStub: boolean }> {
    if (!this.llm) return this.stubNotes(featureLabel)
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system: 'You are a GTM strategist. Return ONLY valid JSON, no prose outside JSON.',
        messages: [
          {
            role: 'user',
            content:
              `Feature: "${featureLabel}"\n${featureDesc ?? ''}\n\n` +
              `Return JSON:\n` +
              `{"markdownText":"<GTM notes 100-200 words>",` +
              `"alignedObjectiveLabels":["<obj1>"],"targetSegments":["<seg1>"]}`,
          },
        ],
        max_tokens: 600,
      })
      const text = llmText(resp).replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text) as {
        markdownText: string
        alignedObjectiveLabels: string[]
        targetSegments: string[]
      }
      return { ...parsed, isStub: false }
    } catch {
      return this.stubNotes(featureLabel)
    }
  }

  private stubNotes(featureLabel: string): {
    markdownText: string
    alignedObjectiveLabels: string[]
    targetSegments: string[]
    isStub: boolean
  } {
    return {
      markdownText:
        `# GTM Notes (stub)\n\n` +
        `**Feature:** ${featureLabel}\n\n` +
        `*LLM unavailable — stub GTM notes generated.*`,
      alignedObjectiveLabels: [],
      targetSegments: [],
      isStub: true,
    }
  }
}
