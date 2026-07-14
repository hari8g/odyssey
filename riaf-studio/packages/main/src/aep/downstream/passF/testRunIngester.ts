// packages/main/src/aep/downstream/passF/testRunIngester.ts
import type Database from 'better-sqlite3'
import { upsertNode, insertEdge, getNodeId } from '../../graphWrite'

export interface TestRunPayload {
  buildId: number
  runnerLabel: string
  /** 'passed' | 'failed' | 'partial' */
  status: 'passed' | 'failed' | 'partial' | string
  totalTests: number
  passedTests: number
  failedTests: number
  durationMs?: number
  /** Optional: label of an existing QUALITY_GATE node to create EVIDENCED_BY edge */
  qualityGateLabel?: string
}

export interface TestRunIngestResult {
  testRunId: number
  evidencedByEdge: boolean
}

export class TestRunIngester {
  constructor(private readonly db: Database.Database) {}

  ingest(payload: TestRunPayload): TestRunIngestResult {
    return this.db.transaction((): TestRunIngestResult => {
      const passRate = payload.totalTests > 0
        ? ((payload.passedTests / payload.totalTests) * 100).toFixed(1)
        : '0.0'

      const testRunLabel = `TestRun: ${payload.runnerLabel} — ${payload.status} (${passRate}% pass)`

      const testRunId = upsertNode(this.db, {
        kind: 'TEST_RUN',
        label: testRunLabel,
        description:
          `Runner: ${payload.runnerLabel} | Status: ${payload.status} | ` +
          `Total: ${payload.totalTests} | Passed: ${payload.passedTests} | ` +
          `Failed: ${payload.failedTests}${payload.durationMs !== undefined ? ` | Duration: ${payload.durationMs}ms` : ''}`,
        source_type: 'cicd',
        source_ref: String(payload.buildId),
      })

      // Store additional metrics in test_run_registry if table exists; gracefully skip if not
      try {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO test_run_registry
             (test_run_node_id, build_node_id, status, total_tests, passed_tests, failed_tests, duration_ms, ran_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)`,
          )
          .run(
            testRunId,
            payload.buildId,
            payload.status,
            payload.totalTests,
            payload.passedTests,
            payload.failedTests,
            payload.durationMs ?? null,
          )
      } catch {
        // table may not exist in all migrations; non-fatal
      }

      // Link TEST_RUN → BUILD
      insertEdge(this.db, testRunId, payload.buildId, 'EVIDENCED_BY', 1.0, {
        status: payload.status,
        passRate: Number(passRate),
      })

      // If a QUALITY_GATE node is referenced, create EVIDENCED_BY from it to TEST_RUN
      let evidencedByEdge = false
      if (payload.qualityGateLabel) {
        const gateId = getNodeId(this.db, 'QUALITY_GATE', payload.qualityGateLabel)
        if (gateId !== undefined) {
          insertEdge(this.db, gateId, testRunId, 'EVIDENCED_BY', 1.0)
          evidencedByEdge = true
        }
      }

      return { testRunId, evidencedByEdge }
    })()
  }
}
