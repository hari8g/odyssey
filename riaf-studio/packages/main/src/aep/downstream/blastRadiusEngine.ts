// packages/main/src/aep/downstream/blastRadiusEngine.ts
import type Database from 'better-sqlite3'
import type { BlastRadius } from '@shared/index'

interface FileRow { filePath: string }
interface NodeRow { kind: string; label: string; detail?: string | null }

export class BlastRadiusEngine {
  constructor(private readonly db: Database.Database) {}

  compute(featureIdOrRcId: number, type: 'feature' | 'release_candidate' = 'feature'): BlastRadius {
    const featureId = type === 'release_candidate'
      ? this.resolveFeatureFromRC(featureIdOrRcId)
      : featureIdOrRcId

    const scope1 = this.computeScope1(featureId)
    const directPaths = scope1.filter((f) => f.changeType === 'direct').map((f) => f.filePath)
    const scope2 = this.computeScope2(directPaths)
    const scope3 = this.computeScope3(featureId)
    const scope4 = this.computeScope4(featureId)
    const approvalSet = this.computeApprovalSet(featureId, scope4.governed.length > 0)

    return {
      featureId,
      scope1_code: scope1,
      scope2_verify: scope2.covered,
      scope2_gaps: scope2.gaps,
      scope3_ops: scope3,
      scope4_org: scope4,
      approvalSet,
      computedAt: Date.now(),
    }
  }

  // ── Scope 1: code files directly linked or co-changing ─────────────────────

  private computeScope1(featureId: number): BlastRadius['scope1_code'] {
    const results: BlastRadius['scope1_code'] = []
    const seen = new Set<string>()

    // Direct: graph_nodes reachable from feature via IMPLEMENTS (feature→code) or reverse
    const directRows = this.db
      .prepare<[number, number], { file_path: string | null }>(
        `SELECT DISTINCT gn.source_ref AS file_path
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id = ? AND ge.kind = 'IMPLEMENTS'
           AND gn.source_ref IS NOT NULL
         UNION
         SELECT DISTINCT gn.source_ref AS file_path
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id
         WHERE ge.to_node_id = ? AND ge.kind = 'IMPLEMENTS'
           AND gn.source_ref IS NOT NULL`,
      )
      .all(featureId, featureId)

    for (const r of directRows) {
      if (r.file_path && !seen.has(r.file_path)) {
        seen.add(r.file_path)
        results.push({ filePath: r.file_path, changeType: 'direct' })
      }
    }

    // Via PACKAGED_IN: find files packed into BUILDs that are linked to the feature
    const packagedRows = this.db
      .prepare<[number, number], { file_path: string | null }>(
        `SELECT DISTINCT gn.source_ref AS file_path
         FROM graph_edges ge_build
         JOIN graph_nodes build ON build.id = ge_build.to_node_id AND build.kind = 'BUILD'
         JOIN graph_edges ge_pkg ON ge_pkg.to_node_id = build.id AND ge_pkg.kind = 'PACKAGED_IN'
         JOIN graph_nodes gn ON gn.id = ge_pkg.from_node_id
         WHERE ge_build.from_node_id = ? AND ge_build.kind IN ('IMPLEMENTS','PACKAGED_IN')
           AND gn.source_ref IS NOT NULL
         UNION
         SELECT DISTINCT gn.source_ref AS file_path
         FROM graph_edges ge_pkg
         JOIN graph_nodes gn ON gn.id = ge_pkg.from_node_id
         WHERE ge_pkg.to_node_id = ? AND ge_pkg.kind = 'PACKAGED_IN'
           AND gn.source_ref IS NOT NULL`,
      )
      .all(featureId, featureId)

    for (const r of packagedRows) {
      if (r.file_path && !seen.has(r.file_path)) {
        seen.add(r.file_path)
        results.push({ filePath: r.file_path, changeType: 'direct' })
      }
    }

    // Co-changes: files that CO_CHANGES_WITH any of the direct files
    const directFileIds = results.length > 0
      ? this.db
          .prepare<string[], { id: number }>(
            `SELECT id FROM graph_nodes
             WHERE source_ref IN (${results.map(() => '?').join(',')})`,
          )
          .all(...results.map((r) => r.filePath))
          .map((r) => r.id)
      : []

    if (directFileIds.length > 0) {
      const coRows = this.db
        .prepare<number[], { file_path: string | null }>(
          `SELECT DISTINCT gn.source_ref AS file_path
           FROM graph_edges ge
           JOIN graph_nodes gn ON gn.id = ge.to_node_id
           WHERE ge.from_node_id IN (${directFileIds.map(() => '?').join(',')})
             AND ge.kind = 'CO_CHANGES_WITH' AND gn.source_ref IS NOT NULL
           UNION
           SELECT DISTINCT gn.source_ref AS file_path
           FROM graph_edges ge
           JOIN graph_nodes gn ON gn.id = ge.from_node_id
           WHERE ge.to_node_id IN (${directFileIds.map(() => '?').join(',')})
             AND ge.kind = 'CO_CHANGES_WITH' AND gn.source_ref IS NOT NULL`,
        )
        .all(...directFileIds, ...directFileIds)

      for (const r of coRows) {
        if (r.file_path && !seen.has(r.file_path)) {
          seen.add(r.file_path)
          results.push({ filePath: r.file_path, changeType: 'cochange' })
        }
      }
    }

    return results
  }

