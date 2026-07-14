// packages/main/src/aep/downstream/agents/a13CrossFunctionalAgent.ts
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

export interface A13Input {
  featureId: number
  deploymentId: number
}

export interface OrgUnitImpact {
  orgUnitId: number
  orgUnitLabel: string
  impactAssessmentId: number
  summary: string
}

export interface A13Result {
  outcomeReportId: number
  orgUnitImpacts: OrgUnitImpact[]
  isStub: boolean
}

export class A13CrossFunctionalAgent {
  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {}

  async run(input: A13Input): Promise<A13Result> {
    const orgUnits = this.loadOrgUnits(input.featureId)
    const featureLabel = this.getLabel(input.featureId) ?? `Feature#${input.featureId}`
    const verdicts = this.loadVerdicts(input.featureId)
    const kpiSummary = this.buildKpiSummary(input.featureId)

    const orgUnitImpacts: OrgUnitImpact[] = []

    for (const ou of orgUnits) {
      const summary = await this.generateImpactSummary(featureLabel, ou.label, kpiSummary, verdicts)

      const impactId = this.db.transaction((): number => {
        const id = upsertNode(this.db, {
          kind: 'IMPACT_ASSESSMENT',
          label: `Impact: ${ou.label} ← ${featureLabel.slice(0, 80)}`,
          description: summary,
          source_type: 'aep_agent',
          source_ref: 'a13_cross_functional',
        })
        insertEdge(this.db, id, input.featureId, 'ASSESSED_FOR', 1.0, {
          orgUnit: ou.label,
          deploymentId: input.deploymentId,
        })
        insertEdge(this.db, id, ou.id, 'ASSESSED_FOR', 1.0)
        return id
      })()

      orgUnitImpacts.push({
        orgUnitId: ou.id,
        orgUnitLabel: ou.label,
        impactAssessmentId: impactId,
        summary,
      })
    }

    // Aggregate OUTCOME_REPORT
    const outcomeText = await this.generateOutcomeReport(featureLabel, orgUnitImpacts, kpiSummary, verdicts)
    const outcomeReportId = this.db.transaction((): number => {
      const id = upsertNode(this.db, {
        kind: 'OUTCOME_REPORT',
        label: `Outcome Report: ${featureLabel.slice(0, 130)}`,
        description: outcomeText.slice(0, 2000),
        source_type: 'aep_agent',
        source_ref: 'a13_cross_functional',
      })

      this.db
        .prepare(
          `INSERT OR REPLACE INTO artifact_provenance
           (artifact_node_id, agent_id, agent_version, derived_from_json, confidence, approved_by_role, approved_at)
           VALUES (?, 'a13_cross_functional', '1.0', ?, 0.75, NULL, NULL)`,
        )
        .run(
          id,
          JSON.stringify([input.featureId, input.deploymentId, ...orgUnitImpacts.map((o) => o.impactAssessmentId)]),
        )

      insertEdge(this.db, id, input.featureId, 'ASSESSED_FOR', 1.0)
      insertEdge(this.db, id, input.deploymentId, 'EVIDENCED_BY', 1.0)

      for (const imp of orgUnitImpacts) {
        insertEdge(this.db, imp.impactAssessmentId, id, 'INFORMS', 1.0)
      }

      return id
    })()

    return {
      outcomeReportId,
      orgUnitImpacts,
      isStub: outcomeText.startsWith('[stub]'),
    }
  }

  private loadOrgUnits(featureId: number): { id: number; label: string }[] {
    // ORG_UNITs directly linked, or via KPI concern overlap
    const direct = this.db
      .prepare<[number], { id: number; label: string }>(
        `SELECT DISTINCT gn.id, gn.label
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id AND gn.kind = 'ORG_UNIT'
         WHERE ge.to_node_id = ? AND ge.kind = 'ASSESSED_FOR'
         UNION
         SELECT DISTINCT gn.id, gn.label
         FROM graph_nodes gn
         WHERE gn.kind = 'ORG_UNIT'
         LIMIT 10`,
      )
      .all(featureId)

    // If no org units found, return a default placeholder
    if (!direct.length) {
      const defaultId = upsertNode(this.db, {
        kind: 'ORG_UNIT',
        label: 'Product',
        source_type: 'aep_default',
      })
      return [{ id: defaultId, label: 'Product' }]
    }
    return direct
  }

