// packages/main/src/aep/upstream/agents/a1IntakeAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { upsertNode, insertEdge, ensureValueStreamState } from '../../graphWrite'
import { ArtifactWriter } from './artifactWriter'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export interface A1Input {
  painPointIds: number[]
}

export interface A1Result {
  briefId: number
  featureId: number
}

export class A1IntakeAgent {
  private readonly writer: ArtifactWriter

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.writer = new ArtifactWriter(db)
  }

  async run(input: A1Input): Promise<A1Result> {
    const painPointLabels = this.db
      .prepare<number[], { label: string }>(
        `SELECT label FROM graph_nodes
         WHERE id IN (${input.painPointIds.map(() => '?').join(',')})`,
      )
      .all(...input.painPointIds)
      .map((r) => r.label)

    const briefContent = await this.generateBrief(painPointLabels)

    const featureLabel = briefContent.featureLabel.slice(0, 200)

    return this.db.transaction((): A1Result => {
      // FEATURE node (stub)
      const featureId = upsertNode(this.db, {
        kind: 'FEATURE',
        label: featureLabel,
        description: briefContent.summary.slice(0, 500),
        source_type: 'aep_a1',
      })

      // BRIEF artifact
      const brief = this.writer.write({
        kind: 'BRIEF',
        label: `Brief: ${featureLabel}`,
        description: briefContent.fullText,
        agentId: 'a1_intake',
        derivedFrom: input.painPointIds,
        confidence: briefContent.isStub ? 0.0 : 0.75,
      })

      // MOTIVATES edges: BRIEF → FEATURE
      insertEdge(this.db, brief.nodeId, featureId, 'MOTIVATES')

      // PAIN_POINT → FEATURE MOTIVATES edges
      for (const ppId of input.painPointIds) {
        insertEdge(this.db, ppId, featureId, 'MOTIVATES', 0.8)
      }

      // Set initial value stream state
      ensureValueStreamState(this.db, featureId, 'INTAKE')

      return { briefId: brief.nodeId, featureId }
    })()
  }

  private async generateBrief(painPoints: string[]): Promise<{
    featureLabel: string
    summary: string
    fullText: string
    isStub: boolean
  }> {
    if (!this.llm || !painPoints.length) {
      return this.stubBrief(painPoints)
    }
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system:
          'You are a product manager writing intake briefs. ' +
          'Return ONLY valid JSON, no prose outside JSON.',
        messages: [
          {
            role: 'user',
            content:
              `Write a concise intake brief for a feature that addresses these pain points:\n` +
              `${painPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n` +
              `Return JSON: {"featureLabel":"<short name>","summary":"<one sentence>","fullText":"<markdown brief 200-400 words>"}`,
          },
        ],
        max_tokens: 800,
      })
      const text = llmText(resp).replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text) as { featureLabel: string; summary: string; fullText: string }
      return { ...parsed, isStub: false }
    } catch {
      return this.stubBrief(painPoints)
    }
  }

  private stubBrief(painPoints: string[]): {
    featureLabel: string
    summary: string
    fullText: string
    isStub: boolean
  } {
    const label = painPoints[0]
      ? `Feature for: ${painPoints[0].slice(0, 80)}`
      : 'Unspecified Feature'
    return {
      featureLabel: label,
      summary: `Addresses ${painPoints.length} pain point(s): ${painPoints.slice(0, 2).join('; ')}`,
      fullText:
        `# Intake Brief (stub)\n\n` +
        `**Pain points addressed:**\n${painPoints.map((p) => `- ${p}`).join('\n')}\n\n` +
        `*This brief was auto-generated as a stub because the LLM was unavailable.*`,
      isStub: true,
    }
  }
}