  // ── Scope 2: test coverage ──────────────────────────────────────────────────

  private computeScope2(directFilePaths: string[]): {
    covered: BlastRadius['scope2_verify']
    gaps: string[]
  } {
    if (!directFilePaths.length) return { covered: [], gaps: [] }

    const covered: BlastRadius['scope2_verify'] = []
    const coveredPaths = new Set<string>()

    // Find TEST_SUITE / TEST_CASE nodes that reference or TESTS these files
    const testRows = this.db
      .prepare<string[], { kind: string; label: string; file_path: string | null }>(
        `SELECT DISTINCT gn.kind, gn.label, gn.source_ref AS file_path
         FROM graph_nodes gn
         WHERE gn.kind IN ('TEST_SUITE','TEST_CASE')
           AND gn.source_ref IN (${directFilePaths.map(() => '?').join(',')})
         UNION
         SELECT DISTINCT tn.kind, tn.label, tn.source_ref AS file_path
         FROM graph_edges ge
         JOIN graph_nodes fn ON fn.id = ge.to_node_id
         JOIN graph_nodes tn ON tn.id = ge.from_node_id
         WHERE fn.source_ref IN (${directFilePaths.map(() => '?').join(',')})
           AND ge.kind = 'TESTS'
           AND tn.kind IN ('TEST_SUITE','TEST_CASE')`,
      )
      .all(...directFilePaths, ...directFilePaths)

    for (const r of testRows) {
      covered.push({
        kind: r.kind,
        label: r.label,
        isCovered: true,
        filePath: r.file_path,
      })
      if (r.file_path) coveredPaths.add(r.file_path)
    }

    const gaps = directFilePaths.filter((fp) => !coveredPaths.has(fp))

    return { covered, gaps }
  }

  // ── Scope 3: ops nodes ─────────────────────────────────────────────────────

  private computeScope3(featureId: number): BlastRadius['scope3_ops'] {
    const ops: BlastRadius['scope3_ops'] = []

    // DEPLOYMENT nodes linked to the feature (via BUILD chain or direct)
    const depRows = this.db
      .prepare<[number, number], { kind: string; label: string; description: string | null }>(
        `SELECT DISTINCT dn.kind, dn.label, dn.description
         FROM graph_nodes dn
         WHERE dn.kind = 'DEPLOYMENT'
           AND EXISTS (
             SELECT 1 FROM graph_edges ge WHERE ge.from_node_id = ? AND ge.to_node_id = dn.id
           )
         UNION
         SELECT DISTINCT dn.kind, dn.label, dn.description
         FROM graph_edges ge_impl
         JOIN graph_nodes build ON build.id = ge_impl.to_node_id AND build.kind = 'BUILD'
         JOIN graph_edges ge_dep ON ge_dep.from_node_id = build.id
         JOIN graph_nodes dn ON dn.id = ge_dep.to_node_id AND dn.kind = 'DEPLOYMENT'
         WHERE ge_impl.from_node_id = ?`,
      )
      .all(featureId, featureId)

    for (const r of depRows) {
      ops.push({ kind: r.kind, label: r.label, detail: r.description ?? '' })
    }

    // FEATURE_FLAG nodes linked to the feature (EXPOSES_FLAG)
    const flagRows = this.db
      .prepare<[number], { kind: string; label: string; description: string | null }>(
        `SELECT gn.kind, gn.label, gn.description
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id = ? AND ge.kind = 'EXPOSES_FLAG'`,
      )
      .all(featureId)

    for (const r of flagRows) {
      ops.push({ kind: r.kind, label: r.label, detail: r.description ?? '' })
    }

    // INCIDENT nodes linked to the feature (CAUSED / SUSPECTED)
    const incidentRows = this.db
      .prepare<[number, number], { kind: string; label: string; description: string | null }>(
        `SELECT gn.kind, gn.label, gn.description
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id = ? AND ge.kind IN ('CAUSED','SUSPECTED')
         UNION
         SELECT gn.kind, gn.label, gn.description
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id
         WHERE ge.to_node_id = ? AND ge.kind IN ('CAUSED','SUSPECTED')`,
      )
      .all(featureId, featureId)

    for (const r of incidentRows) {
      ops.push({ kind: r.kind, label: r.label, detail: r.description ?? '' })
    }

    return ops
  }

