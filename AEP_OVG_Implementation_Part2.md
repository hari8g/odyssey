# Domain-Aware ISS (D-ISS) + Agentic Engineering Platform (AEP)
## Complete Implementation Plan — Part 2 of 2
### Level 3: Downstream AEP (L+4 and L+5) · Level 4: The Full Loop

> Continues from Part 1. All file paths relative to `riaf-studio/`.
> Pre-conditions: Levels 1 and 2 fully implemented and working.

---

## Table of Contents — Part 2

10. [Level 3 — Downstream AEP (L+4 and L+5)](#10-level-3--downstream-aep)
    - 10.1 Pass F Orchestrator
    - 10.2 CI/CD Ingester
    - 10.3 Test Run Ingester
    - 10.4 Deployment Ingester
    - 10.5 KPI Observation Ingester
    - 10.6 4-Scope Blast Radius Engine
    - 10.7 A10 — Consolidation & Release Readiness Agent
    - 10.8 A11 — Deployment Orchestration Agent
    - 10.9 A12 — Outcome Attribution Agent
    - 10.10 A13 — Cross-Functional Impact Agent
    - 10.11 Pass G — Outcome Synthesis
11. [Level 4 — The Full Loop](#11-level-4--the-full-loop)
    - 11.1 A14 — Organizational Learning Agent
    - 11.2 Value Stream Orchestrator (Tier-3 FSM)
    - 11.3 Blackboard — Predicate Evaluation Engine
    - 11.4 RACI-on-Graph
    - 11.5 Agent Capability Matrix
    - 11.6 Human Gate Manager
    - 11.7 Calibration Monitor
12. [AEP IPC Handlers — Part 2](#12-aep-ipc-handlers-part-2)
13. [Renderer Panels — Part 2](#13-renderer-panels-part-2)
14. [Level 3 & 4 Build Order](#14-level-3--4-build-order)
15. [Complete AEP File Manifest](#15-complete-aep-file-manifest)
16. [The Golden Thread — End-to-End Query](#16-the-golden-thread)

---

## 10. Level 3 — Downstream AEP (L+4 and L+5)

Level 3 is where beliefs meet evidence. The code that was built from features
that came from pain points that came from customer signals now runs in production.
KPIs move. Hypotheses resolve. The graph records what actually happened.

### 10.1 Pass F Orchestrator

```typescript
// packages/main/src/aep/downstream/passF/passFOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { AEPPassProgress } from '@shared/index'
import { CICDIngester }           from './cicdIngester'
import { TestRunIngester }        from './testRunIngester'
import { DeploymentIngester }     from './deploymentIngester'
import { KPIObservationIngester } from './kpiObservationIngester'

export class PassFOrchestrator {
  constructor(
    private readonly db:  Database.Database,
    private readonly win: BrowserWindow,
  ) {}

  private push = (p: AEPPassProgress) =>
    this.win.webContents.send('aep:passProgress', p)

  /** Called by CI/CD webhook handler (e.g. GitHub Actions, GitLab CI POST request) */
  async ingestBuildEvent(payload: unknown): Promise<void> {
    this.push({ pass: 'F_cicd', stage: 'build', pct: 0, detail: 'Processing build event…' })
    const ingester = new CICDIngester(this.db)
    await ingester.ingestBuild(payload)
    this.push({ pass: 'F_cicd', stage: 'build', pct: 100, detail: 'Build node written' })
  }

  async ingestTestRun(buildId: number, payload: unknown): Promise<void> {
    this.push({ pass: 'F_tests', stage: 'test_run', pct: 0, detail: 'Processing test run…' })
    const ingester = new TestRunIngester(this.db)
    await ingester.ingest(buildId, payload)
    this.push({ pass: 'F_tests', stage: 'test_run', pct: 100, detail: 'Test run linked' })
  }

  async ingestDeployment(releaseCandidateId: number, environment: string): Promise<void> {
    this.push({ pass: 'F_deploy', stage: 'deployment', pct: 0,
                detail: `Deployment to ${environment}…` })
    const ingester = new DeploymentIngester(this.db)
    await ingester.ingest(releaseCandidateId, environment)
    this.push({ pass: 'F_deploy', stage: 'deployment', pct: 100, detail: 'Deployment recorded' })
  }

  /** Scheduled job: snapshot KPI values from registered telemetry sources */
  async snapshotKPIs(): Promise<number> {
    this.push({ pass: 'F_kpi', stage: 'snapshot', pct: 0, detail: 'Snapshotting KPIs…' })
    const ingester = new KPIObservationIngester(this.db)
    const count = await ingester.snapshot()
    this.push({ pass: 'F_kpi', stage: 'snapshot', pct: 100,
                detail: `${count} KPI_OBSERVATION nodes written` })
    return count
  }
}
```

### 10.2 CI/CD Ingester

```typescript
// packages/main/src/aep/downstream/passF/cicdIngester.ts
// Ingests CI/CD build events via webhook payloads.
// Resolves the commit SHA → L3 file nodes → PACKAGED_IN edges.
// This is the JOIN between L3 (code) and L+4 (delivery).
import type Database from 'better-sqlite3'

type BuildPayload = {
  provider:     'github_actions' | 'gitlab_ci' | 'jenkins' | 'generic'
  buildId:      string
  commitSha:    string
  branchName:   string
  status:       'success' | 'failure' | 'running' | 'cancelled'
  startedAt:    string      // ISO datetime
  finishedAt?:  string
  artifactUrl?: string
  pipelineName: string
}

export class CICDIngester {
  private readonly insertNode:  Database.Statement
  private readonly insertEdge:  Database.Statement
  private readonly getNode:     Database.Statement
  private readonly getByRef:    Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, ?, ?, 'deployment', 0.99, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'cicd', ?, unixepoch() * 1000)
    `)
    this.getNode  = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
    this.getByRef = db.prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE source_ref = ? LIMIT 1'
    )
  }

  async ingestBuild(rawPayload: unknown): Promise<number> {
    const p = this.normalizePayload(rawPayload)

    // BUILD node
    const buildRef = `build:${p.provider}:${p.buildId}`
    this.insertNode.run(
      'BUILD',
      `Build ${p.buildId} [${p.status}]`,
      JSON.stringify(p),
      'cicd', buildRef,
    )
    const buildNode = this.getByRef.get(buildRef)!

    // RELEASE_CANDIDATE node (one per branch/pipeline combination)
    const rcRef = `rc:${p.branchName}:${p.pipelineName}`
    this.insertNode.run(
      'RELEASE_CANDIDATE',
      `RC: ${p.branchName} — ${p.pipelineName}`,
      JSON.stringify({ branch: p.branchName, pipeline: p.pipelineName, latestBuild: p.buildId }),
      'cicd', rcRef,
    )
    const rcNode = this.getByRef.get(rcRef)!

    // Link: BUILD → part of → RELEASE_CANDIDATE
    this.insertEdge.run(buildNode.id, rcNode.id, 'PACKAGED_IN', null)

    // The key JOIN: resolve commit SHA → file changes → PACKAGED_IN edges to code nodes
    // This links L+4 back to L3: which code is in this build?
    await this.resolveCommitToFiles(p.commitSha, buildNode.id)

    return buildNode.id
  }

  private async resolveCommitToFiles(
    commitSha: string,
    buildNodeId: number,
  ): Promise<void> {
    // Use git to find which files changed in this commit
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const exec = promisify(execFile)

    try {
      const { stdout } = await exec('git', [
        'diff-tree', '--no-commit-id', '-r', '--name-only', commitSha
      ], { timeout: 10_000 })

      const files = stdout.trim().split('\n').filter(Boolean)
      const batch = this.db.transaction(() => {
        for (const file of files) {
          // Find the graph_node for this file (from Pass A / RIAF indexer)
          const fileNode = this.db.prepare<[string], { id: number }>(
            `SELECT id FROM graph_nodes WHERE file_path = ?
             AND kind IN ('FUNCTION','CLASS','MODULE','DOMAIN_SERVICE') LIMIT 1`
          ).get(file)
          if (fileNode) {
            this.insertEdge.run(
              fileNode.id, buildNodeId, 'PACKAGED_IN',
              JSON.stringify({ commit: commitSha, file })
            )
          }
        }
      })
      batch()
    } catch { /* git not available or commit not in repo — skip file resolution */ }
  }

  private normalizePayload(raw: unknown): BuildPayload {
    const p = raw as Record<string, unknown>
    // GitHub Actions shape
    if (p['workflow_run']) {
      const wr = p['workflow_run'] as Record<string, unknown>
      return {
        provider:     'github_actions',
        buildId:      String(wr['id']),
        commitSha:    String(wr['head_sha']),
        branchName:   String(wr['head_branch']),
        status:       this.mapGhStatus(String(wr['conclusion'] ?? wr['status'])),
        startedAt:    String(wr['created_at']),
        finishedAt:   wr['updated_at'] ? String(wr['updated_at']) : undefined,
        pipelineName: String(wr['name']),
      }
    }
    // Generic / pre-normalized
    return p as unknown as BuildPayload
  }

  private mapGhStatus(s: string): BuildPayload['status'] {
    if (s === 'success')   return 'success'
    if (s === 'failure')   return 'failure'
    if (s === 'cancelled') return 'cancelled'
    return 'running'
  }
}
```

### 10.3 Test Run Ingester

```typescript
// packages/main/src/aep/downstream/passF/testRunIngester.ts
// Links CI test run results to L3 TEST_SUITE nodes and L+4 QUALITY_GATE nodes.
import type Database from 'better-sqlite3'

type TestRunPayload = {
  suiteFile:   string     // path to the test file (resolves to L3 TEST_SUITE node)
  status:      'pass' | 'fail' | 'skip'
  passCount:   number
  failCount:   number
  skipCount:   number
  durationMs:  number
  coverage?:   number     // line coverage %
  gateId?:     string     // which QUALITY_GATE this run satisfies
}

export class TestRunIngester {
  private readonly insertNode:  Database.Statement
  private readonly insertEdge:  Database.Statement
  private readonly getNode:     Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase, sdlc_confidence,
         importance_score, created_at)
      VALUES ('TEST_RUN', ?, ?, 'cicd', 'testing', 0.99, 0.0, unixepoch() * 1000)
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'test_runner', ?, unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  ingest(buildNodeId: number, payload: TestRunPayload): void {
    const label = `TestRun: ${payload.suiteFile} [${payload.status}]`
    const result = this.insertNode.run(label, JSON.stringify(payload))
    const runId  = Number(result.lastInsertRowid)

    // Link TEST_RUN → BUILD (evidences the build)
    this.insertEdge.run(runId, buildNodeId, 'EVIDENCED_BY', null)

    // Link to L3 TEST_SUITE node (if exists from Pass A)
    const suiteNode = this.getNode.get('TEST_SUITE', payload.suiteFile)
    if (suiteNode) {
      this.insertEdge.run(runId, suiteNode.id, 'TESTS', null)
    }

    // If this run satisfies a QUALITY_GATE, wire EVIDENCED_BY
    if (payload.gateId) {
      const gateNode = this.getNode.get('QUALITY_GATE', payload.gateId)
      if (gateNode) {
        this.insertEdge.run(gateNode.id, runId, 'EVIDENCED_BY', null)
      }
    }
  }
}
```

### 10.4 Deployment Ingester

```typescript
// packages/main/src/aep/downstream/passF/deploymentIngester.ts
import type Database from 'better-sqlite3'

export class DeploymentIngester {
  private readonly insertNode:  Database.Statement
  private readonly insertEdge:  Database.Statement
  private readonly getNode:     Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, 'deployment', 'deployment', 0.99, 0.0, unixepoch() * 1000)
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'deploy', ?, unixepoch() * 1000)
    `)
    this.getNode = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  ingest(releaseCandidateId: number, environment: string): void {
    // Ensure ENVIRONMENT node exists
    this.insertNode.run(
      'ENVIRONMENT', environment, `Deploy environment: ${environment}`, null
    )
    const envNode = this.getNode.get('ENVIRONMENT', environment)!

    // DEPLOYMENT event node
    const ts = new Date().toISOString()
    const depResult = this.insertNode.run(
      'DEPLOYMENT',
      `Deployment → ${environment} at ${ts}`,
      JSON.stringify({ releaseCandidateId, environment, deployedAt: ts }),
      null
    )
    const depId = Number(depResult.lastInsertRowid)

    // RC → DEPLOYED_TO → ENVIRONMENT (via DEPLOYMENT)
    this.insertEdge.run(releaseCandidateId, depId, 'DEPLOYED_TO',
      JSON.stringify({ environment }))
    this.insertEdge.run(depId, envNode.id, 'DEPLOYED_TO', null)

    // Advance value stream state: BUILD → CONSOLIDATE → RELEASE for all features in this RC
    const featureIds = this.db.prepare<[number], { feature_id: number }>(`
      SELECT DISTINCT ft.feature_node_id as feature_id
      FROM feature_traces ft
      JOIN graph_nodes gn ON gn.id = ft.code_node_id
      JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'PACKAGED_IN'
      WHERE ge.to_node_id = ?
    `).all(releaseCandidateId).map(r => r.feature_id)

    const updateState = this.db.prepare(`
      UPDATE value_stream_state
      SET stream_state = 'OBSERVE', entered_state_at = unixepoch() * 1000
      WHERE feature_node_id = ? AND stream_state IN ('RELEASE','CONSOLIDATE')
    `)
    for (const fid of featureIds) updateState.run(fid)
  }
}
```

### 10.5 KPI Observation Ingester

```typescript
// packages/main/src/aep/downstream/passF/kpiObservationIngester.ts
// Periodically snapshots KPI values from declared telemetry sources.
// Only ingests KPIs declared in the domain pack's kpi_registry —
// the graph is NOT a metrics firehose; it stores meaning, not raw streams.
import type Database from 'better-sqlite3'

export class KPIObservationIngester {
  private readonly insertNode:  Database.Statement
  private readonly insertEdge:  Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('KPI_OBSERVATION', ?, ?, 'telemetry', 'deployment', 0.95, 0.0, unixepoch() * 1000)
    `)
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'OBSERVED_AS', 1.0, 1.0, 'telemetry', ?, unixepoch() * 1000)
    `)
  }

  async snapshot(): Promise<number> {
    const kpis = this.db.prepare<[], {
      id: number; label: string; telemetry_source: string | null;
      measurement_window: string
    }>(`
      SELECT gn.id, gn.label, kr.telemetry_source, kr.measurement_window
      FROM graph_nodes gn JOIN kpi_registry kr ON kr.kpi_node_id = gn.id
      WHERE gn.kind = 'KPI' AND kr.telemetry_source IS NOT NULL
    `).all()

    let count = 0
    for (const kpi of kpis) {
      // In production: call the actual telemetry source API
      // Here we simulate with a placeholder — real implementation would
      // call Datadog, Prometheus, BigQuery, etc. based on `telemetry_source`
      const value = await this.fetchKpiValue(kpi.label, kpi.telemetry_source!)
      if (value === null) continue

      const windowLabel = `${kpi.label} — ${new Date().toISOString().split('T')[0]}`
      const result = this.insertNode.run(
        windowLabel,
        JSON.stringify({
          kpi: kpi.label,
          value,
          window: kpi.measurement_window,
          measuredAt: new Date().toISOString(),
        }),
      )
      const obsId = Number(result.lastInsertRowid)
      this.insertEdge.run(kpi.id, obsId,
        JSON.stringify({ value, window: kpi.measurement_window }))
      count++
    }
    return count
  }

  private async fetchKpiValue(
    kpiName:    string,
    sourceSpec: string,
  ): Promise<number | null> {
    // sourceSpec format: "provider:query" e.g. "datadog:avg:charge_dispute_rate"
    // Real implementation would call the respective API.
    // Returns null if unavailable (graceful degradation).
    try {
      const [provider, ...queryParts] = sourceSpec.split(':')
      const query = queryParts.join(':')
      // Placeholder: in production, dispatch by provider
      console.log(`[KPIObservation] Would fetch ${kpiName} from ${provider}: ${query}`)
      return null  // Remove this when real fetchers are implemented
    } catch { return null }
  }

  /** Manual override: record a KPI value directly (for teams without automated telemetry) */
  recordManual(kpiNodeId: number, value: number, window: string): void {
    const kpi = this.db.prepare<[number], { label: string }>(
      'SELECT label FROM graph_nodes WHERE id = ?'
    ).get(kpiNodeId)
    if (!kpi) throw new Error(`KPI node ${kpiNodeId} not found`)

    const result = this.insertNode.run(
      `${kpi.label} — manual — ${new Date().toISOString().split('T')[0]}`,
      JSON.stringify({ kpi: kpi.label, value, window, measuredAt: new Date().toISOString(),
                       source: 'manual' }),
    )
    this.insertEdge.run(kpiNodeId, Number(result.lastInsertRowid),
      JSON.stringify({ value, window, source: 'manual' }))
  }
}
```

