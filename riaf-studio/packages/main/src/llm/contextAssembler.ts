// packages/main/src/llm/contextAssembler.ts

import type Database from 'better-sqlite3'
import type { RiafIndexSnapshot } from '@shared/index'
import type {
  WorkspaceProfile,
  FrameworkEntry,
  CommandEntry,
  UCGGraphMetrics,
  GitFileStats,
} from '@shared/index'

// ---------------------------------------------------------------------------
// buildSnapshotFromDb
// ---------------------------------------------------------------------------

export function buildSnapshotFromDb(db: Database.Database): RiafIndexSnapshot {
  // --- workspace_profiles ---
  const profileRow = db
    .prepare(
      `SELECT workspace_root, language_stack_json, frameworks_json, package_managers_json,
              build_commands_json, test_commands_json, file_count, total_loc,
              project_purpose, architecture_summary
       FROM workspace_profiles WHERE id = 1`,
    )
    .get() as
    | {
        workspace_root: string
        language_stack_json: string
        frameworks_json: string
        package_managers_json: string
        build_commands_json: string
        test_commands_json: string
        file_count: number
        total_loc: number
        project_purpose: string | null
        architecture_summary: string | null
      }
    | undefined

  let profile: Partial<WorkspaceProfile> = {}
  if (profileRow) {
    profile = {
      languageStack: JSON.parse(profileRow.language_stack_json) as string[],
      frameworks: JSON.parse(profileRow.frameworks_json) as FrameworkEntry[],
      packageManagers: JSON.parse(profileRow.package_managers_json) as string[],
      buildCommands: JSON.parse(profileRow.build_commands_json) as CommandEntry[],
      testCommands: JSON.parse(profileRow.test_commands_json) as CommandEntry[],
      fileCount: profileRow.file_count,
      totalLoc: profileRow.total_loc,
      projectPurpose: profileRow.project_purpose,
      architectureSummary: profileRow.architecture_summary,
    }
  }

  // --- chunk count ---
  const chunkRow = db.prepare('SELECT COUNT(*) as cnt FROM code_chunks').get() as {
    cnt: number
  }
  const chunkCount = chunkRow?.cnt ?? 0

  // --- symbol count ---
  const symRow = db.prepare('SELECT COUNT(*) as cnt FROM symbols').get() as { cnt: number }
  const symbolCount = symRow?.cnt ?? 0

  // --- ucg_graph_metrics ---
  const metricsRow = db
    .prepare(
      `SELECT cycle_count, hot_files_json, external_deps_json FROM ucg_graph_metrics WHERE id = 1`,
    )
    .get() as
    | { cycle_count: number; hot_files_json: string; external_deps_json: string }
    | undefined

  let cycleCount = 0
  let hotFiles: string[] = []
  let externalDepCount = 0

  if (metricsRow) {
    cycleCount = metricsRow.cycle_count
    hotFiles = JSON.parse(metricsRow.hot_files_json) as string[]
    const extDeps = JSON.parse(metricsRow.external_deps_json) as Record<string, number>
    externalDepCount = Object.keys(extDeps).length
  }

  // --- git_file_stats: recently changed (top 10 by change_count) ---
  const gitRows = db
    .prepare(
      `SELECT file_path FROM git_file_stats ORDER BY change_count DESC LIMIT 10`,
    )
    .all() as { file_path: string }[]

  const recentlyChanged = gitRows.map((r) => r.file_path)

  return {
    languageStack: (profile.languageStack as string[]) ?? [],
    frameworks: ((profile.frameworks as FrameworkEntry[]) ?? []).map((f) => f.name),
    packageManagers: (profile.packageManagers as string[]) ?? [],
    fileCount: profile.fileCount ?? 0,
    totalLoc: profile.totalLoc ?? 0,
    chunkCount,
    symbolCount,
    projectPurpose: profile.projectPurpose ?? null,
    architectureSummary: profile.architectureSummary ?? null,
    buildCommands: ((profile.buildCommands as CommandEntry[]) ?? []).map((c) => c.command),
    testCommands: ((profile.testCommands as CommandEntry[]) ?? []).map((c) => c.command),
    hotFiles,
    cycleCount,
    externalDepCount,
    gitBranch: null, // not stored in DB — could read from git at runtime
    recentlyChanged,
  }
}

// ---------------------------------------------------------------------------
// buildRiafSystemPrompt
// ---------------------------------------------------------------------------

export function buildRiafSystemPrompt(
  snapshot: RiafIndexSnapshot,
  db?: Database.Database,
): string {
  const langs = snapshot.languageStack.join(', ') || 'unknown'
  const frameworks = snapshot.frameworks.join(', ') || 'none detected'
  const pkgMgrs = snapshot.packageManagers.join(', ') || 'unknown'

  let issBlock = ''
  if (db) {
    try {
      const featureCount =
        db
          .prepare<[], { n: number }>(
            `SELECT COUNT(*) as n FROM graph_nodes WHERE kind IN ('FEATURE','EPIC','USER_STORY')`,
          )
          .get()?.n ?? 0
      const traceCount =
        db.prepare<[], { n: number }>('SELECT COUNT(*) as n FROM feature_traces').get()?.n ?? 0
      if (featureCount > 0) {
        const hasEmbed =
          (db
            .prepare<[], { n: number }>(
              `SELECT COUNT(*) as n FROM graph_nodes WHERE kind='FEATURE' AND embedding_vec IS NOT NULL`,
            )
            .get()?.n ?? 0) > 0
        issBlock = `
## ISS Graph
- Features: ${featureCount}
- Traces: ${traceCount}
- Alignment: ${hasEmbed ? 'embedding' : 'bm25_fallback'}
You may use ISS tools: trace_feature_to_code, impact_analysis, feature_status,
find_similar_features, generate_acceptance_criteria, suggest_architecture.
`
      }
    } catch {
      // ISS tables may not exist yet
    }
  }

  return `\
You are RIAF (Repository Intelligence & Analysis Framework), an expert software architect AI.

## Your Mission
Produce a structured, authoritative repository-context document that gives any LLM or developer
instant, deep understanding of this codebase. Every section must be grounded in evidence from the
tools. Do not hallucinate — use read_file, search_codebase, search_symbols, get_file_outline,
get_import_graph, get_tests_for_file, get_ucg_metrics, ls_dir, and get_recently_changed to
collect facts before writing each section.

## Indexed Snapshot
- Language stack : ${langs}
- Frameworks     : ${frameworks}
- Package managers: ${pkgMgrs}
- Files indexed  : ${snapshot.fileCount}
- Lines of code  : ${snapshot.totalLoc.toLocaleString()}
- Code chunks    : ${snapshot.chunkCount}
- Symbols indexed: ${snapshot.symbolCount}
- Import cycles  : ${snapshot.cycleCount}
- External deps  : ${snapshot.externalDepCount}
- Hot files      : ${snapshot.hotFiles.slice(0, 5).join(', ') || 'none'}
- Recently changed: ${snapshot.recentlyChanged.slice(0, 5).join(', ') || 'none'}
${snapshot.projectPurpose ? `- Project purpose: ${snapshot.projectPurpose}` : ''}
${snapshot.architectureSummary ? `- Architecture: ${snapshot.architectureSummary}` : ''}
${issBlock}
## Output Rules
1. Write in plain Markdown with the exact 12-section headings provided.
2. Every claim must come from tool results — cite file paths and line numbers.
3. Code examples should be concise (< 20 lines) but real.
4. Be honest about uncertainty: write "not detected" rather than guessing.
5. When done, output the final Markdown document as your last assistant message.`
}