  private loadVerdicts(featureId: number): { label: string; kind: string }[] {
    return this.db
      .prepare<[number], { label: string; kind: string }>(
        `SELECT DISTINCT vn.label, vn.kind
         FROM graph_edges ge_hyp
         JOIN graph_nodes hn ON hn.id = ge_hyp.to_node_id AND hn.kind = 'VALUE_HYPOTHESIS'
         JOIN graph_edges ge_v ON ge_v.to_node_id = hn.id AND ge_v.kind IN ('VALIDATES_HYPOTHESIS','REFUTES_HYPOTHESIS')
         JOIN graph_nodes vn ON vn.id = ge_v.from_node_id AND vn.kind = 'HYPOTHESIS_VERDICT'
         WHERE ge_hyp.from_node_id = ? AND ge_hyp.kind = 'HAS_HYPOTHESIS'`,
      )
      .all(featureId)
  }

  private buildKpiSummary(featureId: number): string {
    const kpis = this.db
      .prepare<[number], { kpiLabel: string; actualDeltaPct: number | null; direction: string }>(
        `SELECT kn.label AS kpiLabel, vh.actual_delta_pct AS actualDeltaPct, vh.direction
         FROM value_hypotheses vh
         JOIN graph_nodes kn ON kn.id = vh.kpi_node_id
         JOIN graph_edges ge ON ge.to_node_id = vh.hypothesis_node_id AND ge.kind = 'HAS_HYPOTHESIS'
         WHERE ge.from_node_id = ?`,
      )
      .all(featureId)

    if (!kpis.length) return 'No KPI data available.'
    return kpis
      .map((k) =>
        `${k.kpiLabel}: expected ${k.direction}` +
        (k.actualDeltaPct !== null ? `, actual ${k.actualDeltaPct.toFixed(1)}%` : ', no data'),
      )
      .join('; ')
  }

  private getLabel(nodeId: number): string | null {
    return this.db
      .prepare<[number], { label: string }>('SELECT label FROM graph_nodes WHERE id = ?')
      .get(nodeId)?.label ?? null
  }

  private async generateImpactSummary(
    featureLabel: string,
    orgUnit: string,
    kpiSummary: string,
    verdicts: { label: string; kind: string }[],
  ): Promise<string> {
    if (!this.llm) return this.stubImpactSummary(featureLabel, orgUnit)
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system: 'You are a cross-functional impact analyst. Be concise (80 words max per org unit).',
        messages: [
          {
            role: 'user',
            content:
              `Feature: "${featureLabel}"\nOrg unit: ${orgUnit}\nKPI outcomes: ${kpiSummary}\n` +
              `Hypothesis verdicts: ${verdicts.map((v) => v.label).join('; ') || 'none'}\n\n` +
              `Write a brief (60-80 word) impact assessment for the ${orgUnit} org unit.`,
          },
        ],
        max_tokens: 200,
      })
      return llmText(resp)
    } catch {
      return this.stubImpactSummary(featureLabel, orgUnit)
    }
  }

  private stubImpactSummary(featureLabel: string, orgUnit: string): string {
    return (
      `[stub] Impact assessment for ${orgUnit}: Feature "${featureLabel}" was deployed. ` +
      `Cross-functional impact analysis pending LLM availability.`
    )
  }

  private async generateOutcomeReport(
    featureLabel: string,
    impacts: OrgUnitImpact[],
    kpiSummary: string,
    verdicts: { label: string; kind: string }[],
  ): Promise<string> {
    if (!this.llm) return this.stubOutcomeReport(featureLabel, impacts)
    try {
      const resp = await this.llm.complete({
        model: 'claude-haiku-4-5',
        system: 'You are a product manager writing outcome reports. Return concise markdown.',
        messages: [
          {
            role: 'user',
            content:
              `Feature: "${featureLabel}"\n\n` +
              `KPI Outcomes: ${kpiSummary}\n\n` +
              `Hypothesis Verdicts: ${verdicts.map((v) => `${v.label} (${v.kind})`).join('; ') || 'none'}\n\n` +
              `Org Unit Impacts:\n${impacts.map((i) => `- ${i.orgUnitLabel}: ${i.summary.slice(0, 80)}`).join('\n')}\n\n` +
              `Write a 200-300 word Outcome Report with sections: ` +
              `## Summary, ## KPI Outcomes, ## Hypothesis Verdicts, ## Org Unit Impacts, ## Learnings`,
          },
        ],
        max_tokens: 600,
      })
      return llmText(resp)
    } catch {
      return this.stubOutcomeReport(featureLabel, impacts)
    }
  }

  private stubOutcomeReport(featureLabel: string, impacts: OrgUnitImpact[]): string {
    return (
      `[stub] # Outcome Report: ${featureLabel}\n\n` +
      `## Summary\nOutcome report auto-generated as stub — LLM unavailable.\n\n` +
      `## Org Unit Impacts\n${impacts.map((i) => `- **${i.orgUnitLabel}**: ${i.summary}`).join('\n')}`
    )
  }
}
