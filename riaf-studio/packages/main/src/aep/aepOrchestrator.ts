// packages/main/src/aep/aepOrchestrator.ts
import type Database from 'better-sqlite3'
import { seed as seedCapabilities } from './governance/agentCapabilityMatrix'
import { ValueStreamOrchestrator } from './governance/valueStreamOrchestrator'
import { HumanGateManager } from './governance/humanGateManager'
import { getApprovalSet } from './governance/raciGraph'
import { recordCycle, getReport, seedPassGRow } from './governance/calibrationMonitor'
import { PredicateEvaluationEngine } from './governance/blackboard'

export interface AEPAccessors {
  db: Database.Database
}

let wired = false

/**
 * Wire up AEP Level-4 governance.
 *
 * - Guards against double-initialization with `wired`.
 * - Seeds agent capabilities once.
 * - Returns typed accessors to the governance modules so the IPC layer can
 *   delegate to them without re-instantiating on every call.
 *
 * No setInterval tick is started automatically. The tick is exposed
 * synchronously so the IPC handler can call it on demand (aep:tickOrchestrator).
 */
export function wireAEP(accessors: AEPAccessors): AEPGovernanceAPI {
  if (wired) {
    return buildAPI(accessors.db)
  }
  wired = true

  seedCapabilities(accessors.db)

  return buildAPI(accessors.db)
}

/** Resets the guard — only for tests. */
export function _resetWired(): void {
  wired = false
}

export interface AEPGovernanceAPI {
  orchestrator: ValueStreamOrchestrator
  gateManager: HumanGateManager
  predicates: PredicateEvaluationEngine
  getApprovalSet: (featureId: number) => string[]
  calibration: {
    recordCycle: (input: Parameters<typeof recordCycle>[1]) => ReturnType<typeof recordCycle>
    getReport: (agentId?: string) => ReturnType<typeof getReport>
    seedPassGRow: (featureId: number) => void
  }
}

function buildAPI(db: Database.Database): AEPGovernanceAPI {
  return {
    orchestrator: new ValueStreamOrchestrator(db),
    gateManager: new HumanGateManager(db),
    predicates: new PredicateEvaluationEngine(db),
    getApprovalSet: (featureId: number) => getApprovalSet(db, featureId),
    calibration: {
      recordCycle: (input) => recordCycle(db, input),
      getReport: (agentId?) => getReport(db, agentId),
      seedPassGRow: (featureId) => seedPassGRow(db, featureId),
    },
  }
}
