export type CycleStage =
  | 'SIGNALS'
  | 'CLUSTER'
  | 'INTAKE'
  | 'QUALIFY'
  | 'PACKET'
  | 'PORTFOLIO_GATE'
  | 'BUILD'
  | 'CONSOLIDATE'
  | 'RELEASE_GATE'
  | 'ROLLOUT'
  | 'OBSERVE'
  | 'LEARN'
  | 'DONE'

export type CycleRunMode = 'live' | 'demo'

export type CycleRunStatus =
  | 'running'
  | 'waiting_gate'
  | 'waiting_external'
  | 'completed'
  | 'aborted'
  | 'error'

export type CycleRunRow = {
  id: number
  label: string
  mode: CycleRunMode
  current_stage: CycleStage
  status: CycleRunStatus
  error: string | null
  pain_point_ids_json: string | null
  feature_node_id: number | null
  brief_id: number | null
  biz_assess_id: number | null
  dev_assess_id: number | null
  gtm_assess_id: number | null
  packet_id: number | null
  readiness_report_id: number | null
  rc_id: number | null
  deployment_id: number | null
  outcome_report_id: number | null
  created_at: number
  updated_at: number
}

export type CycleTimelineRow = {
  stage: string
  event: string
  agent_id: string | null
  artifact_node_id: number | null
  detail_json: string | null
  ts: number
}

export type CycleProgress = {
  runId: number
  stage: string
  pct: number
  detail: string
}
