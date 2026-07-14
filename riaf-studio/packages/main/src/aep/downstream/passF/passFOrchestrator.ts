// packages/main/src/aep/downstream/passF/passFOrchestrator.ts
import type Database from 'better-sqlite3'
import type { AEPPassProgress } from '@shared/index'
import { CicdIngester, type CicdPayload } from './cicdIngester'
import { TestRunIngester, type TestRunPayload } from './testRunIngester'
import { DeploymentIngester, type DeploymentPayload } from './deploymentIngester'
import { KpiObservationIngester } from './kpiObservationIngester'

export interface PassFInput {
  cicd?: CicdPayload
  testRun?: Omit<TestRunPayload, 'buildId'>
  deployment?: Omit<DeploymentPayload, 'buildId'>
  /** If true, snapshot KPIs from kpi_registry after deployment */
  snapshotKPIsOnDeploy?: boolean
}

export interface PassFResult {
  buildId: number | null
  releaseCandidateId: number | null
  testRunId: number | null
  deploymentId: number | null
  environmentId: number | null
  featuresAdvanced: number[]
  kpiSnapshotCount: number
}

export class PassFOrchestrator {
  private readonly cicdIngester: CicdIngester
  private readonly testRunIngester: TestRunIngester
  private readonly deploymentIngester: DeploymentIngester
  private readonly kpiIngester: KpiObservationIngester

  constructor(private readonly db: Database.Database) {
    this.cicdIngester = new CicdIngester(db)
    this.testRunIngester = new TestRunIngester(db)
    this.deploymentIngester = new DeploymentIngester(db)
    this.kpiIngester = new KpiObservationIngester(db)
  }

  async run(
    input: PassFInput,
    push: (p: AEPPassProgress) => void,
  ): Promise<PassFResult> {
    let buildId: number | null = null
    let releaseCandidateId: number | null = null
    let testRunId: number | null = null
    let deploymentId: number | null = null
    let environmentId: number | null = null
    let featuresAdvanced: number[] = []
    let kpiSnapshotCount = 0

    // ── F_cicd ────────────────────────────────────────────────────────────────
    if (input.cicd) {
      push({ pass: 'F_cicd', stage: 'build_ingest', pct: 0, detail: 'Ingesting CI/CD payload…' })
      try {
        const r = this.cicdIngester.ingest(input.cicd)
        buildId = r.buildId
        releaseCandidateId = r.releaseCandidateId
        push({
          pass: 'F_cicd',
          stage: 'build_ingest',
          pct: 100,
          detail: `Build #${buildId} created, ${r.packagedEdges} PACKAGED_IN edges`,
        })
      } catch (err) {
        push({ pass: 'F_cicd', stage: 'build_ingest', pct: 100, detail: `Error: ${String(err)}` })
      }
    }

    // ── F_tests ───────────────────────────────────────────────────────────────
    if (input.testRun && buildId !== null) {
      push({ pass: 'F_tests', stage: 'test_run_ingest', pct: 0, detail: 'Ingesting test run…' })
      try {
        const r = this.testRunIngester.ingest({ ...input.testRun, buildId })
        testRunId = r.testRunId
        push({
          pass: 'F_tests',
          stage: 'test_run_ingest',
          pct: 100,
          detail: `TestRun #${testRunId}${r.evidencedByEdge ? ' + EVIDENCED_BY quality gate' : ''}`,
        })
      } catch (err) {
        push({ pass: 'F_tests', stage: 'test_run_ingest', pct: 100, detail: `Error: ${String(err)}` })
      }
    }

    // ── F_deploy ──────────────────────────────────────────────────────────────
    if (input.deployment && buildId !== null) {
      push({ pass: 'F_deploy', stage: 'deployment', pct: 0, detail: 'Recording deployment…' })
      try {
        const r = this.deploymentIngester.ingest({ ...input.deployment, buildId })
        deploymentId = r.deploymentId
        environmentId = r.environmentId
        featuresAdvanced = r.featuresAdvanced
        push({
          pass: 'F_deploy',
          stage: 'deployment',
          pct: 100,
          detail: `Deployment #${deploymentId} → ${input.deployment.environmentLabel}; ${featuresAdvanced.length} feature(s) → OBSERVE`,
        })
      } catch (err) {
        push({ pass: 'F_deploy', stage: 'deployment', pct: 100, detail: `Error: ${String(err)}` })
      }
    }

    // ── F_kpi ─────────────────────────────────────────────────────────────────
    if (input.snapshotKPIsOnDeploy && deploymentId !== null) {
      push({ pass: 'F_kpi', stage: 'kpi_snapshot', pct: 0, detail: 'Snapshotting KPI baselines…' })
      try {
        const r = this.kpiIngester.snapshotKPIs()
        kpiSnapshotCount = r.snapshots.length
        push({
          pass: 'F_kpi',
          stage: 'kpi_snapshot',
          pct: 100,
          detail: `${kpiSnapshotCount} KPI(s) snapshotted, ${r.skipped} skipped`,
        })
      } catch (err) {
        push({ pass: 'F_kpi', stage: 'kpi_snapshot', pct: 100, detail: `Error: ${String(err)}` })
      }
    }

    return {
      buildId,
      releaseCandidateId,
      testRunId,
      deploymentId,
      environmentId,
      featuresAdvanced,
      kpiSnapshotCount,
    }
  }
}