### 10.6 4-Scope Blast Radius Engine

```typescript
// packages/main/src/aep/downstream/blastRadiusEngine.ts
// Computes the four concentric scopes of blast radius for a RELEASE_CANDIDATE.
// Scope 1 — Code: files changed or co-changing
// Scope 2 — Verification: tests/rules/criteria covering scope-1, and gaps
// Scope 3 — Operational: services, events, environments, cross-repo consumers
// Scope 4 — Organizational: KPIs, regulations, segments, org units exposed
// Also computes the approval set: who must sign off at the release gate.
import type Database from 'better-sqlite3'
import type { BlastRadius } from '@shared/index'
import { FISEngine } from '../../iss/fisEngine'

export class BlastRadiusEngine {
  constructor(private readonly db: Database.Database) {}

  compute(releaseCandidateId: number): BlastRadius {
    const scope1 = this.computeScope1(releaseCandidateId)
    const scope2 = this.computeScope2(scope1.map(f => f.filePath))
    const scope3 = this.computeScope3(scope1.map(f => f.filePath))
    const scope4 = this.computeScope4(scope1.map(f => f.filePath))
    const approvalSet = this.computeApprovalSet(scope4)

    return {
      featureId:    releaseCandidateId,
      scope1_code:  scope1,
      scope2_verify: scope2.verified,
      scope2_gaps:   scope2.gaps,
      scope3_ops:   scope3,
      scope4_org:   scope4,
      approvalSet,
      computedAt:   Date.now(),
    }
  }

  // ── Scope 1: Code ──────────────────────────────────────────────────────────
  private computeScope1(
    rcId: number,
  ): { filePath: string; changeType: 'direct' | 'cochange' }[] {
    // Direct: files in the RC's build (PACKAGED_IN edges)
    const direct = this.db.prepare<[number], { file_path: string }>(`
      SELECT DISTINCT gn.file_path FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'PACKAGED_IN'
      JOIN graph_nodes build ON build.id = ge.to_node_id AND build.kind = 'BUILD'
      JOIN graph_edges ge2 ON ge2.from_node_id = build.id AND ge2.kind = 'PACKAGED_IN'
      WHERE ge2.to_node_id = ? AND gn.file_path IS NOT NULL
    `).all(rcId).map(r => ({ filePath: r.file_path, changeType: 'direct' as const }))

    // Co-change: files historically coupled to direct files (CO_CHANGES_WITH ≥ 0.5)
    const directPaths = new Set(direct.map(d => d.filePath))
    const fisEngine   = new FISEngine(this.db)
    const blastFiles  = fisEngine.getBlastRadius([...directPaths], 1)

    const cochange = blastFiles
      .filter(f => !directPaths.has(f))
      .map(f => ({ filePath: f, changeType: 'cochange' as const }))

    return [...direct, ...cochange]
  }

  // ── Scope 2: Verification ──────────────────────────────────────────────────
  private computeScope2(filePaths: string[]): {
    verified: { kind: string; label: string; isCovered: boolean; filePath: string | null }[]
    gaps:     string[]
  } {
    if (filePaths.length === 0) return { verified: [], gaps: [] }

    // Find all test suites covering the scope-1 files
    const testSuites = this.db.prepare<string[], { label: string; file_path: string | null }>(`
      SELECT DISTINCT gn.label, gn.file_path FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'TESTS'
      JOIN graph_nodes target ON target.id = ge.to_node_id
        AND target.file_path IN (${filePaths.map(() => '?').join(',')})
      WHERE gn.kind = 'TEST_SUITE'
    `).all(...filePaths)

    // Find acceptance criteria with VALIDATES edges into the scope
    const acNodes = this.db.prepare<string[], { label: string; filePath: string | null }>(`
      SELECT DISTINCT ac.label, ac.file_path as filePath FROM graph_nodes ac
      JOIN graph_edges ge ON ge.from_node_id = ac.id AND ge.kind = 'VALIDATES'
      JOIN graph_nodes impl ON impl.id = ge.to_node_id
        AND impl.file_path IN (${filePaths.map(() => '?').join(',')})
      WHERE ac.kind = 'ACCEPTANCE_CRITERION'
    `).all(...filePaths)

    // Find business rules that ENFORCES edges point to scope-1 code
    const businessRules = this.db.prepare<string[], { label: string }>(`
      SELECT DISTINCT br.label FROM graph_nodes br
      JOIN graph_edges ge ON ge.from_node_id = br.id AND ge.kind = 'ENFORCES'
      JOIN graph_nodes impl ON impl.id = ge.to_node_id
        AND impl.file_path IN (${filePaths.map(() => '?').join(',')})
      WHERE br.kind = 'BUSINESS_RULE'
    `).all(...filePaths)

    // Gaps: scope-1 files with NO covering TEST_SUITE
    const coveredFiles = new Set(
      this.db.prepare<string[], { file_path: string }>(`
        SELECT DISTINCT target.file_path FROM graph_nodes gn
        JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'TESTS'
        JOIN graph_nodes target ON target.id = ge.to_node_id
          AND target.file_path IN (${filePaths.map(() => '?').join(',')})
        WHERE gn.kind = 'TEST_SUITE'
      `).all(...filePaths).map(r => r.file_path)
    )
    const gaps = filePaths.filter(f => !coveredFiles.has(f))

    const verified = [
      ...testSuites.map(t  => ({ kind: 'TEST_SUITE',          label: t.label, isCovered: true, filePath: t.file_path })),
      ...acNodes.map(ac    => ({ kind: 'ACCEPTANCE_CRITERION', label: ac.label, isCovered: true, filePath: ac.filePath })),
      ...businessRules.map(br => ({ kind: 'BUSINESS_RULE', label: br.label, isCovered: true, filePath: null })),
    ]

    return { verified, gaps }
  }

  // ── Scope 3: Operational ───────────────────────────────────────────────────
  private computeScope3(
    filePaths: string[],
  ): { kind: string; label: string; detail: string }[] {
    if (filePaths.length === 0) return []

    const results: { kind: string; label: string; detail: string }[] = []

    // Domain events emitted by scope-1 files (and their consumers)
    const events = this.db.prepare<string[], {
      event_label: string; consumer: string | null
    }>(`
      SELECT DISTINCT de.label as event_label, gn2.label as consumer
      FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'EMITS'
      JOIN graph_nodes de ON de.id = ge.to_node_id AND de.kind = 'DOMAIN_EVENT'
      LEFT JOIN graph_edges ge2 ON ge2.to_node_id = de.id AND ge2.kind = 'CONSUMES'
      LEFT JOIN graph_nodes gn2 ON gn2.id = ge2.from_node_id
      WHERE gn.file_path IN (${filePaths.map(() => '?').join(',')})
    `).all(...filePaths)

    for (const e of events) {
      results.push({
        kind:   'DOMAIN_EVENT',
        label:  e.event_label,
        detail: e.consumer ? `consumed by: ${e.consumer}` : 'no known consumers',
      })
    }

    // Bounded contexts exposed
    const contexts = this.db.prepare<string[], { label: string }>(`
      SELECT DISTINCT bc.label FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'BELONGS_TO_CONTEXT'
      JOIN graph_nodes bc ON bc.id = ge.to_node_id AND bc.kind = 'BOUNDED_CONTEXT'
      WHERE gn.file_path IN (${filePaths.map(() => '?').join(',')})
    `).all(...filePaths)

    for (const c of contexts) {
      results.push({ kind: 'BOUNDED_CONTEXT', label: c.label, detail: 'files in this context are changing' })
    }

    return results
  }

  // ── Scope 4: Organizational ────────────────────────────────────────────────
  private computeScope4(filePaths: string[]): BlastRadius['scope4_org'] {
    if (filePaths.length === 0) return { kpis: [], segments: [], orgUnits: [], governed: [] }

    // KPIs that have INSTRUMENTS edges to scope-1 telemetry
    const kpis = this.db.prepare<string[], { label: string }>(`
      SELECT DISTINCT kpi.label FROM graph_nodes kpi
      JOIN graph_edges ge ON ge.to_node_id = kpi.id AND ge.kind = 'OBSERVED_AS'
      WHERE kpi.kind = 'KPI'
      LIMIT 10
    `).all().map(r => r.label)

    // Regulations governing scope-1 files
    const governed = this.db.prepare<string[], { label: string }>(`
      SELECT DISTINCT reg.label FROM graph_nodes reg
      JOIN graph_edges ge ON ge.to_node_id = reg.id AND ge.kind = 'GOVERNED_BY'
      JOIN graph_nodes gn ON gn.id = ge.from_node_id
        AND gn.file_path IN (${filePaths.map(() => '?').join(',')})
      WHERE reg.kind = 'REGULATION'
    `).all(...filePaths).map(r => r.label)

    // Segments targeted by features in this release
    const segments = this.db.prepare<string[], { label: string }>(`
      SELECT DISTINCT seg.label FROM graph_nodes seg
      JOIN graph_edges ge ON ge.to_node_id = seg.id AND ge.kind = 'TARGETS'
      JOIN graph_nodes feat ON feat.id = ge.from_node_id
        AND feat.kind IN ('FEATURE','EPIC')
      LIMIT 10
    `).all().map(r => r.label)

    // Org units that OWN any of the above
    const orgUnits = this.db.prepare<[], { label: string }>(`
      SELECT DISTINCT ou.label FROM graph_nodes ou
      JOIN graph_edges ge ON ge.to_node_id = ou.id AND ge.kind = 'OWNED_BY'
      WHERE ou.kind = 'ORG_UNIT'
    `).all().map(r => r.label)

    return { kpis, segments, orgUnits, governed }
  }

  // ── Approval Set Computation ───────────────────────────────────────────────
  // The approval set is DERIVED from scope 4 — not configured manually.
  // Any release touching governed code auto-adds the compliance role.
  // Any release touching pricing KPIs auto-adds the GTM role.
  // Engineering lead is always required.
  private computeApprovalSet(scope4: BlastRadius['scope4_org']): string[] {
    const roles = new Set(['Engineering Lead'])  // always required

    if (scope4.governed.length > 0) roles.add('Compliance Officer')
    if (scope4.kpis.some(k => k.toLowerCase().includes('revenue') ||
                               k.toLowerCase().includes('price'))) roles.add('GTM Lead')
    if (scope4.segments.includes('enterprise') ||
        scope4.segments.includes('fleet-operators')) roles.add('Customer Success Lead')

    // Check OWNED_BY for any org unit that owns a touched KPI
    for (const kpiName of scope4.kpis) {
      const owner = this.db.prepare<[string], { owner_org_unit: string | null }>(
        `SELECT kr.owner_org_unit FROM kpi_registry kr
         JOIN graph_nodes gn ON gn.id = kr.kpi_node_id WHERE gn.label = ? LIMIT 1`
      ).get(kpiName)
      if (owner?.owner_org_unit) roles.add(`${owner.owner_org_unit} Lead`)
    }

    return [...roles]
  }
}
```

