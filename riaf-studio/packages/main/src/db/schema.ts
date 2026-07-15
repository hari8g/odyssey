export const SCHEMA_V1 = `

CREATE TABLE IF NOT EXISTS file_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_root TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  language      TEXT,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  last_modified INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  UNIQUE(workspace_root, file_path)
);
CREATE INDEX IF NOT EXISTS idx_fm_workspace ON file_metadata(workspace_root);
CREATE INDEX IF NOT EXISTS idx_fm_language  ON file_metadata(language);

CREATE TABLE IF NOT EXISTS code_chunks (
  id          TEXT PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  chunk_text  TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  chunk_type  TEXT NOT NULL CHECK(chunk_type IN ('function','class','block','file'))
);
CREATE INDEX IF NOT EXISTS idx_cc_file_id ON code_chunks(file_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_text,
  file_path UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  chunk_type UNINDEXED,
  content='code_chunks',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON code_chunks BEGIN
  INSERT INTO chunks_fts(rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES (new.rowid, new.chunk_text, new.file_path, new.start_line, new.end_line, new.chunk_type);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON code_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES ('delete', old.rowid, old.chunk_text, old.file_path, old.start_line, old.end_line, old.chunk_type);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON code_chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES ('delete', old.rowid, old.chunk_text, old.file_path, old.start_line, old.end_line, old.chunk_type);
  INSERT INTO chunks_fts(rowid, chunk_text, file_path, start_line, end_line, chunk_type)
  VALUES (new.rowid, new.chunk_text, new.file_path, new.start_line, new.end_line, new.chunk_type);
END;

CREATE TABLE IF NOT EXISTS symbols (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id      INTEGER NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK(kind IN ('function','class','interface','type','enum','const')),
  start_line   INTEGER NOT NULL,
  end_line     INTEGER NOT NULL,
  signature    TEXT NOT NULL DEFAULT '',
  docstring    TEXT NOT NULL DEFAULT '',
  is_exported  INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sym_file_id  ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_sym_name     ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_sym_kind     ON symbols(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name, kind UNINDEXED, signature, docstring, file_path UNINDEXED,
  content='symbols',
  content_rowid='rowid',
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS symbols_fts_insert AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, kind, signature, docstring, file_path)
  VALUES (new.rowid, new.name, new.kind, new.signature, new.docstring, new.file_path);
END;
CREATE TRIGGER IF NOT EXISTS symbols_fts_delete AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, docstring, file_path)
  VALUES ('delete', old.rowid, old.name, old.kind, old.signature, old.docstring, old.file_path);
END;
CREATE TRIGGER IF NOT EXISTS symbols_fts_update AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind, signature, docstring, file_path)
  VALUES ('delete', old.rowid, old.name, old.kind, old.signature, old.docstring, old.file_path);
  INSERT INTO symbols_fts(rowid, name, kind, signature, docstring, file_path)
  VALUES (new.rowid, new.name, new.kind, new.signature, new.docstring, new.file_path);
END;

CREATE TABLE IF NOT EXISTS ucg_file_nodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL UNIQUE,
  language        TEXT NOT NULL DEFAULT 'unknown',
  node_type       TEXT NOT NULL DEFAULT 'util',
  arch_layer      TEXT NOT NULL DEFAULT 'domain',
  is_entry_point  INTEGER NOT NULL DEFAULT 0,
  import_count    INTEGER NOT NULL DEFAULT 0,
  imported_by_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ucg_node_type  ON ucg_file_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_ucg_arch_layer ON ucg_file_nodes(arch_layer);

CREATE TABLE IF NOT EXISTS ucg_import_edges (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_file     TEXT NOT NULL,
  to_module     TEXT NOT NULL,
  resolved_file TEXT,
  is_external   INTEGER NOT NULL DEFAULT 0,
  edge_type     TEXT NOT NULL DEFAULT 'esm'
);
CREATE INDEX IF NOT EXISTS idx_ucg_edge_from ON ucg_import_edges(from_file);
CREATE INDEX IF NOT EXISTS idx_ucg_edge_to   ON ucg_import_edges(resolved_file);

CREATE TABLE IF NOT EXISTS ucg_graph_metrics (
  id            INTEGER PRIMARY KEY CHECK(id = 1),
  total_nodes   INTEGER NOT NULL DEFAULT 0,
  total_edges   INTEGER NOT NULL DEFAULT 0,
  entry_count   INTEGER NOT NULL DEFAULT 0,
  cycle_count   INTEGER NOT NULL DEFAULT 0,
  cycles_json   TEXT NOT NULL DEFAULT '[]',
  hot_files_json TEXT NOT NULL DEFAULT '[]',
  external_deps_json TEXT NOT NULL DEFAULT '{}',
  computed_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_profiles (
  id                   INTEGER PRIMARY KEY CHECK(id = 1),
  workspace_root       TEXT NOT NULL,
  last_scanned_at      INTEGER NOT NULL,
  language_stack_json  TEXT NOT NULL DEFAULT '[]',
  frameworks_json      TEXT NOT NULL DEFAULT '[]',
  package_managers_json TEXT NOT NULL DEFAULT '[]',
  build_commands_json  TEXT NOT NULL DEFAULT '[]',
  test_commands_json   TEXT NOT NULL DEFAULT '[]',
  lint_commands_json   TEXT NOT NULL DEFAULT '[]',
  file_count           INTEGER NOT NULL DEFAULT 0,
  total_loc            INTEGER NOT NULL DEFAULT 0,
  project_purpose      TEXT,
  architecture_summary TEXT
);

CREATE TABLE IF NOT EXISTS git_file_stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path    TEXT NOT NULL UNIQUE,
  change_count INTEGER NOT NULL DEFAULT 0,
  last_changed TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_git_change_count ON git_file_stats(change_count DESC);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id     TEXT PRIMARY KEY REFERENCES code_chunks(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  embedding    BLOB NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL,
  label            TEXT NOT NULL,
  description      TEXT,
  sdlc_phase       TEXT,
  sdlc_confidence  REAL,
  source_type      TEXT NOT NULL DEFAULT 'manual',
  source_ref       TEXT,
  file_path        TEXT,
  start_line       INTEGER,
  end_line         INTEGER,
  importance_score REAL NOT NULL DEFAULT 0.0,
  embedding_vec    BLOB,
  symbol_id        INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  file_id          INTEGER REFERENCES file_metadata(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_gn_kind       ON graph_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_gn_sdlc_phase ON graph_nodes(sdlc_phase);
CREATE INDEX IF NOT EXISTS idx_gn_file_path  ON graph_nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_gn_importance ON graph_nodes(importance_score DESC);

CREATE TABLE IF NOT EXISTS graph_edges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id   INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  weight       REAL NOT NULL DEFAULT 1.0,
  confidence   REAL NOT NULL DEFAULT 1.0,
  source       TEXT NOT NULL DEFAULT 'static_analysis',
  metadata_json TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ge_from  ON graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_to    ON graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_kind  ON graph_edges(kind);

CREATE TABLE IF NOT EXISTS feature_traces (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_node_id INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  code_node_id    INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  trace_type      TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 1.0,
  path_json       TEXT,
  UNIQUE(feature_node_id, code_node_id)
);

`