  // ── Scope 4: org-level impact ───────────────────────────────────────────────

  private computeScope4(featureId: number): BlastRadius['scope4_org'] {
    // KPIs via HAS_HYPOTHESIS → VALUE_HYPOTHESIS → PREDICTS → KPI
    const kpiRows = this.db
      .prepare<[number, number], { label: string }>(
        `SELECT DISTINCT kn.label
         FROM graph_edges ge_hyp
         JOIN graph_nodes hn ON hn.id = ge_hyp.to_node_id AND hn.kind = 'VALUE_HYPOTHESIS'
         JOIN graph_edges ge_kpi ON ge_kpi.from_node_id = hn.id AND ge_kpi.kind = 'PREDICTS'
         JOIN graph_nodes kn ON kn.id = ge_kpi.to_node_id AND kn.kind = 'KPI'
         WHERE ge_hyp.from_node_id = ? AND ge_hyp.kind = 'HAS_HYPOTHESIS'
         UNION
         SELECT DISTINCT kn.label
         FROM graph_edges ge
         JOIN graph_nodes kn ON kn.id = ge.to_node_id AND kn.kind = 'KPI'
         WHERE ge.from_node_id = ? AND ge.kind = 'ABOUT'`,
      )
      .all(featureId, featureId)

    // ORG_UNIT nodes linked via ASSESSED_FOR or concern KPIs
    const orgRows = this.db
      .prepare<[number], { label: string }>(
        `SELECT DISTINCT gn.label
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.from_node_id AND gn.kind = 'ORG_UNIT'
         WHERE ge.to_node_id = ? AND ge.kind = 'ASSESSED_FOR'`,
      )
      .all(featureId)

    // SEGMENT nodes
    const segmentRows = this.db
      .prepare<[number], { label: string }>(
        `SELECT DISTINCT gn.label
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id AND gn.kind = 'SEGMENT'
         WHERE ge.from_node_id = ? AND ge.kind IN ('TARGETS','BELONGS_TO_SEGMENT')`,
      )
      .all(featureId)

    // REGULATION nodes via GOVERNED_BY
    const regulationRows = this.db
      .prepare<[number], { label: string }>(
        `SELECT DISTINCT gn.label
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id AND gn.kind = 'REGULATION'
         WHERE ge.from_node_id = ? AND ge.kind = 'GOVERNED_BY'`,
      )
      .all(featureId)

    return {
      kpis: kpiRows.map((r) => r.label),
      segments: segmentRows.map((r) => r.label),
      orgUnits: orgRows.map((r) => r.label),
      governed: regulationRows.map((r) => r.label),
    }
  }

  // ── Approval set ───────────────────────────────────────────────────────────

  private computeApprovalSet(featureId: number, isGoverned: boolean): string[] {
    const roleRows = this.db
      .prepare<[number], { label: string }>(
        `SELECT DISTINCT gn.label
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id AND gn.kind = 'STAKEHOLDER_ROLE'
         WHERE ge.from_node_id = ? AND ge.kind IN ('CONSULTED_BY','OWNS','GOVERNED_BY')`,
      )
      .all(featureId)

    const roles = roleRows.map((r) => r.label)
    if (roles.length > 0) return [...new Set(roles)]
    return isGoverned ? ['CPO', 'CTO', 'Legal'] : ['CPO', 'CTO']
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private resolveFeatureFromRC(rcId: number): number {
    // RELEASE_CANDIDATE → PACKAGED_IN (files) → IMPLEMENTS (feature)
    const row = this.db
      .prepare<[number], { feature_id: number }>(
        `SELECT DISTINCT fn.id AS feature_id
         FROM graph_nodes fn
         WHERE fn.kind = 'FEATURE'
           AND EXISTS (
             SELECT 1 FROM graph_edges ge WHERE ge.from_node_id = fn.id AND ge.to_node_id = ?
           )
         LIMIT 1`,
      )
      .get(rcId)
    return row?.feature_id ?? rcId
  }
}