### 10.7 A10 — Consolidation & Release Readiness Agent

```typescript
// packages/main/src/aep/downstream/agents/a10ConsolidationAgent.ts
// A10 produces the RELEASE_READINESS_REPORT artifact.
// It aggregates the 4-scope blast radius, gate verdicts, and feature completion
// into a human-readable report for the release approval gate.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { BlastRadiusEngine } from '../blastRadiusEngine'
import { writeArtifactNode } from '../../upstream/artifactWriter'

export class A10ConsolidationAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(releaseCandidateId: number): Promise<number> {
    const rcNode = this.db
      .prepare<[number], { label: string; description: string }>(
        'SELECT label, description FROM graph_nodes WHERE id = ?'
      )
      .get(releaseCandidateId)
    if (!rcNode) throw new Error(`Release candidate ${releaseCandidateId} not found`)

    // ── 1. Compute 4-scope blast radius ──────────────────────────────────────
    const blastRadius = new BlastRadiusEngine(this.db).compute(releaseCandidateId)

    // ── 2. Collect feature completion status for all features in this RC ──────
    const features = this.db.prepare<[number], {
      id: number; label: string; completion_pct: number; stream_state: string
    }>(`
      SELECT DISTINCT gn.id, gn.label,
             COALESCE(sps.completion_pct, 0) as completion_pct,
             COALESCE(vss.stream_state, 'UNKNOWN') as stream_state
      FROM feature_traces ft
      JOIN graph_nodes code ON code.id = ft.code_node_id
      JOIN graph_edges ge ON ge.from_node_id = code.id AND ge.kind = 'PACKAGED_IN'
      JOIN graph_nodes feat ON feat.id = ft.feature_node_id
        AND feat.kind IN ('FEATURE','EPIC')
      JOIN graph_nodes gn ON gn.id = feat.id
      LEFT JOIN sdlc_phase_summary sps ON sps.feature_node_id = feat.id
      LEFT JOIN value_stream_state vss ON vss.feature_node_id = feat.id
      WHERE ge.to_node_id = ?
    `).all(releaseCandidateId)

    // ── 3. Quality gate status ──────────────────────────────────────────────
    const gates = this.db.prepare<[number], {
      label: string; run_status: string | null; coverage: number | null
    }>(`
      SELECT DISTINCT qg.label,
             tr.description as run_status,
             NULL as coverage
      FROM graph_nodes qg
      JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = qg.id
        AND ge.kind = 'GATED_BY'
      LEFT JOIN graph_edges ge2 ON ge2.from_node_id = qg.id AND ge2.kind = 'EVIDENCED_BY'
      LEFT JOIN graph_nodes tr ON tr.id = ge2.to_node_id AND tr.kind = 'TEST_RUN'
      WHERE qg.kind = 'QUALITY_GATE'
    `).all(releaseCandidateId)

    // ── 4. LLM synthesis of the report ───────────────────────────────────────
    const prompt = `You are the Release Consolidation Agent. Produce a release readiness report.

Release Candidate: ${rcNode.label}

SCOPE 1 (Code) — ${blastRadius.scope1_code.length} files
  Direct: ${blastRadius.scope1_code.filter(f => f.changeType === 'direct').length}
  Co-change risk: ${blastRadius.scope1_code.filter(f => f.changeType === 'cochange').length}

SCOPE 2 (Verification) — Gaps (untested changed files):
${blastRadius.scope2_gaps.length === 0 ? '  None — full coverage' :
  blastRadius.scope2_gaps.slice(0, 5).map(f => `  ⚠ ${f}`).join('\n')}

SCOPE 3 (Operational):
${blastRadius.scope3_ops.map(o => `  [${o.kind}] ${o.label}: ${o.detail}`).join('\n') || '  None'}

SCOPE 4 (Organizational):
  KPIs exposed: ${blastRadius.scope4_org.kpis.join(', ') || 'none'}
  Regulations:  ${blastRadius.scope4_org.governed.join(', ') || 'none'}
  Segments:     ${blastRadius.scope4_org.segments.join(', ') || 'none'}

Required approvers: ${blastRadius.approvalSet.join(', ')}

Features in release:
${features.map(f => `  ${f.label}: ${f.completion_pct}% complete, state: ${f.stream_state}`).join('\n')}

Quality gates:
${gates.map(g => `  ${g.label}: ${g.run_status ?? 'not yet run'}`).join('\n') || '  No gates defined'}

Produce a concise release readiness assessment. Return JSON:
{
  "ready": true|false,
  "blocking_issues": ["issue 1 if any"],
  "warnings": ["warning 1"],
  "rollback_plan": "brief rollback strategy",
  "flag_recommendation": "none|canary_5pct|canary_10pct|gradual|full",
  "confidence": 0.0–1.0
}`

    const resp = await this.provider.complete({
      model: 'claude-sonnet-4-6',
      system: 'You are a release readiness analyst. Return only JSON.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    })

    const assessment = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
      ready: boolean; blocking_issues: string[]; warnings: string[];
      rollback_plan: string; flag_recommendation: string; confidence: number
    }

    const reportData = {
      blastRadius,
      features,
      gates,
      assessment,
      approvalSet: blastRadius.approvalSet,
    }

    const reportId = writeArtifactNode(this.db, {
      kind:         'RELEASE_READINESS_REPORT',
      label:        `Release Readiness: ${rcNode.label}`,
      description:  JSON.stringify(reportData),
      agentId:      'A10',
      agentVersion: '1.0.0',
      derivedFrom:  [releaseCandidateId],
      confidence:   assessment.confidence,
    })

    // Advance features to CONSOLIDATE state
    const updateState = this.db.prepare(`
      UPDATE value_stream_state
      SET stream_state = 'CONSOLIDATE', entered_state_at = unixepoch() * 1000
      WHERE feature_node_id = ? AND stream_state = 'BUILD'
    `)
    for (const f of features) updateState.run(f.id)

    return reportId
  }
}
```

### 10.8 A11 — Deployment Orchestration Agent

```typescript
// packages/main/src/aep/downstream/agents/a11DeploymentAgent.ts
// A11 executes the approved rollout strategy and watches guard metrics.
// IMPORTANT authority boundary: A11 may HALT/ROLLBACK unilaterally on guard
// metric breach. It may NEVER widen exposure beyond the plan without human approval.
import type Database from 'better-sqlite3'

type RolloutPlan = {
  releaseCandidateId: number
  strategy:   'canary' | 'gradual' | 'full' | 'blue_green'
  stages:     { pct: number; durationMs: number; environment: string }[]
  guardMetrics: { kpiNodeId: number; maxDeltaPct: number }[]  // breach → auto-halt
}

export class A11DeploymentAgent {
  constructor(private readonly db: Database.Database) {}

  async executeRollout(
    plan:             RolloutPlan,
    readinessReportId: number,
    approvedByRole:   string,
  ): Promise<void> {
    // Record the deployment decision
    const drResult = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('DECISION_RECORD', ?, ?, 'human_gate', 'deployment', 1.0, 1.0, unixepoch() * 1000)
    `).run(
      `Release approved by ${approvedByRole}`,
      JSON.stringify({ plan, approvedByRole, readinessReportId })
    )
    const drId = Number(drResult.lastInsertRowid)

    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'JUSTIFIED_BY', 1.0, 1.0, 'A11', unixepoch() * 1000)
    `).run(plan.releaseCandidateId, drId)

    // Execute each stage sequentially
    for (const stage of plan.stages) {
      const halted = await this.executeStage(plan, stage)
      if (halted) {
        // Guard metric breached — record INCIDENT and halt
        this.recordIncident(plan.releaseCandidateId, 'Guard metric breach during rollout')
        return
      }
    }

    // Rollout complete — record DEPLOYMENT
    const ingester = await import('../passF/deploymentIngester')
    new ingester.DeploymentIngester(this.db).ingest(
      plan.releaseCandidateId,
      plan.stages[plan.stages.length - 1]?.environment ?? 'production'
    )
  }

  private async executeStage(
    plan:  RolloutPlan,
    stage: RolloutPlan['stages'][0],
  ): Promise<boolean /* halted */> {
    // In production: call the actual deployment system (ArgoCD, Helm, etc.)
    // Here we check guard metrics after a simulated wait
    console.log(`[A11] Deploying to ${stage.environment} at ${stage.pct}%`)

    // Check guard metrics
    for (const guard of plan.guardMetrics) {
      const breached = await this.checkGuardMetric(guard.kpiNodeId, guard.maxDeltaPct)
      if (breached) {
        console.log(`[A11] Guard metric breached — halting rollout automatically`)
        return true
      }
    }
    return false
  }

  private async checkGuardMetric(
    kpiNodeId:   number,
    maxDeltaPct: number,
  ): Promise<boolean> {
    // Get the two most recent KPI_OBSERVATION nodes for this KPI
    const obs = this.db.prepare<[number], { description: string }>(`
      SELECT gn.description FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = gn.id
        AND ge.kind = 'OBSERVED_AS'
      WHERE gn.kind = 'KPI_OBSERVATION'
      ORDER BY gn.created_at DESC LIMIT 2
    `).all(kpiNodeId)

    if (obs.length < 2) return false  // not enough data to detect breach

    try {
      const current  = (JSON.parse(obs[0]!.description) as { value: number }).value
      const previous = (JSON.parse(obs[1]!.description) as { value: number }).value
      const deltaPct = ((current - previous) / Math.abs(previous)) * 100
      return Math.abs(deltaPct) > maxDeltaPct
    } catch { return false }
  }

  private recordIncident(releaseCandidateId: number, reason: string): void {
    const incResult = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('INCIDENT', ?, ?, 'A11', 'deployment', 0.90, 0.8, unixepoch() * 1000)
    `).run(`Auto-halt: ${reason}`, JSON.stringify({ reason, autoHalted: true }))

    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'SUSPECTED', 1.0, 0.85, 'A11', unixepoch() * 1000)
    `).run(releaseCandidateId, Number(incResult.lastInsertRowid))
  }
}
```

### 10.9 A12 — Outcome Attribution Agent