/** ISS Graph V2 — Pass B accumulation, feature suggestions, audit, SDLC summary */
export const SCHEMA_V2 = `

CREATE TABLE IF NOT EXISTS iss_mining_meta (
  id                INTEGER PRIMARY KEY CHECK(id = 1),
  last_commit_hash  TEXT,
  last_mined_at     INTEGER,
  commits_processed INTEGER NOT NULL DEFAULT 0,
  pairs_found       INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO iss_mining_meta(id) VALUES (1);

CREATE TABLE IF NOT EXISTS co_change_pairs (
  file_a    TEXT NOT NULL,
  file_b    TEXT NOT NULL,
  co_count  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (file_a, file_b)
);

CREATE TABLE IF NOT EXISTS file_change_counts (
  file_path    TEXT PRIMARY KEY,
  change_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS feature_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,
  sdlc_phase   TEXT NOT NULL DEFAULT 'requirements',
  confidence   REAL NOT NULL DEFAULT 0.50,
  source       TEXT NOT NULL DEFAULT 'code_structure',
  status       TEXT NOT NULL DEFAULT 'pending',
  node_id      INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  reviewed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fs_status ON feature_suggestions(status);

CREATE TABLE IF NOT EXISTS manual_feature_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     INTEGER REFERENCES graph_nodes(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  label       TEXT NOT NULL,
  meta_json   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS sdlc_phase_summary (
  feature_node_id    INTEGER PRIMARY KEY
    REFERENCES graph_nodes(id) ON DELETE CASCADE,
  has_requirements   INTEGER NOT NULL DEFAULT 0,
  has_design         INTEGER NOT NULL DEFAULT 0,
  has_implementation INTEGER NOT NULL DEFAULT 0,
  has_testing        INTEGER NOT NULL DEFAULT 0,
  has_deployment     INTEGER NOT NULL DEFAULT 0,
  completion_pct     REAL NOT NULL DEFAULT 0.0,
  computed_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gn_domain_service
  ON graph_nodes(kind) WHERE kind = 'DOMAIN_SERVICE';
CREATE INDEX IF NOT EXISTS idx_gn_feature_embedded
  ON graph_nodes(kind) WHERE kind = 'FEATURE' AND embedding_vec IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ge_kind_from  ON graph_edges(kind, from_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_kind_to    ON graph_edges(kind, to_node_id);
CREATE INDEX IF NOT EXISTS idx_ge_cochange_weight
  ON graph_edges(kind, weight DESC) WHERE kind = 'CO_CHANGES_WITH';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ge_unique_edge
  ON graph_edges(from_node_id, to_node_id, kind);

`

