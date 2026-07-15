// packages/main/src/aep/downstream/passG/passGOrchestrator.ts
import type Database from 'better-sqlite3'
import type { AEPPassProgress } from '@shared/index'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { A12AttributionAgent } from '../agents/a12AttributionAgent'
import { A13CrossFunctionalAgent } from '../agents/a13CrossFunctionalAgent'
import { A14LearningAgent } from '../agents/a14LearningAgent'
import type { HypothesisVerdictSummary } from '../agents/a12AttributionAgent'
import type { OrgUnitImpact } from '../agents/a13CrossFunctionalAgent'

export interface PassGInput {
  deploymentId: number
  featureId: number
  /** Observation window label (e.g. 'post_deploy_7d'). Passed to A12. */
  observationWindow?: string
  /** If true, emit a 'learning_hook' stub notification at the end */
  triggerLearningHook?: boolean
}

export interface PassGResult {
  verdicts: HypothesisVerdictSummary[]
  orgUnitImpacts: OrgUnitImpact[]
  outcomeReportId: number
  learningHookTriggered: boolean
}

export class PassGOrchestrator {
  private readonly a12: A12AttributionAgent
  private readonly a13: A13CrossFunctionalAgent

  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {
    this.a12 = new A12AttributionAgent(db, llm)
    this.a13 = new A13CrossFunctionalAgent(db, llm)
  }

  async run(
    input: PassGInput,
    push: (p: AEPPassProgress) => void,
  ): Promise<PassGResult> {
    // ── G_attribute: A12 ──────────────────────────────────────────────────────
    push({
      pass: 'G_attribute',
      stage: 'attribution',
      pct: 0,
      detail: `Running A12 attribution for feature #${input.featureId}…`,
    })

    let verdicts: HypothesisVerdictSummary[] = []
    try {
      const a12Result = await this.a12.run({
        featureId: input.featureId,
        observationWindow: input.observationWindow,
      })
      verdicts = a12Result.verdicts
      push({
        pass: 'G_attribute',
        stage: 'attribution',
        pct: 100,
        detail: `${verdicts.length} hypothesis verdict(s): ` +
          `${verdicts.filter((v) => v.verdict === 'validated').length} validated, ` +
          `${verdicts.filter((v) => v.verdict === 'refuted').length} refuted, ` +
          `${verdicts.filter((v) => v.verdict === 'inconclusive').length} inconclusive`,
      })
    } catch (err) {
      push({ pass: 'G_attribute', stage: 'attribution', pct: 100, detail: `Error: ${String(err)}` })
    }

    // ── G_verdict: A13 ────────────────────────────────────────────────────────
    push({
      pass: 'G_verdict',
      stage: 'cross_functional',
      pct: 0,
      detail: 'Running A13 cross-functional assessment…',
    })

    let orgUnitImpacts: OrgUnitImpact[] = []
    let outcomeReportId = 0
    try {
      const a13Result = await this.a13.run({
        featureId: input.featureId,
        deploymentId: input.deploymentId,
      })
      orgUnitImpacts = a13Result.orgUnitImpacts
      outcomeReportId = a13Result.outcomeReportId
      push({
        pass: 'G_verdict',
        stage: 'cross_functional',
        pct: 100,
        detail: `${orgUnitImpacts.length} org unit impact(s), outcome report #${outcomeReportId}`,
      })
    } catch (err) {
      push({ pass: 'G_verdict', stage: 'cross_functional', pct: 100, detail: `Error: ${String(err)}` })
    }

    // ── G_learn: A14 Learning Agent ───────────────────────────────────────────
    let learningHookTriggered = false
    if (input.triggerLearningHook) {
      push({
        pass: 'G_learn',
        stage: 'learning_hook',
        pct: 0,
        detail: 'Distilling lessons…',
      })
      try {
        const validated = verdicts.filter((v) => v.verdict === 'validated').length
        const refuted = verdicts.filter((v) => v.verdict === 'refuted').length
        const a14 = new A14LearningAgent(this.db)
        const a14Result = a14.run({
          featureId: input.featureId,
          verdicts: verdicts.map((v) => ({
            hypothesisNodeId: v.hypothesisId,
            label: v.hypothesisLabel,
            outcome:
              v.verdict === 'validated'
                ? 'confirmed'
                : v.verdict === 'refuted'
                  ? 'refuted'
                  : 'inconclusive',
            actualDeltaPct: v.actualDeltaPct,
            priorConfidence: v.confidence,
          })),
          learningNotes:
            `Cycle complete. ${validated} bets validated, ${refuted} refuted.`,
        })
        learningHookTriggered = a14Result.learningNodeIds.length > 0
        push({
          pass: 'G_learn',
          stage: 'learning_hook',
          pct: 100,
          detail: `${a14Result.learningNodeIds.length} lesson(s) distilled`,
        })
      } catch (err) {
        push({ pass: 'G_learn', stage: 'learning_hook', pct: 100, detail: `Error: ${String(err)}` })
      }
    }

    return { verdicts, orgUnitImpacts, outcomeReportId, learningHookTriggered }
  }
}