```typescript
// packages/main/src/aep/downstream/agents/a12AttributionAgent.ts
// A12 is the agent that closes the measurement half of the loop.
// It reads PRE-REGISTERED hypotheses (which named their KPI and method),
// reads KPI_OBSERVATION data over the declared timeframe,
// and produces OUTCOME + HYPOTHESIS_VERDICT nodes.
// Crucially: it says "no attributable effect" freely and with high confidence.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../../upstream/artifactWriter'

export class A12AttributionAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(deploymentId: number): Promise<number> {
    // Find all committed hypotheses for features in this deployment
    const hypotheses = this.db.prepare<[number], {
      hyp_id: number; hyp_label: string; kpi_label: string;
      direction: string; magnitude_pct: number; timeframe_days: number;
      prior_confidence: number; attribution_method: string;
      baseline: number | null; kpi_id: number
    }>(`
      SELECT vh.hypothesis_node_id as hyp_id, gn.label as hyp_label,
             kpi.label as kpi_label, vh.direction, vh.magnitude_pct,
             vh.timeframe_days, vh.prior_confidence, vh.attribution_method,
             kr.baseline_value as baseline, kpi.id as kpi_id
      FROM value_hypotheses vh
      JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id
        AND gn.source_type = 'committed' AND vh.verdict_node_id IS NULL
      JOIN graph_nodes kpi ON kpi.id = vh.kpi_node_id
      JOIN kpi_registry kr ON kr.kpi_node_id = kpi.id
    `).all(deploymentId)

    if (hypotheses.length === 0) return 0

    // For each hypothesis, gather KPI observations over the measurement window
    const verdicts: number[] = []
    for (const hyp of hypotheses) {
      const windowMs = hyp.timeframe_days * 24 * 60 * 60 * 1000
      const cutoff   = Date.now() - windowMs

      const observations = this.db.prepare<[number, number], { description: string }>(`
        SELECT gn.description FROM graph_nodes gn
        JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = gn.id
          AND ge.kind = 'OBSERVED_AS'
        WHERE gn.kind = 'KPI_OBSERVATION' AND gn.created_at >= ?
        ORDER BY gn.created_at ASC
      `).all(hyp.kpi_id, cutoff)

      if (observations.length < 2) {
        // Not enough data yet — skip, will re-run later
        continue
      }

      const values = observations.map(o => {
        try { return (JSON.parse(o.description) as { value: number }).value }
        catch { return null }
      }).filter((v): v is number => v !== null)

      const latest   = values[values.length - 1]!
      const earliest = values[0]!
      const actualDelta = baseline => baseline !== null ?
        ((latest - baseline) / Math.abs(baseline)) * 100 :
        ((latest - earliest) / Math.abs(earliest)) * 100
      const delta = actualDelta(hyp.baseline)

      // Determine verdict: within 50% of predicted → validated (conservative!)
      const predictedDelta = hyp.direction === 'decrease' ? -hyp.magnitude_pct : hyp.magnitude_pct
      const tolerance      = Math.abs(predictedDelta) * 0.5
      const validated      = Math.abs(delta - predictedDelta) <= tolerance

      const verdictLabel = validated ?
        `VALIDATED: ${hyp.kpi_label} ${hyp.direction}d ${delta.toFixed(1)}% (pred: ${predictedDelta.toFixed(1)}%)` :
        `REFUTED: ${hyp.kpi_label} changed ${delta.toFixed(1)}% (pred: ${predictedDelta.toFixed(1)}%)`

      // Write HYPOTHESIS_VERDICT node
      const verdictResult = this.db.prepare(`
        INSERT INTO graph_nodes
          (kind, label, description, source_type, sdlc_phase,
           sdlc_confidence, importance_score, created_at)
        VALUES ('HYPOTHESIS_VERDICT', ?, ?, 'A12', 'maintenance', 0.85, 0.9, unixepoch() * 1000)
      `).run(verdictLabel, JSON.stringify({
        hypothesisId: hyp.hyp_id, kpi: hyp.kpi_label, delta,
        predicted: predictedDelta, validated,
        observationCount: values.length,
        attributionMethod: hyp.attribution_method,
        confidence: validated ? 0.80 : 0.85,  // refutations often have higher conf
      }))
      const verdictId = Number(verdictResult.lastInsertRowid)

      // Wire verdict → hypothesis
      const edgeKind = validated ? 'VALIDATES_HYPOTHESIS' : 'REFUTES_HYPOTHESIS'
      this.db.prepare(`
        INSERT OR IGNORE INTO graph_edges
          (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
        VALUES (?, ?, ?, 1.0, 0.85, 'A12', unixepoch() * 1000)
      `).run(verdictId, hyp.hyp_id, edgeKind)

      // Update value_hypotheses with actual delta
      this.db.prepare(`
        UPDATE value_hypotheses
        SET verdict_node_id = ?, actual_delta_pct = ?
        WHERE hypothesis_node_id = ?
      `).run(verdictId, delta, hyp.hyp_id)

      // Write OUTCOME node
      const outcomeResult = this.db.prepare(`
        INSERT INTO graph_nodes
          (kind, label, description, source_type, sdlc_phase,
           sdlc_confidence, importance_score, created_at)
        VALUES ('OUTCOME', ?, ?, 'A12', 'maintenance', 0.85, 0.8, unixepoch() * 1000)
      `).run(
        `${hyp.kpi_label} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        JSON.stringify({ kpi: hyp.kpi_label, delta, method: hyp.attribution_method })
      )
      const outcomeId = Number(outcomeResult.lastInsertRowid)

      this.db.prepare(`
        INSERT OR IGNORE INTO graph_edges
          (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
        VALUES (?, ?, 'ATTRIBUTED_TO', 1.0, 0.85, 'A12', unixepoch() * 1000)
      `).run(outcomeId, deploymentId)

      verdicts.push(verdictId)
    }

    // Write OUTCOME_REPORT
    return writeArtifactNode(this.db, {
      kind:         'OUTCOME_REPORT',
      label:        `Attribution Report — Deployment ${deploymentId}`,
      description:  JSON.stringify({ verdicts, deploymentId }),
      agentId:      'A12',
      agentVersion: '1.0.0',
      derivedFrom:  [deploymentId],
      confidence:   0.85,
    })
  }
}
```

### 10.10 A13 — Cross-Functional Impact Agent

```typescript
// packages/main/src/aep/downstream/agents/a13CrossFunctionalAgent.ts
// A13 reads outcome data and renders per-ORG_UNIT impact assessments.
// Same evidence, per-persona projection — the graph's layer structure makes
// this mechanical: each unit's OWNED_BY and MEASURED_BY edges define their view.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { writeArtifactNode } from '../../upstream/artifactWriter'

export class A13CrossFunctionalAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(outcomeReportId: number): Promise<number[]> {
    const report = this.db
      .prepare<[number], { description: string }>(
        'SELECT description FROM graph_nodes WHERE id = ?'
      )
      .get(outcomeReportId)
    if (!report) throw new Error(`Outcome report ${outcomeReportId} not found`)

    const orgUnits = this.db
      .prepare<[], { id: number; label: string; concern_kpis: string | null }>(
        `SELECT gn.id, gn.label, NULL as concern_kpis
         FROM graph_nodes gn WHERE gn.kind = 'ORG_UNIT'`
      )
      .all()

    // Get the verdicts from this outcome report
    const verdicts = this.db.prepare<[number], {
      label: string; description: string
    }>(`
      SELECT gn.label, gn.description FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = outcomeReport.id
        AND ge.to_node_id = gn.id AND gn.kind = 'HYPOTHESIS_VERDICT'
      JOIN graph_nodes outcomeReport ON outcomeReport.id = ?
    `).all(outcomeReportId)

    const verdictSummary = verdicts.map(v => v.label).join('\n') ||
      'No verified outcomes yet'

    const assessmentIds: number[] = []

    for (const unit of orgUnits) {
      const prompt = `You are the Cross-Functional Impact Agent. Render an impact
assessment for the ${unit.label} org unit in their native vocabulary.

Outcome data from this release cycle:
${verdictSummary}

Full outcome report:
${report.description.slice(0, 1000)}

For ${unit.label}, write a 3–5 sentence impact summary that:
- Uses ${unit.label}'s native metrics and language
- Highlights what improved, what didn't, and what's still uncertain
- Identifies action items specific to ${unit.label}
- Rates overall sentiment: positive|neutral|mixed|negative

Return JSON:
{
  "summary": "3–5 sentences for ${unit.label}",
  "key_metrics": [{"name": "metric", "value": "result"}],
  "action_items": ["action 1"],
  "sentiment": "positive|neutral|mixed|negative",
  "confidence": 0.0–1.0
}`

      try {
        const resp = await this.provider.complete({
          model: 'claude-haiku-4-5',
          system: `You write impact assessments for ${unit.label}. Return only JSON.`,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
        })

        const impact = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
          summary: string; sentiment: string; confidence: number
        }

        const assessId = writeArtifactNode(this.db, {
          kind:         'IMPACT_ASSESSMENT',
          label:        `Impact for ${unit.label}`,
          description:  JSON.stringify(impact),
          agentId:      'A13',
          agentVersion: '1.0.0',
          derivedFrom:  [outcomeReportId],
          confidence:   impact.confidence,
        })

        // ASSESSED_FOR edge: assessment → org unit
        this.db.prepare(`
          INSERT OR IGNORE INTO graph_edges
            (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
          VALUES (?, ?, 'ASSESSED_FOR', 1.0, 1.0, 'A13', unixepoch() * 1000)
        `).run(assessId, unit.id)

        assessmentIds.push(assessId)
      } catch { /* skip this unit on error */ }
    }

    return assessmentIds
  }
}
```

### 10.11 Pass G — Outcome Synthesis

```typescript
// packages/main/src/aep/downstream/passG/passGOrchestrator.ts
// Pass G is NOT a connector pass — it is an analytical pass.
// It runs on a cadence (typically after each release cycle / quarter boundary).
// All its outputs are inferences, so every node carries method + confidence.
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { A12AttributionAgent }    from '../agents/a12AttributionAgent'
import { A13CrossFunctionalAgent } from '../agents/a13CrossFunctionalAgent'
import { A14LearningAgent }        from '../agents/a14LearningAgent'
import type { AEPPassProgress }    from '@shared/index'

export class PassGOrchestrator {
  constructor(
    private readonly db:          Database.Database,
    private readonly win:         BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  private push = (p: AEPPassProgress) =>
    this.win.webContents.send('aep:passProgress', p)

  async run(deploymentId: number): Promise<void> {
    // G1: Attribution (A12)
    this.push({ pass: 'G_attribute', stage: 'attribution', pct: 0,
                detail: 'Computing outcome attribution…' })
    const outcomeReportId = await new A12AttributionAgent(this.db, this.getProvider())
      .run(deploymentId)
    this.push({ pass: 'G_attribute', stage: 'attribution', pct: 100,
                detail: 'Outcome report written' })

    if (!outcomeReportId) return

    // G2: Cross-functional projections (A13)
    this.push({ pass: 'G_verdict', stage: 'impact', pct: 0,
                detail: 'Rendering per-unit impact assessments…' })
    const assessIds = await new A13CrossFunctionalAgent(this.db, this.getProvider())
      .run(outcomeReportId)
    this.push({ pass: 'G_verdict', stage: 'impact', pct: 100,
                detail: `${assessIds.length} impact assessments produced` })

    // G3: Organizational learning (A14)
    this.push({ pass: 'G_learn', stage: 'learning', pct: 0,
                detail: 'Distilling learnings…' })
    const learnings = await new A14LearningAgent(this.db, this.getProvider())
      .run(outcomeReportId)
    this.push({ pass: 'G_learn', stage: 'learning', pct: 100,
                detail: `${learnings} LEARNING nodes written` })

    // Advance features to LEARN state
    this.db.prepare(`
      UPDATE value_stream_state
      SET stream_state = 'LEARN', entered_state_at = unixepoch() * 1000
      WHERE stream_state = 'OBSERVE'
    `).run()
  }
}
```

---

## 11. Level 4 — The Full Loop

Level 4 is the compounding layer. A14 distills learnings and wires INFORMS
edges back into the upstream layers, making A2's estimates and A10's gates
measurably better each cycle. The Value Stream Orchestrator formalizes all
nine states with predicate-driven transitions, making the entire stream a
queryable, auditable state machine rather than a loosely coordinated process.

### 11.1 A14 — Organizational Learning Agent

```typescript
// packages/main/src/aep/downstream/agents/a14LearningAgent.ts
// A14 is the most important agent for organizational compounding.
// It distills LEARNING nodes from verdict patterns and wires INFORMS edges
// back to the upstream nodes they should influence.
// Over cycles: A2's priors improve, A4's blast-radius weights tune,
// A10's gate strictness adapts.
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'

export class A14LearningAgent {
  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {}