/** AEP / D-ISS V3 — domain packs, value hypotheses, value stream, calibration */
export const SCHEMA_V3 = `

CREATE TABLE IF NOT EXISTS domain_packs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  version     TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  loaded_at   INTEGER NOT NULL,
  node_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kpi_registry (
  kpi_node_id        INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  measurement_unit   TEXT NOT NULL,
  measurement_window TEXT NOT NULL,
  telemetry_source   TEXT,
  baseline_value     REAL,
  target_value       REAL,
  owner_org_unit     TEXT
);

CREATE TABLE IF NOT EXISTS value_hypotheses (
  hypothesis_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  kpi_node_id        INTEGER NOT NULL REFERENCES graph_nodes(id),
  direction          TEXT NOT NULL CHECK(direction IN ('increase','decrease','stabilize')),
  magnitude_pct      REAL NOT NULL,
  timeframe_days     INTEGER NOT NULL,
  prior_confidence   REAL NOT NULL,
  attribution_method TEXT NOT NULL
    CHECK(attribution_method IN ('ab_flag','canary','before_after','holdout')),
  registered_at      INTEGER NOT NULL,
  verdict_node_id    INTEGER REFERENCES graph_nodes(id),
  actual_delta_pct   REAL,
  actual_confidence  REAL
);
CREATE INDEX IF NOT EXISTS idx_vh_kpi ON value_hypotheses(kpi_node_id);

CREATE TABLE IF NOT EXISTS org_packs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  version   TEXT NOT NULL,
  file_path TEXT NOT NULL,
  loaded_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_signals (
  signal_node_id  INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  source_system   TEXT NOT NULL,
  source_id       TEXT,
  customer_cohort TEXT NOT NULL,
  signal_type     TEXT NOT NULL
    CHECK(signal_type IN ('feature_request','defect','usability','churn_risk','pricing','noise')),
  raw_text_hash   TEXT NOT NULL,
  signal_date     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cs_type   ON customer_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_cs_cohort ON customer_signals(customer_cohort);

CREATE TABLE IF NOT EXISTS artifact_provenance (
  artifact_node_id    INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL,
  agent_version       TEXT NOT NULL,
  derived_from_json   TEXT NOT NULL,
  queries_json        TEXT,
  confidence          REAL NOT NULL,
  approved_by_role    TEXT,
  approved_at         INTEGER,
  superseded_by       INTEGER REFERENCES graph_nodes(id)
);

CREATE TABLE IF NOT EXISTS value_stream_state (
  feature_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  stream_state    TEXT NOT NULL DEFAULT 'INTAKE'
    CHECK(stream_state IN (
      'INTAKE','QUALIFY','PRIORITIZE','DEFINE','BUILD',
      'CONSOLIDATE','RELEASE','OBSERVE','LEARN')),
  entered_state_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  blocked_on_json TEXT,
  last_transition_record INTEGER REFERENCES graph_nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_vss_state ON value_stream_state(stream_state);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id          TEXT NOT NULL,
  layer             TEXT NOT NULL,
  node_kinds_json   TEXT NOT NULL,
  edge_kinds_json   TEXT NOT NULL,
  requires_gate     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, layer)
);

CREATE TABLE IF NOT EXISTS agent_calibration (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL,
  cycle_end_date  TEXT NOT NULL,
  predictions     INTEGER NOT NULL,
  verified        INTEGER NOT NULL,
  mean_error_pct  REAL,
  calibration_score REAL,
  notes_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ac_agent ON agent_calibration(agent_id, cycle_end_date);

`

