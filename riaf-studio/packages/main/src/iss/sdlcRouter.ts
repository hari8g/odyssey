// packages/main/src/iss/sdlcRouter.ts
import type Database from 'better-sqlite3'
import type { SDLCMode } from '@shared/index'

const MODE_SIGNALS: { mode: SDLCMode; patterns: RegExp[] }[] = [
  {
    mode: 'requirements',
    patterns: [/requirements?|user stor|epic|acceptance criteria|product owner|backlog/i],
  },
  {
    mode: 'design',
    patterns: [/design|architect|interface|schema|openapi|api contract|data model/i],
  },
  {
    mode: 'implementation',
    patterns: [/implement|build|code|develop|write the/i],
  },
  {
    mode: 'testing',
    patterns: [/test|spec|coverage|assertion|vitest|jest|pytest|e2e/i],
  },
  {
    mode: 'deployment',
    patterns: [/deploy|docker|kubernetes|ci\/cd|pipeline|terraform|release/i],
  },
  {
    mode: 'maintenance',
    patterns: [/migrat|deprecat|refactor|changelog|legacy|technical debt/i],
  },
]

export class SDLCRouter {
  private current: SDLCMode = 'auto'

  constructor(private readonly db: Database.Database) {}

  getMode(): SDLCMode {
    return this.current
  }

  setMode(m: SDLCMode): void {
    this.current = m
  }

  detect(opts: { userText?: string; activeFile?: string; featureId?: number }): SDLCMode {
    if (this.current !== 'auto') return this.current
    if (opts.userText) {
      for (const { mode, patterns } of MODE_SIGNALS)
        if (patterns.some((p) => p.test(opts.userText!))) return mode
    }
    if (opts.activeFile) {
      const row = this.db
        .prepare<[string], { sdlc_phase: string | null }>(
          'SELECT sdlc_phase FROM graph_nodes WHERE file_path=? AND sdlc_phase IS NOT NULL LIMIT 1',
        )
        .get(opts.activeFile)
      if (row?.sdlc_phase) return row.sdlc_phase as SDLCMode
    }
    if (opts.featureId) {
      const has = this.db
        .prepare<[number], { cnt: number }>(
          `SELECT COUNT(*) as cnt FROM graph_edges WHERE from_node_id=? AND kind='IMPLEMENTS'`,
        )
        .get(opts.featureId)
      if ((has?.cnt ?? 0) === 0) return 'design'
    }
    return 'implementation'
  }

  getActiveTools(mode: SDLCMode): string[] {
    const PO = [
      'trace_feature_to_code',
      'impact_analysis',
      'feature_status',
      'find_similar_features',
      'generate_acceptance_criteria',
      'suggest_architecture',
    ]
    const RIAF = [
      'read_file',
      'search_codebase',
      'search_symbols',
      'get_file_outline',
      'get_import_graph',
      'get_tests_for_file',
      'get_ucg_metrics',
      'ls_dir',
      'get_recently_changed',
    ]
    if (mode === 'requirements') return [...PO, 'read_file', 'search_codebase']
    if (mode === 'design') return [...PO, 'read_file', 'search_symbols', 'get_file_outline']
    return [...PO, ...RIAF]
  }

  getModePromptBlock(mode: SDLCMode): string {
    const FRAMES: Partial<Record<SDLCMode, string>> = {
      requirements:
        'You are helping a PRODUCT OWNER define features. Prioritize business clarity.',
      design:
        "You are helping design interfaces and architecture matching this codebase's conventions.",
      implementation:
        'You are helping a developer implement features. Be precise about call chains and types.',
      testing: 'You are helping write and review tests. Focus on coverage gaps.',
      deployment:
        'You are helping with deployment. Focus on Docker, CI config, environment variables.',
      maintenance:
        'You are helping with maintenance. Focus on migrations, deprecations, technical debt.',
    }
    const f = FRAMES[mode]
    return f ? `\n## SDLC Mode: ${mode.toUpperCase()}\n${f}\n` : ''
  }
}