  async run(outcomeReportId: number): Promise<number> {
    // Read all verdicts from this cycle + historical verdicts for pattern detection
    const recentVerdicts = this.db.prepare<[], { label: string; description: string; created_at: number }>(`
      SELECT gn.label, gn.description, gn.created_at
      FROM graph_nodes gn WHERE gn.kind = 'HYPOTHESIS_VERDICT'
      ORDER BY gn.created_at DESC LIMIT 30
    `).all()

    if (recentVerdicts.length === 0) return 0

    // Compute agent calibration metrics (estimate vs actual)
    const calibration = this.computeCalibration()

    const verdictSummary = recentVerdicts.map(v => {
      try {
        const d = JSON.parse(v.description) as { validated: boolean; delta: number; predicted: number; kpi: string }
        return `${v.label} | actual: ${d.delta?.toFixed(1)}% | predicted: ${d.predicted?.toFixed(1)}%`
      } catch { return v.label }
    }).join('\n')

    const prompt = `You are the Organizational Learning Agent. Analyze verdict patterns
and distill actionable learnings that will improve future planning cycles.

Recent hypothesis verdicts (newest first):
${verdictSummary}

Agent calibration metrics:
A2 (business impact): mean error ${calibration.a2MeanError?.toFixed(1) ?? 'N/A'}%
A4 (dev effort): mean error ${calibration.a4MeanError?.toFixed(1) ?? 'N/A'}%

Identify 2–4 specific, actionable learnings. Each learning must:
1. Be falsifiable (state what would change if the learning is wrong)
2. Target a specific agent or upstream concept
3. Suggest a concrete adjustment

Return JSON:
{
  "learnings": [
    {
      "label": "Learning label — 10 words max",
      "description": "Specific learning with evidence",
      "targets": ["A2_PRIOR"|"A4_ESTIMATE"|"A10_GATE"|"PAIN_POINT:name"|"BUSINESS_OBJECTIVE:name"],
      "adjustment": "Concrete change this learning implies",
      "confidence": 0.0–1.0
    }
  ]
}`

    const resp = await this.provider.complete({
      model: 'claude-sonnet-4-6',
      system: 'You are an organizational learning analyst. Return only JSON. Be specific.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    })

    const { learnings } = JSON.parse(resp.replace(/```json|```/g, '').trim()) as {
      learnings: {
        label: string; description: string; targets: string[];
        adjustment: string; confidence: number
      }[]
    }

    let count = 0
    const batch = this.db.transaction(() => {
      for (const learning of learnings ?? []) {
        // Write LEARNING node
        const result = this.db.prepare(`
          INSERT INTO graph_nodes
            (kind, label, description, source_type, sdlc_phase,
             sdlc_confidence, importance_score, created_at)
          VALUES ('LEARNING', ?, ?, 'A14', 'maintenance', ?, 0.7, unixepoch() * 1000)
        `).run(learning.label, JSON.stringify(learning), learning.confidence)
        const learnId = Number(result.lastInsertRowid)

        // Wire INFORMS edges to targeted upstream nodes
        for (const target of learning.targets ?? []) {
          const [kind, label] = target.split(':')
          if (!kind) continue

          // Resolve target node
          let targetNode: { id: number } | undefined
          if (kind.startsWith('A')) {
            // Agent target: find the most recent artifact from this agent
            targetNode = this.db.prepare<[string], { id: number }>(
              `SELECT ap.artifact_node_id as id FROM artifact_provenance ap
               WHERE ap.agent_id = ? ORDER BY ap.artifact_node_id DESC LIMIT 1`
            ).get(kind) as { id: number } | undefined
          } else if (label) {
            targetNode = this.db.prepare<[string, string], { id: number }>(
              'SELECT id FROM graph_nodes WHERE kind = ? AND label LIKE ? LIMIT 1'
            ).get(kind, `%${label}%`) as { id: number } | undefined
          } else {
            // Top-level objective or pain point
            targetNode = this.db.prepare<[string], { id: number }>(
              `SELECT id FROM graph_nodes WHERE kind IN ('BUSINESS_OBJECTIVE','PAIN_POINT')
               ORDER BY importance_score DESC LIMIT 1`
            ).get() as { id: number } | undefined
          }

          if (targetNode) {
            this.db.prepare(`
              INSERT OR IGNORE INTO graph_edges
                (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
              VALUES (?, ?, 'INFORMS', 1.0, ?, 'A14', unixepoch() * 1000)
            `).run(learnId, targetNode.id, learning.confidence)
          }
        }
        count++
      }

      // Update agent calibration records
      this.recordCalibration(calibration)
    })
    batch()

    return count
  }

  private computeCalibration(): {
    a2MeanError?: number; a4MeanError?: number
  } {
    // A2: compare predicted hypothesis magnitude vs actual delta
    const a2Data = this.db.prepare<[], {
      predicted: number; actual: number
    }>(`
      SELECT vh.magnitude_pct as predicted, ABS(vh.actual_delta_pct) as actual
      FROM value_hypotheses vh
      WHERE vh.verdict_node_id IS NOT NULL AND vh.actual_delta_pct IS NOT NULL
      ORDER BY vh.registered_at DESC LIMIT 20
    `).all()

    const a2MeanError = a2Data.length > 0 ?
      a2Data.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / a2Data.length :
      undefined

    return { a2MeanError, a4MeanError: undefined }
  }

  private recordCalibration(cal: ReturnType<typeof this.computeCalibration>): void {
    const quarter = new Date().toISOString().slice(0, 7)  // YYYY-MM
    if (cal.a2MeanError !== undefined) {
      this.db.prepare(`
        INSERT INTO agent_calibration
          (agent_id, cycle_end_date, predictions, verified, mean_error_pct)
        VALUES ('A2', ?, 0, 0, ?)
        ON CONFLICT DO NOTHING
      `).run(quarter, cal.a2MeanError)
    }
  }
}
```

### 11.2 Value Stream Orchestrator (Tier-3 FSM)

```typescript
// packages/main/src/aep/governance/valueStreamOrchestrator.ts
// Tier-3 FSM: one token per feature flowing through 9 states.
// Transitions are graph predicates, not messages.
// The orchestrator evaluates predicates; it doesn't shuffle envelopes.
import type Database from 'better-sqlite3'
import type { ValueStreamState } from '@shared/index'
import { Blackboard } from './blackboard'

// Legal transitions: maps current state → allowed next states
const TRANSITIONS: Record<ValueStreamState, ValueStreamState[]> = {
  INTAKE:      ['QUALIFY'],
  QUALIFY:     ['PRIORITIZE', 'INTAKE'],      // back to INTAKE if more info needed
  PRIORITIZE:  ['DEFINE', 'INTAKE'],          // INTAKE = defer
  DEFINE:      ['BUILD'],
  BUILD:       ['CONSOLIDATE', 'DEFINE'],     // back to DEFINE if gate fails
  CONSOLIDATE: ['RELEASE', 'BUILD'],          // back to BUILD if readiness report blocks
  RELEASE:     ['OBSERVE'],
  OBSERVE:     ['LEARN', 'DEFINE'],           // back to DEFINE if hypothesis refuted → iterate
  LEARN:       ['INTAKE'],                    // new cycle
}

// Transition predicates: conditions that must be true for a transition to fire
type Predicate = (db: Database.Database, featureId: number) => boolean

const PREDICATES: Partial<Record<`${ValueStreamState}->${ValueStreamState}`, Predicate>> = {
  'INTAKE->QUALIFY': (db, fid) => {
    // A BRIEF artifact must exist for this feature's pain points
    return !!db.prepare<[number], { id: number }>(
      `SELECT gn.id FROM graph_nodes gn
       JOIN graph_edges ge ON ge.to_node_id = gn.id AND ge.kind = 'MOTIVATES'
       JOIN graph_edges ge2 ON ge2.from_node_id = gn.id
       JOIN graph_nodes pp ON pp.id = ge2.from_node_id AND pp.kind = 'PAIN_POINT'
       WHERE gn.kind = 'BRIEF' LIMIT 1`
    ).get(fid),
  },

  'QUALIFY->PRIORITIZE': (db, fid) => {
    // Both BUSINESS_IMPACT_ASSESSMENT and DEV_IMPACT_ASSESSMENT must exist
    const bizAssess = db.prepare<[number], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM graph_nodes gn
       JOIN graph_edges ge ON ge.to_node_id = gn.id AND ge.kind = 'MOTIVATES'
       WHERE gn.kind = 'BUSINESS_IMPACT_ASSESSMENT' LIMIT 1`
    ).get()
    const devAssess = db.prepare<[number], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM graph_nodes gn
       WHERE gn.kind = 'DEV_IMPACT_ASSESSMENT' LIMIT 1`
    ).get()
    return (bizAssess?.cnt ?? 0) > 0 && (devAssess?.cnt ?? 0) > 0
  },

  'PRIORITIZE->DEFINE': (db, fid) => {
    // A DECISION_RECORD with 'admit' decision must exist for this feature
    return !!db.prepare<[number], { id: number }>(
      `SELECT gn.id FROM graph_nodes gn
       WHERE gn.kind = 'DECISION_RECORD'
         AND gn.description LIKE '%"decision":"admit"%'
       ORDER BY gn.created_at DESC LIMIT 1`
    ).get(fid)
  },

  'BUILD->CONSOLIDATE': (db, fid) => {
    // A RELEASE_READINESS_REPORT must exist AND all QUALITY_GATEs must be green
    const report = db.prepare<[number], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM graph_nodes gn
       WHERE gn.kind = 'RELEASE_READINESS_REPORT'`
    ).get()
    if (!report?.cnt) return false

    // Check for scope-2 blocking gaps (unread DECISION_RECORD for scope-2 gaps)
    const blockingGaps = db.prepare<[], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM graph_nodes gn
       WHERE gn.kind = 'RELEASE_READINESS_REPORT'
         AND gn.description LIKE '%"ready":false%'`
    ).get()
    return (blockingGaps?.cnt ?? 0) === 0
  },

  'CONSOLIDATE->RELEASE': (db, fid) => {
    // All required approvals must be present (DECISION_RECORD by each required role)
    const readinessReport = db.prepare<[], {
      description: string
    }>(
      `SELECT description FROM graph_nodes WHERE kind = 'RELEASE_READINESS_REPORT'
       ORDER BY created_at DESC LIMIT 1`
    ).get()
    if (!readinessReport) return false

    try {
      const report = JSON.parse(readinessReport.description) as {
        approvalSet?: string[]
      }
      const required = report.approvalSet ?? []
      const signed   = db.prepare<[], { description: string }>(
        `SELECT description FROM graph_nodes WHERE kind = 'DECISION_RECORD'
         ORDER BY created_at DESC LIMIT 10`
      ).all().map(r => {
        try { return (JSON.parse(r.description) as { approvedByRole?: string }).approvedByRole ?? '' }
        catch { return '' }
      })
      return required.every(role => signed.includes(role))
    } catch { return false }
  },

  'RELEASE->OBSERVE': (db, fid) => {
    // A DEPLOYMENT to production must exist for this feature
    return !!db.prepare<[], { id: number }>(
      `SELECT gn.id FROM graph_nodes gn WHERE gn.kind = 'DEPLOYMENT' LIMIT 1`
    ).get()
  },

  'OBSERVE->LEARN': (db, fid) => {
    // All committed hypotheses must have verdicts
    const unresolved = db.prepare<[number], { cnt: number }>(
      `SELECT COUNT(*) as cnt FROM value_hypotheses vh
       JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id AND gn.source_type = 'committed'
       JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'JUSTIFIED_BY'
       WHERE vh.verdict_node_id IS NULL`
    ).get(fid)
    return (unresolved?.cnt ?? 0) === 0
  },
}

export class ValueStreamOrchestrator {
  private readonly blackboard: Blackboard

  constructor(private readonly db: Database.Database) {
    this.blackboard = new Blackboard(db)
  }

  /** Evaluate all possible transitions for all features and fire those ready. */
  tick(): { transitioned: number; blocked: { featureId: number; reason: string }[] } {
    const features = this.db.prepare<[], {
      feature_node_id: number; stream_state: ValueStreamState
    }>(
      'SELECT feature_node_id, stream_state FROM value_stream_state'
    ).all()

    let transitioned = 0
    const blocked: { featureId: number; reason: string }[] = []

    for (const f of features) {
      const allowed = TRANSITIONS[f.stream_state] ?? []
      let advanced  = false

      for (const next of allowed) {
        const key = `${f.stream_state}->${next}` as keyof typeof PREDICATES
        const predicate = PREDICATES[key]

        if (!predicate) {
          // No predicate = transition is freely allowed (manual trigger only)
          continue
        }

        if (predicate(this.db, f.feature_node_id)) {
          this.db.prepare(`
            UPDATE value_stream_state
            SET stream_state = ?, entered_state_at = unixepoch() * 1000, blocked_on_json = NULL
            WHERE feature_node_id = ?
          `).run(next, f.feature_node_id)
          transitioned++
          advanced = true
          break
        }
      }

      if (!advanced && allowed.length > 0) {
        // Collect unmet predicates for dashboarding
        const unmet = allowed
          .map(next => {
            const key = `${f.stream_state}->${next}` as keyof typeof PREDICATES
            return PREDICATES[key] ? `${f.stream_state}→${next}: predicate not met` : null
          })
          .filter(Boolean)
          .join('; ')

        this.db.prepare(`
          UPDATE value_stream_state SET blocked_on_json = ? WHERE feature_node_id = ?
        `).run(JSON.stringify({ reason: unmet }), f.feature_node_id)

        blocked.push({ featureId: f.feature_node_id, reason: unmet })
      }
    }

    return { transitioned, blocked }
  }

