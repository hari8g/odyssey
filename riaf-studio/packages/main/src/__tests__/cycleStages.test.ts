import { describe, expect, it } from 'vitest'
import { makeTestDb } from './helpers'
import { STAGES, stageById } from '../cycle/stageDefinitions'
import type { CycleRunRow } from '@shared/index'

function emptyRun(overrides: Partial<CycleRunRow> = {}): CycleRunRow {
  return {
    id: 1,
    label: 'test',
    mode: 'demo',
    current_stage: 'SIGNALS',
    status: 'running',
    error: null,
    pain_point_ids_json: null,
    feature_node_id: null,
    brief_id: null,
    biz_assess_id: null,
    dev_assess_id: null,
    gtm_assess_id: null,
    packet_id: null,
    readiness_report_id: null,
    rc_id: null,
    deployment_id: null,
    outcome_report_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('Cycle stage definitions', () => {
  it('defines 13 stages ending in DONE', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'SIGNALS',
      'CLUSTER',
      'INTAKE',
      'QUALIFY',
      'PACKET',
      'PORTFOLIO_GATE',
      'BUILD',
      'CONSOLIDATE',
      'RELEASE_GATE',
      'ROLLOUT',
      'OBSERVE',
      'LEARN',
      'DONE',
    ])
    expect(stageById('DONE').kind).toBe('TERMINAL')
  })

  it('every non-terminal exit returns a reason on an empty DB', () => {
    const db = makeTestDb()
    const version = db
      .prepare('SELECT version FROM schema_version WHERE id = 1')
      .get() as { version: number }
    expect(version.version).toBe(5)

    for (const stage of STAGES) {
      if (stage.kind === 'TERMINAL') {
        expect(stage.exit(db, emptyRun({ current_stage: stage.id })).ok).toBe(true)
        continue
      }
      const result = stage.exit(db, emptyRun({ current_stage: stage.id }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0)
    }

    db.close()
  })

  it('creates cycle and Pass F registry tables', () => {
    const db = makeTestDb()
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND (
           name LIKE 'cycle_%' OR name IN ('build_registry','test_run_registry','deployment_registry')
         )`,
      )
      .all() as { name: string }[]
    expect(tables.map((t) => t.name).sort()).toEqual([
      'build_registry',
      'cycle_runs',
      'cycle_stage_log',
      'deployment_registry',
      'test_run_registry',
    ])
    db.close()
  })
})
