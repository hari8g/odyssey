// packages/main/src/aep/upstream/passE/painPointClusterer.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { upsertNode, insertEdge } from '../../graphWrite'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

interface SignalRow {
  id: number
  label: string
  signal_type: string
}

interface ClusterResult {
  painPointId: number
  label: string
  signalIds: number[]
}

export interface ClusterRunResult {
  clusters: ClusterResult[]
  expressesEdges: number
}

export class PainPointClusterer {
  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {}

  async cluster(signalNodeIds: number[]): Promise<ClusterRunResult> {
    if (!signalNodeIds.length) return { clusters: [], expressesEdges: 0 }

    const signals = this.db
      .prepare<number[], SignalRow>(
        `SELECT gn.id, gn.label, cs.signal_type
         FROM graph_nodes gn
         JOIN customer_signals cs ON cs.signal_node_id = gn.id
         WHERE gn.id IN (${signalNodeIds.map(() => '?').join(',')})`,
      )
      .all(...signalNodeIds)

    if (!signals.length) return { clusters: [], expressesEdges: 0 }

    const grouped = this.llm
      ? await this.clusterWithLLM(signals)
      : this.clusterByType(signals)

    let expressesEdges = 0
    const clusters: ClusterResult[] = []

    const run = this.db.transaction(() => {
      for (const group of grouped) {
        const painPointId = upsertNode(this.db, {
          kind: 'PAIN_POINT',
          label: group.label,
          description: `Cluster of ${group.signalIds.length} signal(s)`,
          source_type: 'aep_cluster',
        })
        clusters.push({ painPointId, label: group.label, signalIds: group.signalIds })
        for (const sid of group.signalIds) {
          insertEdge(this.db, sid, painPointId, 'EXPRESSES', 1.0)
          expressesEdges++
        }
      }
    })
    run()

    return { clusters, expressesEdges }
  }

  private clusterByType(signals: SignalRow[]): { label: string; signalIds: number[] }[] {
    const byType = new Map<string, number[]>()
    for (const s of signals) {
      const bucket = s.signal_type ?? 'noise'
      const arr = byType.get(bucket) ?? []
      arr.push(s.id)
      byType.set(bucket, arr)
    }
    return [...byType.entries()].map(([type, ids]) => ({
      label: typeLabel(type),
      signalIds: ids,
    }))
  }

  private async clusterWithLLM(
    signals: SignalRow[],
  ): Promise<{ label: string; signalIds: number[] }[]> {
    const snippet = signals.slice(0, 40).map((s, i) => `${i}. ${s.label}`).join('\n')
    try {
      const resp = await this.llm!.complete({
        model: 'claude-haiku-4-5',
        system:
          'You are a product analyst. Group these user signals into pain points. ' +
          'Return ONLY valid JSON: [{"label":"<pain point>","indices":[0,1,...]}]',
        messages: [
          {
            role: 'user',
            content:
              `Group the following ${signals.length} signals into named pain points.\n\n` +
              `${snippet}\n\nReturn JSON only.`,
          },
        ],
        max_tokens: 1200,
      })
      const text = llmText(resp).replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(text) as { label: string; indices: number[] }[]
      const idMap = signals.map((s) => s.id)
      return parsed
        .filter((g) => g.label && Array.isArray(g.indices))
        .map((g) => ({
          label: g.label.slice(0, 200),
          signalIds: g.indices.map((i) => idMap[i]).filter((id): id is number => id !== undefined),
        }))
        .filter((g) => g.signalIds.length > 0)
    } catch {
      return this.clusterByType(signals)
    }
  }
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    feature_request: 'Feature gap',
    defect: 'Defect / reliability issue',
    usability: 'Usability friction',
    churn_risk: 'Churn risk signal',
    pricing: 'Pricing concern',
    noise: 'Unclassified signal',
  }
  return map[type] ?? `Signal cluster: ${type}`
}