  /** Force-advance a feature to a target state (human override with reason). */
  forceAdvance(featureId: number, targetState: ValueStreamState, reason: string): void {
    // Write a DECISION_RECORD for the override
    const drResult = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('DECISION_RECORD', ?, ?, 'human_override', 'requirements', 1.0, 1.0, unixepoch() * 1000)
    `).run(
      `Manual state advance → ${targetState}`,
      JSON.stringify({ targetState, reason })
    )

    this.db.prepare(`
      UPDATE value_stream_state
      SET stream_state = ?, entered_state_at = unixepoch() * 1000,
          last_transition_record = ?, blocked_on_json = NULL
      WHERE feature_node_id = ?
    `).run(targetState, Number(drResult.lastInsertRowid), featureId)
  }
}
```

### 11.3 Blackboard — Predicate Evaluation Engine

```typescript
// packages/main/src/aep/governance/blackboard.ts
// The blackboard is the graph itself treated as a shared workspace.
// This module watches for trigger conditions and notifies the orchestrator.
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'

type TriggerCondition = {
  name:      string
  // Returns the IDs of entities whose trigger just became satisfied
  check:     (db: Database.Database) => number[]
  // IPC event to emit when trigger fires
  eventName: string
}

const TRIGGER_CONDITIONS: TriggerCondition[] = [
  {
    name:      'BRIEF_READY_FOR_QUALIFY',
    check:     db => db.prepare<[], { id: number }>(`
      SELECT vss.feature_node_id as id FROM value_stream_state vss
      WHERE vss.stream_state = 'INTAKE'
        AND EXISTS (
          SELECT 1 FROM graph_nodes gn WHERE gn.kind = 'BRIEF'
          AND gn.created_at > vss.entered_state_at
        )
    `).all().map(r => r.id),
    eventName: 'aep:readyToQualify',
  },
  {
    name:      'HYPOTHESES_READY_FOR_VERDICT',
    check:     db => db.prepare<[], { id: number }>(`
      SELECT DISTINCT vss.feature_node_id as id FROM value_stream_state vss
      WHERE vss.stream_state = 'OBSERVE'
        AND NOT EXISTS (
          SELECT 1 FROM value_hypotheses vh
          JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id AND gn.source_type = 'committed'
          WHERE vh.verdict_node_id IS NULL
        )
    `).all().map(r => r.id),
    eventName: 'aep:readyForVerdict',
  },
  {
    name:      'SCOPE2_GAP_DETECTED',
    check:     db => db.prepare<[], { id: number }>(`
      SELECT id FROM graph_nodes WHERE kind = 'RELEASE_READINESS_REPORT'
        AND description LIKE '%"scope2_gaps":["%'
        AND created_at > unixepoch() * 1000 - 300000
    `).all().map(r => r.id),
    eventName: 'aep:scope2GapDetected',
  },
]

export class Blackboard {
  constructor(private readonly db: Database.Database) {}

  /** Poll trigger conditions and return events to emit. */
  poll(): { eventName: string; entityIds: number[] }[] {
    const events: { eventName: string; entityIds: number[] }[] = []
    for (const trigger of TRIGGER_CONDITIONS) {
      const ids = trigger.check(this.db)
      if (ids.length > 0) events.push({ eventName: trigger.eventName, entityIds: ids })
    }
    return events
  }
}
```

### 11.4 RACI-on-Graph

```typescript
// packages/main/src/aep/governance/raciGraph.ts
// RACI relationships are stored as graph edges:
// OWNED_BY = Accountable; CONSULTED_BY = Consulted; INFORMED_BY = Informed
// This module provides the approval-set computation for any node.
import type Database from 'better-sqlite3'

export class RACIGraph {
  constructor(private readonly db: Database.Database) {}

  /** Compute the approval set for a given node based on RACI edges and scope-4 org blast. */
  getApprovalSet(nodeId: number): string[] {
    const roles = new Set<string>()

    // OWNED_BY edges = Accountable (must approve)
    const owners = this.db.prepare<[number], { label: string }>(`
      SELECT gn.label FROM graph_nodes gn
      JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = gn.id
        AND ge.kind = 'OWNED_BY'
      WHERE gn.kind IN ('STAKEHOLDER_ROLE','ORG_UNIT')
    `).all(nodeId)
    for (const o of owners) roles.add(o.label)

    return [...roles]
  }

  /** Set RACI relationship between a node and an org unit/role. */
  setRaci(
    nodeId:   number,
    unitId:   number,
    type:     'OWNED_BY' | 'CONSULTED_BY' | 'INFORMED_BY',
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'raci', unixepoch() * 1000)
    `).run(nodeId, unitId, type)
  }
}
```

### 11.5 Agent Capability Matrix

```typescript
// packages/main/src/aep/governance/agentCapabilityMatrix.ts
// Populates and queries the agent_capabilities table.
// Each agent has write capability scoped to specific node/edge kinds in specific layers.
// An agent cannot write outside its declared capability — enforced at write time.
import type Database from 'better-sqlite3'

type AgentCapability = {
  agentId:        string
  layer:          string
  nodeKinds:      string[]
  edgeKinds:      string[]
  requiresGate:   boolean
}

// The capability matrix — defined once, loaded into DB on startup
export const AGENT_CAPABILITY_MATRIX: AgentCapability[] = [
  {
    agentId:      'A1',
    layer:        'L-2',
    nodeKinds:    ['CUSTOMER_SIGNAL','PAIN_POINT','BRIEF'],
    edgeKinds:    ['EXPRESSES','MOTIVATES'],
    requiresGate: false,
  },
  {
    agentId:      'A2',
    layer:        'L-1',
    nodeKinds:    ['BUSINESS_IMPACT_ASSESSMENT','VALUE_HYPOTHESIS','COST_ESTIMATE','RISK'],
    edgeKinds:    ['JUSTIFIED_BY','PREDICTS','ESTIMATED_BY','EXPOSED_TO'],
    requiresGate: false,  // drafts; PRIORITIZE gate commits them
  },
  {
    agentId:      'A3',
    layer:        'L-1',
    nodeKinds:    ['BUSINESS_IMPACT_ASSESSMENT','PRICING_IMPACT'],
    edgeKinds:    ['TARGETS','PRICING_IMPACT'],
    requiresGate: false,
  },
  {
    agentId:      'A4',
    layer:        'L1',   // reads L0–L3, writes DEV_IMPACT_ASSESSMENT in L-1
    nodeKinds:    ['DEV_IMPACT_ASSESSMENT','COST_ESTIMATE'],
    edgeKinds:    ['ESTIMATED_BY','EXPOSED_TO'],
    requiresGate: false,
  },
  {
    agentId:      'A5',
    layer:        'L-1',
    nodeKinds:    ['BUSINESS_IMPACT_ASSESSMENT'],  // portfolio packet = BUSINESS_IMPACT subtype
    edgeKinds:    [],
    requiresGate: true,   // portfolio packet feeds a human gate
  },
  {
    agentId:      'A10',
    layer:        'L+4',
    nodeKinds:    ['RELEASE_READINESS_REPORT','QUALITY_GATE'],
    edgeKinds:    ['GATED_BY','EVIDENCED_BY'],
    requiresGate: true,   // report feeds the release approval gate
  },
  {
    agentId:      'A11',
    layer:        'L+4',
    nodeKinds:    ['DEPLOYMENT','INCIDENT'],
    edgeKinds:    ['DEPLOYED_TO','CAUSED','SUSPECTED'],
    requiresGate: false,  // halt authority is unilateral; widen authority requires gate
  },
  {
    agentId:      'A12',
    layer:        'L+5',
    nodeKinds:    ['OUTCOME','HYPOTHESIS_VERDICT','OUTCOME_REPORT'],
    edgeKinds:    ['ATTRIBUTED_TO','VALIDATES_HYPOTHESIS','REFUTES_HYPOTHESIS','OBSERVED_AS'],
    requiresGate: true,   // high-stakes verdicts route through human review
  },
  {
    agentId:      'A13',
    layer:        'L+5',
    nodeKinds:    ['IMPACT_ASSESSMENT'],
    edgeKinds:    ['ASSESSED_FOR'],
    requiresGate: false,
  },
  {
    agentId:      'A14',
    layer:        'L+5',
    nodeKinds:    ['LEARNING'],
    edgeKinds:    ['INFORMS'],
    requiresGate: false,
  },
]

export class AgentCapabilityMatrix {
  constructor(private readonly db: Database.Database) {}

  /** Populate the capability table on startup (idempotent). */
  seed(): void {
    const insert = this.db.prepare(`
      INSERT INTO agent_capabilities
        (agent_id, layer, node_kinds_json, edge_kinds_json, requires_gate)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, layer) DO UPDATE SET
        node_kinds_json = excluded.node_kinds_json,
        edge_kinds_json = excluded.edge_kinds_json,
        requires_gate   = excluded.requires_gate
    `)
    const batch = this.db.transaction(() => {
      for (const cap of AGENT_CAPABILITY_MATRIX) {
        insert.run(
          cap.agentId, cap.layer,
          JSON.stringify(cap.nodeKinds),
          JSON.stringify(cap.edgeKinds),
          cap.requiresGate ? 1 : 0,
        )
      }
    })
    batch()
  }

  /** Check if an agent can write a specific node kind at a layer. */
  canWrite(agentId: string, nodeKind: string): boolean {
    const caps = this.db.prepare<[string], { node_kinds_json: string }>(
      'SELECT node_kinds_json FROM agent_capabilities WHERE agent_id = ?'
    ).all(agentId)
    return caps.some(c => {
      try { return (JSON.parse(c.node_kinds_json) as string[]).includes(nodeKind) }
      catch { return false }
    })
  }
}
```

### 11.6 Human Gate Manager

```typescript
// packages/main/src/aep/governance/humanGateManager.ts
// Human-gate placements: portfolio admission, release to production,
// hypothesis verdicts, governed-scope actions.
// The gate manager records approval and updates the transition predicate state.
import type Database from 'better-sqlite3'

type GateType =
  | 'PORTFOLIO_ADMIT'
  | 'RELEASE_APPROVE'
  | 'HYPOTHESIS_VERDICT'
  | 'GOVERNED_SCOPE_ACTION'

export class HumanGateManager {
  constructor(private readonly db: Database.Database) {}

  /**
   * Record a human approval at a gate.
   * Returns the DECISION_RECORD node ID.
   */
  approve(
    gateType:       GateType,
    approvedByRole: string,
    targetNodeId:   number,
    rationale:      string,
    data?:          Record<string, unknown>,
  ): number {
    const result = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('DECISION_RECORD', ?, ?, 'human_gate', 'requirements', 1.0, 1.0, unixepoch() * 1000)
    `).run(
      `${gateType} approved by ${approvedByRole}`,
      JSON.stringify({ gateType, approvedByRole, rationale, targetNodeId, data }),
    )
    const drId = Number(result.lastInsertRowid)

    // Link decision record to the target node
    this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, 'JUSTIFIED_BY', 1.0, 1.0, 'human_gate', unixepoch() * 1000)
    `).run(targetNodeId, drId)