/** Cycle Runner V4 — resumable guided value-stream runs */
export const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS cycle_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  label               TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'live' CHECK(mode IN ('live','demo')),
  current_stage       TEXT NOT NULL DEFAULT 'SIGNALS',
  status              TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running','waiting_gate','waiting_external','completed','aborted','error')),
  error               TEXT,
  pain_point_ids_json TEXT,
  feature_node_id     INTEGER REFERENCES graph_nodes(id),
  brief_id            INTEGER REFERENCES graph_nodes(id),
  biz_assess_id       INTEGER REFERENCES graph_nodes(id),
  dev_assess_id       INTEGER REFERENCES graph_nodes(id),
  gtm_assess_id       INTEGER REFERENCES graph_nodes(id),
  packet_id           INTEGER REFERENCES graph_nodes(id),
  readiness_report_id INTEGER REFERENCES graph_nodes(id),
  rc_id               INTEGER REFERENCES graph_nodes(id),
  deployment_id       INTEGER REFERENCES graph_nodes(id),
  outcome_report_id   INTEGER REFERENCES graph_nodes(id),
  created_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_cr_status ON cycle_runs(status);

CREATE TABLE IF NOT EXISTS cycle_stage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES cycle_runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  event       TEXT NOT NULL
    CHECK(event IN ('entered','agent_started','agent_finished','gate_approved',
                    'gate_rejected','simulated','advanced','bounced','halted','error')),
  agent_id    TEXT,
  artifact_node_id INTEGER REFERENCES graph_nodes(id),
  detail_json TEXT,
  ts          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_csl_run ON cycle_stage_log(run_id, ts);
`

/** Pass F registries V5 — CI build / test / deployment side tables */
export const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS build_registry (
  build_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  sha           TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  conclusion    TEXT NOT NULL,
  built_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_br_sha ON build_registry(sha);
CREATE INDEX IF NOT EXISTS idx_br_run ON build_registry(run_id);

CREATE TABLE IF NOT EXISTS test_run_registry (
  test_run_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  build_node_id    INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  total_tests      INTEGER NOT NULL DEFAULT 0,
  passed_tests     INTEGER NOT NULL DEFAULT 0,
  failed_tests     INTEGER NOT NULL DEFAULT 0,
  duration_ms      INTEGER,
  ran_at           INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_trr_build ON test_run_registry(build_node_id);

CREATE TABLE IF NOT EXISTS deployment_registry (
  deployment_node_id INTEGER PRIMARY KEY REFERENCES graph_nodes(id) ON DELETE CASCADE,
  build_node_id      INTEGER NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  environment        TEXT NOT NULL,
  deployed_by        TEXT,
  version            TEXT,
  deployed_at        INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_dr_build ON deployment_registry(build_node_id);
CREATE INDEX IF NOT EXISTS idx_dr_env ON deployment_registry(environment);
`
