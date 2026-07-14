// packages/main/src/aep/upstream/agents/a4DevImpactAgent.ts
import type Database from 'better-sqlite3'
import { ArtifactWriter } from './artifactWriter'
import { FISEngine } from '../../../iss/fisEngine'
import type { DomainAwareFIS as IDomainAwareFIS } from '../../../domain/domainAwareFIS'

type FISLike = { score(q: string, max?: number): Promise<{ filePath: string; score: number; isGoverned?: boolean; contexts?: string[] }[]> }

async function tryLoadDomainFIS(db: Database.Database): Promise<FISLike | null> {
  try {
    const { DomainAwareFIS } = await import('../../../domain/domainAwareFIS')
    return new DomainAwareFIS(db) as unknown as FISLike
  } catch {
    return null
  }
}

export interface A4Result {
  assessmentId: number
  topFiles: string[]
  governedFiles: string[]
}

export class A4DevImpactAgent {
  private readonly writer: ArtifactWriter

  constructor(private readonly db: Database.Database) {
    this.writer = new ArtifactWriter(db)
  }

  async run(briefId: number, featureId: number): Promise<A4Result> {
    const brief = this.db
      .prepare<[number], { label: string; description: string | null }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?',
      )
      .get(briefId)
    if (!brief) throw new Error(`Brief node ${briefId} not found`)

    const query = `${brief.label} ${brief.description ?? ''}`.trim()
    const { topFiles, governedFiles, markdownText } = await this.scoreImpact(query)

    return this.db.transaction((): A4Result => {
      const artifact = this.writer.write({
        kind: 'DEV_IMPACT_ASSESSMENT',
        label: `DevImpact: ${brief.label.replace(/^Brief:\s*/i, '').slice(0, 150)}`,
        description: markdownText,
        agentId: 'a4_dev_impact',
        derivedFrom: [briefId],
        confidence: 0.7,
      })

      return { assessmentId: artifact.nodeId, topFiles, governedFiles }
    })()
  }

  private async scoreImpact(
    query: string,
  ): Promise<{ topFiles: string[]; governedFiles: string[]; markdownText: string }> {
    try {
      const domainFIS = await tryLoadDomainFIS(this.db)
      if (domainFIS) {
        const results = await domainFIS.score(query, 15)
        const topFiles = results.map((r) => r.filePath)
        const governedFiles = results.filter((r) => r.isGoverned).map((r) => r.filePath)
        return { topFiles, governedFiles, markdownText: this.formatMarkdown(results, true) }
      }

      // Fallback to plain FISEngine
      const fis = new FISEngine(this.db)
      const results = await fis.score(query, 'auto', 15)
      return {
        topFiles: results.map((r) => r.filePath),
        governedFiles: [],
        markdownText: this.formatMarkdown(results, false),
      }
    } catch {
      return {
        topFiles: [],
        governedFiles: [],
        markdownText: `# Dev Impact Assessment (stub)\n\n*Scoring failed — no indexed workspace.*`,
      }
    }
  }

  private formatMarkdown(
    results: { filePath: string; score: number; isGoverned?: boolean; contexts?: string[] }[],
    hasDomain: boolean,
  ): string {
    const lines: string[] = ['# Dev Impact Assessment', '']
    if (!results.length) {
      lines.push('*No impacted files found. Workspace may not be indexed.*')
      return lines.join('\n')
    }
    lines.push(`**Top ${results.length} impacted files:**`, '')
    for (const r of results) {
      const govFlag = r.isGoverned ? ' ⚠️ governed' : ''
      const ctx = r.contexts?.length ? ` [${r.contexts.join(', ')}]` : ''
      lines.push(`- \`${r.filePath}\` score=${r.score.toFixed(3)}${govFlag}${ctx}`)
    }
    if (!hasDomain) {
      lines.push('', '*Domain awareness unavailable — using base FIS scoring.*')
    }
    return lines.join('\n')
  }
}