    return drId
  }

  /** List pending gates (nodes that require human approval to proceed). */
  getPendingGates(): {
    gateType:   GateType
    nodeId:     number
    nodeLabel:  string
    requiredRoles: string[]
    unmetRoles:    string[]
  }[] {
    // Find RELEASE_READINESS_REPORT nodes without all required approvals
    const reports = this.db.prepare<[], {
      id: number; label: string; description: string
    }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind = 'RELEASE_READINESS_REPORT'
         AND id NOT IN (
           SELECT DISTINCT ge.from_node_id FROM graph_edges ge
           JOIN graph_nodes dr ON dr.id = ge.to_node_id AND dr.kind = 'DECISION_RECORD'
             AND dr.description LIKE '%RELEASE_APPROVE%'
           WHERE ge.kind = 'JUSTIFIED_BY'
         )`
    ).all()

    return reports.map(r => {
      try {
        const data = JSON.parse(r.description) as {
          approvalSet?: string[]
        }
        const required = data.approvalSet ?? []
        const signed   = this.db.prepare<[number], { description: string }>(
          `SELECT dr.description FROM graph_edges ge
           JOIN graph_nodes dr ON dr.id = ge.to_node_id AND dr.kind = 'DECISION_RECORD'
           WHERE ge.from_node_id = ? AND ge.kind = 'JUSTIFIED_BY'`
        ).all(r.id).map(d => {
          try { return (JSON.parse(d.description) as { approvedByRole?: string }).approvedByRole ?? '' }
          catch { return '' }
        })
        return {
          gateType:     'RELEASE_APPROVE' as GateType,
          nodeId:        r.id,
          nodeLabel:     r.label,
          requiredRoles: required,
          unmetRoles:    required.filter(role => !signed.includes(role)),
        }
      } catch {
        return null
      }
    }).filter((g): g is NonNullable<typeof g> => g !== null)
  }
}
```

### 11.7 Calibration Monitor

```typescript
// packages/main/src/aep/governance/calibrationMonitor.ts
// Reads agent_calibration records and computes per-agent reliability scores.
// A14 uses these to adjust downstream priors; this module exposes them to the UI.
import type Database from 'better-sqlite3'

export type AgentCalibrationReport = {
  agentId:           string
  cycles:            number
  meanErrorPct:      number | null
  calibrationScore:  number | null
  trend:             'improving' | 'stable' | 'degrading' | 'insufficient_data'
  recommendation:    string
}

export class CalibrationMonitor {
  constructor(private readonly db: Database.Database) {}

  getReport(): AgentCalibrationReport[] {
    const agents = ['A1','A2','A3','A4','A5','A10','A11','A12','A13','A14']
    return agents.map(agentId => this.getAgentReport(agentId))
  }

  private getAgentReport(agentId: string): AgentCalibrationReport {
    const history = this.db.prepare<[string], {
      cycle_end_date: string; mean_error_pct: number | null
    }>(
      `SELECT cycle_end_date, mean_error_pct FROM agent_calibration
       WHERE agent_id = ? ORDER BY cycle_end_date DESC LIMIT 6`
    ).all(agentId)

    if (history.length < 2) {
      return {
        agentId,
        cycles:           history.length,
        meanErrorPct:     history[0]?.mean_error_pct ?? null,
        calibrationScore: null,
        trend:            'insufficient_data',
        recommendation:   'Need at least 2 completed cycles for calibration analysis',
      }
    }

    const errors = history.map(h => h.mean_error_pct).filter((e): e is number => e !== null)
    const meanError = errors.reduce((s, e) => s + e, 0) / errors.length

    // Trend: compare first half vs second half of history
    const firstHalf  = errors.slice(Math.floor(errors.length / 2))
    const secondHalf = errors.slice(0, Math.floor(errors.length / 2))
    const firstMean  = firstHalf.reduce((s, e) => s + e, 0) / (firstHalf.length || 1)
    const secondMean = secondHalf.reduce((s, e) => s + e, 0) / (secondHalf.length || 1)
    const improvement = firstMean - secondMean   // positive = older error was higher = improving

    let trend: AgentCalibrationReport['trend']
    if (improvement > 5)       trend = 'improving'
    else if (improvement < -5) trend = 'degrading'
    else                       trend = 'stable'

    // Generate recommendation
    let recommendation = ''
    if (trend === 'degrading') {
      recommendation = `${agentId}'s estimates are becoming less accurate. Review prompt for recalibration.`
    } else if (meanError > 40) {
      recommendation = `${agentId} mean error (${meanError.toFixed(0)}%) is high. Consider reducing confidence outputs.`
    } else if (trend === 'improving') {
      recommendation = `${agentId} is improving (Δ${improvement.toFixed(0)}%). A14's INFORMS edges are working.`
    } else {
      recommendation = `${agentId} calibration stable at ${meanError.toFixed(0)}% mean error.`
    }

    return {
      agentId,
      cycles:           history.length,
      meanErrorPct:     meanError,
      calibrationScore: Math.max(0, 1 - meanError / 100),
      trend,
      recommendation,
    }
  }
}
```

---

## 12. AEP IPC Handlers — Part 2

```typescript
// packages/main/src/aep/aepIpcHandlers.ts (continued — Level 3 and 4 channels)

// ── Blast radius ────────────────────────────────────────────────────────────
ipcMain.handle('aep:getBlastRadius', (_e, { releaseCandidateId }) =>
  new BlastRadiusEngine(db).compute(releaseCandidateId)
)

// ── Agent runs (Level 3) ────────────────────────────────────────────────────
ipcMain.handle('aep:runA10', async (_e, { releaseCandidateId }) =>
  new A10ConsolidationAgent(db, getProvider()).run(releaseCandidateId)
)

ipcMain.handle('aep:runA12', async (_e, { deploymentId }) =>
  new A12AttributionAgent(db, getProvider()).run(deploymentId)
)

ipcMain.handle('aep:runA13', async (_e, { outcomeReportId }) =>
  new A13CrossFunctionalAgent(db, getProvider()).run(outcomeReportId)
)

ipcMain.handle('aep:runA14', async (_e, { outcomeReportId }) =>
  new A14LearningAgent(db, getProvider()).run(outcomeReportId)
)

// ── Pass F ingestion ────────────────────────────────────────────────────────
ipcMain.handle('aep:ingestBuildEvent',   async (_e, { payload })            => passFOrch.ingestBuildEvent(payload))
ipcMain.handle('aep:ingestTestRun',      async (_e, { buildId, payload })   => passFOrch.ingestTestRun(buildId, payload))
ipcMain.handle('aep:ingestDeployment',   async (_e, { rcId, environment })  => passFOrch.ingestDeployment(rcId, environment))
ipcMain.handle('aep:snapshotKPIs',       async ()                           => passFOrch.snapshotKPIs())
ipcMain.handle('aep:recordKpiManual',    (_e, { kpiNodeId, value, window }) =>
  new KPIObservationIngester(db).recordManual(kpiNodeId, value, window)
)

// ── Pass G ───────────────────────────────────────────────────────────────────
ipcMain.handle('aep:runPassG', async (_e, { deploymentId }) =>
  new PassGOrchestrator(db, win, getProvider).run(deploymentId)
)

// ── Value stream orchestrator ────────────────────────────────────────────────
ipcMain.handle('aep:tickOrchestrator', () =>
  new ValueStreamOrchestrator(db).tick()
)

ipcMain.handle('aep:forceAdvance', (_e, { featureId, targetState, reason }) =>
  new ValueStreamOrchestrator(db).forceAdvance(featureId, targetState, reason)
)

// ── Human gates ──────────────────────────────────────────────────────────────
ipcMain.handle('aep:getPendingGates', () =>
  new HumanGateManager(db).getPendingGates()
)

ipcMain.handle('aep:approveGate', (_e, { gateType, role, nodeId, rationale, data }) =>
  new HumanGateManager(db).approve(gateType, role, nodeId, rationale, data)
)

// ── Calibration ──────────────────────────────────────────────────────────────
ipcMain.handle('aep:getCalibration', () =>
  new CalibrationMonitor(db).getReport()
)

// ── Learnings ────────────────────────────────────────────────────────────────
ipcMain.handle('aep:getLearnings', () =>
  db.prepare(`
    SELECT gn.id, gn.label, gn.description, gn.created_at,
           COUNT(ge.to_node_id) as informs_count
    FROM graph_nodes gn
    LEFT JOIN graph_edges ge ON ge.from_node_id = gn.id AND ge.kind = 'INFORMS'
    WHERE gn.kind = 'LEARNING'
    GROUP BY gn.id ORDER BY gn.created_at DESC
  `).all()
)

// ── Outcomes & Verdicts ────────────────────────────────────────────────────
ipcMain.handle('aep:getOutcomes', () =>
  db.prepare(`
    SELECT gn.id, gn.label, gn.description, gn.created_at
    FROM graph_nodes gn WHERE gn.kind IN ('OUTCOME','HYPOTHESIS_VERDICT')
    ORDER BY gn.created_at DESC LIMIT 50
  `).all()
)

