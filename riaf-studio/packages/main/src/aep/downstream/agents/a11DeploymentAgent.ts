// packages/main/src/aep/downstream/agents/a11DeploymentAgent.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../../llm/llmProvider.interface'
import { upsertNode, insertEdge } from '../../graphWrite'
import { DeploymentIngester } from '../passF/deploymentIngester'
import { KpiObservationIngester } from '../passF/kpiObservationIngester'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export interface DeploymentPlan {
  buildId: number
  environmentLabel: string
  deployedBy?: string
  version?: string
  /** KPI node ids to check post-deployment for breaches */
  kpiNodeIds?: number[]
  /** Breach threshold: if observed value deviates beyond this % from baseline, halt */
  breachThresholdPct?: number
}

export interface A11Result {
  deploymentId: number
  environmentId: number
  featuresAdvanced: number[]
  halted: boolean
  incidentId: number | null
  kpiBreaches: { kpiLabel: string; baseline: number; observed: number; deltaPct: number }[]
}

export class A11DeploymentAgent {
  private readonly deploymentIngester: DeploymentIngester
  private readonly kpiIngester: KpiObservationIngester

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.deploymentIngester = new DeploymentIngester(db)
    this.kpiIngester = new KpiObservationIngester(db)
  }

  async run(plan: DeploymentPlan): Promise<A11Result> {
    // Execute deployment
    const dep = this.deploymentIngester.ingest({
      buildId: plan.buildId,
      environmentLabel: plan.environmentLabel,
      deployedBy: plan.deployedBy,
      version: plan.version,
    })

    const kpiBreaches: A11Result['kpiBreaches'] = []
    let halted = false
    let incidentId: number | null = null

    // Check KPI observations for breaches
    if (plan.kpiNodeIds?.length) {
      const threshold = plan.breachThresholdPct ?? 10

      for (const kpiId of plan.kpiNodeIds) {
        const breach = this.checkKpiBreach(kpiId, threshold)
        if (breach) {
          kpiBreaches.push(breach)
        }
      }

      if (kpiBreaches.length > 0) {
        halted = true
        incidentId = await this.writeIncident(dep.deploymentId, kpiBreaches, plan)
      }
    }

    return {
      deploymentId: dep.deploymentId,
      environmentId: dep.environmentId,
      featuresAdvanced: dep.featuresAdvanced,
      halted,
      incidentId,
      kpiBreaches,
    }
  }

  private checkKpiBreach(
    kpiNodeId: number,
    thresholdPct: number,
  ): { kpiLabel: string; baseline: number; observed: number; deltaPct: number } | null {
    const kpiRow = this.db
      .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
      .get(kpiNodeId)
    const kpiLabel = kpiRow?.label ?? `KPI#${kpiNodeId}`

    const observations = this.kpiIngester.getRecent(kpiNodeId, 2)
    if (observations.length < 2) return null

    const latest = observations[0]!
    const baseline = observations[observations.length - 1]!

    if (baseline.value === 0) return null

    const deltaPct = ((latest.value - baseline.value) / Math.abs(baseline.value)) * 100
    const isWorsening = this.isWorseningDirection(kpiNodeId, deltaPct)

    if (isWorsening && Math.abs(deltaPct) > thresholdPct) {
      return { kpiLabel, baseline: baseline.value, observed: latest.value, deltaPct }
    }
    return null
  }

  /** Determine if a delta represents a worsening direction for this KPI.
   *  Looks up the hypothesis direction; if no hypothesis found, any negative delta is worsening. */
  private isWorseningDirection(kpiNodeId: number, deltaPct: number): boolean {
    const hyp = this.db
      .prepare<[number], { direction: string }>(
        `SELECT vh.direction FROM value_hypotheses vh WHERE vh.kpi_node_id = ? LIMIT 1`,
      )
      .get(kpiNodeId)

    if (!hyp) return deltaPct < 0
    // Worsening = moving opposite to the desired direction
    if (hyp.direction === 'increase') return deltaPct < 0
    if (hyp.direction === 'decrease') return deltaPct > 0
    // stabilize: any significant delta is worsening
    return Math.abs(deltaPct) > 5
  }

  private async writeIncident(
    deploymentId: number,
    breaches: A11Result['kpiBreaches'],
    plan: DeploymentPlan,
  ): Promise<number> {
    const breachSummary = breaches
      .map((b) => `${b.kpiLabel}: ${b.deltaPct.toFixed(1)}% vs baseline`)
      .join('; ')

    const incidentLabel = `[A11] KPI breach on deploy to ${plan.environmentLabel}: ${breachSummary.slice(0, 100)}`

    let detail = `Deployment halted due to KPI breach(es):\n${breaches
      .map((b) => `- ${b.kpiLabel}: baseline=${b.baseline}, observed=${b.observed}, delta=${b.deltaPct.toFixed(1)}%`)
      .join('\n')}`

    if (this.llm) {
      try {
        const resp = await this.llm.complete({
          model: 'claude-haiku-4-5',
          system: 'You are a site reliability engineer writing incident summaries. Be brief and actionable.',
          messages: [
            {
              role: 'user',
              content:
                `A deployment to ${plan.environmentLabel} was halted due to KPI breaches:\n${breachSummary}\n\n` +
                `Write a 100-word incident description with: cause, impact, and recommended immediate action.`,
            },
          ],
          max_tokens: 250,
        })
        detail = llmText(resp)
      } catch {
        // keep stub detail
      }
    }

    const incidentId = this.db.transaction((): number => {
      const iId = upsertNode(this.db, {
        kind: 'INCIDENT',
        label: incidentLabel,
        description: detail,
        source_type: 'aep_agent',
        source_ref: 'a11_deployment',
      })

      insertEdge(this.db, deploymentId, iId, 'CAUSED', 1.0, {
        breaches: breaches.map((b) => b.kpiLabel),
        halted: true,
      })

      return iId
    })()

    return incidentId
  }
}