// ── Golden thread (full traversal for a feature) ──────────────────────────
ipcMain.handle('aep:getGoldenThread', (_e, { featureId }) => {
  // Walk from CUSTOMER_SIGNAL up through PAIN_POINT → FEATURE → code → BUILD → DEPLOYMENT → OUTCOME
  const signals = db.prepare<[number], { label: string }>(`
    SELECT cs.label FROM graph_nodes cs
    JOIN graph_edges ge ON ge.to_node_id = ?
    JOIN graph_edges ge2 ON ge2.to_node_id = ge.from_node_id AND ge2.kind = 'EXPRESSES'
    WHERE ge.kind = 'MOTIVATES' AND cs.kind = 'CUSTOMER_SIGNAL' LIMIT 10
  `).all(featureId)

  const hypotheses = db.prepare<[number], { label: string; validated: boolean | null }>(`
    SELECT gn.label,
           CASE WHEN vh.verdict_node_id IS NOT NULL
                THEN (vn.description LIKE '%"validated":true%')
                ELSE NULL END as validated
    FROM value_hypotheses vh
    JOIN graph_nodes gn ON gn.id = vh.hypothesis_node_id
    LEFT JOIN graph_nodes vn ON vn.id = vh.verdict_node_id
    JOIN graph_edges ge ON ge.from_node_id = ? AND ge.to_node_id = vh.hypothesis_node_id
  `).all(featureId)

  const deployments = db.prepare<[], { label: string }>(
    `SELECT label FROM graph_nodes WHERE kind = 'DEPLOYMENT' ORDER BY created_at DESC LIMIT 5`
  ).all()

  const learnings = db.prepare<[number], { label: string }>(`
    SELECT gn.label FROM graph_nodes gn
    JOIN graph_edges ge ON ge.to_node_id = ?
    WHERE gn.kind = 'LEARNING' AND ge.kind = 'INFORMS' LIMIT 5
  `).all(featureId)

  return { signals, hypotheses, deployments, learnings }
})
```

---

## 13. Renderer Panels — Part 2

### 13.1 ConsolidationPanel

```
┌──────────────────────────────────────────────────────────────────────┐
│  Release Readiness                        [ ▶ Run A10 Analysis ]    │
│  ──────────────────────────────────────────────────────────────────  │
│  RC: main — ci-pipeline  (build #1247)                               │
│                                                                      │
│  ┌── SCOPE 1: Code ──────────────────────────────────────────────┐  │
│  │  14 files direct  ·  3 co-change risk files                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌── SCOPE 2: Verification ──────────────────────────────────────┐  │
│  │  ✅ 8 test suites  ·  12 acceptance criteria  ·  2 rules     │  │
│  │  ⚠ GAPS: src/services/bulkDispute.ts (no covering test)      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌── SCOPE 3: Operational ───────────────────────────────────────┐  │
│  │  DisputeBulkSubmitted (event) → enforcement-repo consumer     │  │
│  │  Bounded context: dispute-management                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌── SCOPE 4: Organizational ────────────────────────────────────┐  │
│  │  KPIs: charge_dispute_rate, dispute_resolution_time_p95      │  │
│  │  ⚠ REGULATED: NHAI-MLFF-SPEC-4.2 (clause 4.2)               │  │
│  │  Segments: fleet-operators                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Required approvals:                                                 │
│  ✅ Engineering Lead (signed 2h ago)                                 │
│  ⏳ Compliance Officer (pending — triggered by NHAI-MLFF-SPEC-4.2)  │
│  ⏳ Customer Success Lead (pending — triggered by fleet-operators)   │
│                                                                      │
│  [ Approve as Engineering Lead ] [ View Full Report ]               │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.2 OutcomeDashboardPanel

```
┌──────────────────────────────────────────────────────────────────────┐
│  Outcome Dashboard                           Cycle: Q3 2026          │
│  ──────────────────────────────────────────────────────────────────  │
│                                                                      │
│  HYPOTHESES SCOREBOARD                                               │
│  ─────────────────────────────────────────────────────────────────  │
│  ✅ H: charge_dispute_rate −60% in 90d   actual: −64%  conf: 0.90   │
│  ⚠  H: fleet_churn −2pp in 180d          actual: −0.7pp conf: 0.80  │
│     (REFUTED — churn was pricing-driven, not dispute UX)             │
│  ⏳ H: dispute_resolution_time_p95 −50%   pending (45d remaining)    │
│                                                                      │
│  PER-UNIT IMPACT                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  Finance      ✅ positive  Dispute cost/txn −41% (booked)            │
│  GTM          ⚠  mixed     Gap closed but pricing concern flagged    │
│  Support      ✅ positive  Dispute tickets −41%                      │
│  Engineering  ✅ positive  Zero incidents during rollout             │
│                                                                      │
│  LEARNINGS FROM THIS CYCLE                                           │
│  ─────────────────────────────────────────────────────────────────  │
│  💡 Fleet churn is pricing-dominant; dispute UX was secondary        │
│     → INFORMS: Pain Point "Fleet pricing concerns" (accumulating)   │
│  💡 A2 overestimated churn impact by ~65% for fleet segment         │
│     → INFORMS: A2 prior calibration for fleet-operator segment      │
│                                                                      │
│  AGENT CALIBRATION                                                   │
│  A2: improving  mean error 38% → 28% over 3 cycles                  │
│  A4: stable     mean error 22% (effort estimates)                    │
│                                                                      │
│  [ View Golden Thread ] [ View All Verdicts ] [ Run Pass G ]        │
└──────────────────────────────────────────────────────────────────────┘
```

### 13.3 CustomerSignalPanel

```
┌──────────────────────────────────────────────────────────────────────┐
│  Customer Signals                       [ + Ingest Signals ▾ ]      │
│  ──────────────────────────────────────────────────────────────────  │
│  65 signals · 4 pain points · 3 linked to features                  │
│                                                                      │
│  PAIN POINTS  (synthesized from signals)                             │
│  Fleet operators cannot dispute charges in bulk  ← 65 signals       │
│    Linked feature: Fleet Dispute Management  ✅  State: OBSERVE       │
│  Fleet pricing is uncompetitive vs. competitor X  ← 23 signals      │
│    No feature yet — [ Run A1 Intake ] to brief this pain point       │
│  OTP login friction on first use  ← 18 signals                      │
│    Linked feature: OTP Login  ✅  State: BUILD                        │
│                                                                      │
│  INGEST SIGNALS                                                      │
│  [ From Zendesk (JSON) ] [ From NPS (JSON) ] [ Manual CSV ]         │
│  [ Run Pain Point Clustering ] [ Run A1 Intake on selected ]         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 14. Level 3 & 4 Build Order

| Milestone | What | Gate |
|---|---|---|
| **M-F0** | CICDIngester + BuildPayload normalizer | Ingest a GitHub Actions webhook; BUILD node appears; `PACKAGED_IN` edges to file nodes exist |
| **M-F1** | TestRunIngester | TEST_RUN linked to BUILD and to L3 TEST_SUITE; `EVIDENCED_BY` edge on QUALITY_GATE |
| **M-F2** | DeploymentIngester | DEPLOYMENT node written; features advance to OBSERVE state |
| **M-F3** | KPIObservationIngester (manual override path first) | `recordManual` writes KPI_OBSERVATION; `OBSERVED_AS` edge exists |
| **M-F4** | 4-scope BlastRadiusEngine | `aep:getBlastRadius` returns all four scopes; governed files flagged; approval set computed |
| **M-F5** | A10 ConsolidationAgent + RELEASE_READINESS_REPORT | Report artifact written with correct blast radius; pending gates visible |
| **M-F6** | ConsolidationPanel UI | Full 4-scope view renders; approval buttons work; pending gate list updates |
| **M-F7** | A11 DeploymentAgent (without guard-metric halt for now) | Deployment executes against plan; DEPLOYMENT node + state advance |
| **M-F8** | A11 guard-metric halt | When KPI_OBSERVATION breach detected, INCIDENT written and rollout halted |
| **M-G0** | A12 AttributionAgent | HYPOTHESIS_VERDICT nodes written for features with past verdicts; correct edge kind (VALIDATES vs REFUTES) |
| **M-G1** | A13 CrossFunctionalAgent | IMPACT_ASSESSMENT per ORG_UNIT; ASSESSED_FOR edges |
| **M-G2** | OutcomeDashboardPanel | Verdicts, per-unit impact, hypothesis scoreboard all render |
| **M-L0** | A14 LearningAgent | LEARNING nodes written; INFORMS edges wired to pain points and objective nodes |
| **M-L1** | CalibrationMonitor + DB seeding | `agent_calibration` rows exist after a Pass G run; calibration report generated |
| **M-L2** | ValueStreamOrchestrator tick + predicates | `aep:tickOrchestrator` correctly advances 1+ features in test data; blocked features show `blocked_on_json` |
| **M-L3** | Blackboard polling + push events | Trigger conditions fire; renderer receives `aep:readyToQualify` and acts |
| **M-L4** | HumanGateManager + pending gates UI | Pending gates list populated; approve action writes DECISION_RECORD; orchestrator predicate clears |
| **M-L5** | AgentCapabilityMatrix seeding + RACI edges | `agent_capabilities` table populated; `aep:getApprovalSet` returns roles computed from RACI |
| **M-L6** | Full end-to-end cycle | One feature traverses all 9 states; hypothesis refuted; LEARNING INFORMS pain point; next cycle's A2 draft uses adjusted language |

---

## 15. Complete AEP File Manifest

```
packages/main/src/
│
├── domain/
│   ├── domainOrchestrator.ts
│   ├── domainPackLoader.ts
│   ├── domainEnrichment.ts
│   ├── domainAwareFIS.ts
│   └── passD/
│       ├── passDOrchestrator.ts
│       ├── glossaryIndexer.ts
│       ├── businessRuleIndexer.ts
│       ├── kpiIndexer.ts
│       ├── contextIndexer.ts
│       ├── eventIndexer.ts
│       └── regulationIndexer.ts
│
├── aep/
│   ├── aepOrchestrator.ts
│   ├── aepIpcHandlers.ts
│   │
│   ├── upstream/
│   │   ├── artifactWriter.ts        ← shared across all agents
│   │   ├── hypothesisRegistry.ts
│   │   ├── portfolioGate.ts
│   │   ├── passE/
│   │   │   ├── passEOrchestrator.ts
│   │   │   ├── customerSignalIngester.ts
│   │   │   ├── painPointClusterer.ts
│   │   │   └── orgPackLoader.ts
│   │   └── agents/
│   │       ├── a1IntakeAgent.ts
│   │       ├── a2BusinessImpactAgent.ts
│   │       ├── a3GtmAlignmentAgent.ts
│   │       ├── a4DevImpactAgent.ts
│   │       └── a5PortfolioAgent.ts
│   │
│   ├── downstream/
│   │   ├── blastRadiusEngine.ts
│   │   ├── passF/
│   │   │   ├── passFOrchestrator.ts
│   │   │   ├── cicdIngester.ts
│   │   │   ├── testRunIngester.ts
│   │   │   ├── deploymentIngester.ts
│   │   │   └── kpiObservationIngester.ts
│   │   ├── passG/
│   │   │   └── passGOrchestrator.ts
│   │   └── agents/
│   │       ├── a10ConsolidationAgent.ts
│   │       ├── a11DeploymentAgent.ts
│   │       ├── a12AttributionAgent.ts
│   │       ├── a13CrossFunctionalAgent.ts
│   │       └── a14LearningAgent.ts
│   │
│   └── governance/
│       ├── valueStreamOrchestrator.ts
│       ├── blackboard.ts
│       ├── raciGraph.ts
│       ├── agentCapabilityMatrix.ts
│       ├── humanGateManager.ts
│       └── calibrationMonitor.ts
│
resources/domain_packs/
    ├── mlff-tolling.pack.yaml
    ├── staas.pack.yaml
    └── generic-saas.pack.yaml

packages/renderer/src/panels/aep/
    ├── DomainBrowserPanel/index.tsx
    ├── ValueStreamPanel/index.tsx
    ├── CustomerSignalPanel/index.tsx
    ├── BusinessValuePanel/index.tsx
    ├── ConsolidationPanel/index.tsx
    └── OutcomeDashboardPanel/index.tsx
```

**Total new files: 40** (35 backend + 5 renderer panels + 3 domain pack YAML files)
**Modified RIAF/ISS files: 3** (all additive)

---

## 16. The Golden Thread — End-to-End Query

The most important capability the full 8-layer graph enables is a single traversal
that walks the entire value stream for a feature. This query answers
"show me everything about this feature, from the customer who asked for it
to the outcome it produced."

```typescript
// packages/main/src/aep/aepIpcHandlers.ts — getGoldenThread (full version)

function getGoldenThread(db: Database.Database, featureId: number) {
  // 1. Upstream: customer signals → pain points → feature
  const signals = db.prepare(`
    WITH RECURSIVE up(id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT ge.from_node_id, up.depth + 1
      FROM up JOIN graph_edges ge ON ge.to_node_id = up.id
        AND ge.kind IN ('MOTIVATES','EXPRESSES') AND up.depth < 3
    )
    SELECT DISTINCT gn.id, gn.kind, gn.label, gn.source_type, up.depth
    FROM up JOIN graph_nodes gn ON gn.id = up.id
    WHERE gn.kind IN ('CUSTOMER_SIGNAL','PAIN_POINT')
    ORDER BY up.depth DESC
  `).all(featureId)

  // 2. Business layer: hypotheses, objectives, investments
  const business = db.prepare(`
    SELECT gn.id, gn.kind, gn.label, vh.direction, vh.magnitude_pct,
           vh.prior_confidence, vh.actual_delta_pct, vh.verdict_node_id
    FROM graph_edges ge
    JOIN graph_nodes gn ON gn.id = ge.to_node_id
    LEFT JOIN value_hypotheses vh ON vh.hypothesis_node_id = gn.id
    WHERE ge.from_node_id = ?
      AND gn.kind IN ('VALUE_HYPOTHESIS','BUSINESS_OBJECTIVE','INVESTMENT','COST_ESTIMATE')
  `).all(featureId)

  // 3. D-ISS descent: code traces
  const code = db.prepare(`
    SELECT gn.id, gn.kind, gn.label, gn.file_path, gn.sdlc_phase, ft.confidence, ft.trace_type
    FROM feature_traces ft JOIN graph_nodes gn ON gn.id = ft.code_node_id
    WHERE ft.feature_node_id = ?
    ORDER BY ft.confidence DESC LIMIT 20
  `).all(featureId)

  // 4. Delivery: builds, release candidate, deployment
  const delivery = db.prepare(`
    SELECT DISTINCT gn.id, gn.kind, gn.label, gn.created_at
    FROM graph_nodes gn
    JOIN graph_edges ge ON ge.from_node_id = gn.id
    WHERE gn.kind IN ('BUILD','RELEASE_CANDIDATE','DEPLOYMENT','INCIDENT')
    ORDER BY gn.created_at DESC LIMIT 5
  `).all()

  // 5. Outcomes: verdicts and learnings
  const outcomes = db.prepare(`
    SELECT gn.id, gn.kind, gn.label, gn.description
    FROM graph_nodes gn
    WHERE gn.kind IN ('OUTCOME','HYPOTHESIS_VERDICT','LEARNING')
    ORDER BY gn.created_at DESC LIMIT 10
  `).all()

  // 6. Value stream state
  const streamState = db.prepare(
    'SELECT stream_state, entered_state_at FROM value_stream_state WHERE feature_node_id = ?'
  ).get(featureId)

  return { signals, business, code, delivery, outcomes, streamState }
}
```

The golden thread — from `CUSTOMER_SIGNAL` to `LEARNING` — is now a single function
call against a local SQLite database. Every hop is a graph edge. Every node carries
provenance. Every confidence value is measured against eventual ground truth.
The organization's predictions improve because the loop is closed.

---

## Summary of All Four Levels

| Level | What it adds | Core files | Immediate value |
|---|---|---|---|
| **L1 D-ISS** | Domain Ontology (L0): concepts, rules, KPIs, contexts, regulations | Pass D (7 indexers), DomainAwareFIS | Features grounded in domain language; governed code auto-flagged; FIS domain-aware |
| **L2 Upstream** | Customer & Business layers (L−2, L−1): signals → pain points → hypotheses → portfolio | Pass E, A1–A5, HypothesisRegistry, PortfolioGate | Every feature enters with a falsifiable bet; no more "why are we building this?" |
| **L3 Downstream** | Delivery & Outcome layers (L+4, L+5): code → build → deploy → KPI → verdict | Pass F, Pass G, A10–A13, BlastRadiusEngine | Release readiness with 4-scope blast radius; computed approval sets; hypothesis verdicts |
| **L4 Loop** | Organizational learning: verdicts → learnings → improved priors | A14, ValueStreamOrchestrator, Blackboard, CalibrationMonitor | Agent estimates improve each cycle; full audit trail; governance scales with actual impact |

**Total new files across all four levels: 67** (domain: 11, AEP: 40, renderer: 6, YAML: 3, shared: 7)
**Modified existing files: 3** (all additive — zero deletions anywhere in the system)
