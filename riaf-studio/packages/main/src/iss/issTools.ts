// packages/main/src/iss/issTools.ts
import type Database from 'better-sqlite3'
import type { SDLCMode } from '@shared/index'
import type { ILLMProvider, LLMMessage, LLMTool } from '../llm/llmProvider.interface'
import { registerToolPlugin } from '../riaf/riafTools'
import type { ToolCall } from '../riaf/riafTools'
import { getSetting } from '../settingsStore'
import { FISEngine } from './fisEngine'
import { SDLCRouter } from './sdlcRouter'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

function safeProvider(getProvider: () => ILLMProvider | null): ILLMProvider | null {
  try {
    return getProvider()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export function buildISSTools(): LLMTool[] {
  return [
    {
      name: 'trace_feature_to_code',
      description:
        'Trace a feature label to implementing code nodes via the ISS feature_traces table. Returns markdown grouped by SDLC phase.',
      input_schema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'Feature name or partial label to match' },
        },
        required: ['feature'],
      },
    },
    {
      name: 'impact_analysis',
      description:
        'Rank files likely impacted by a change using the FIS (Feature Impact Score) engine. Optionally bias by SDLC mode.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language description of the change or feature' },
          mode: {
            type: 'string',
            description: 'SDLC mode bias',
            enum: [
              'requirements',
              'design',
              'implementation',
              'testing',
              'deployment',
              'maintenance',
              'auto',
            ],
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'feature_status',
      description:
        'List FEATURE nodes with SDLC phase completion percentages from sdlc_phase_summary (or computed from IMPLEMENTS edges).',
      input_schema: {
        type: 'object',
        properties: {
          feature: {
            type: 'string',
            description: 'Optional feature label filter (partial match)',
          },
        },
      },
    },
    {
      name: 'find_similar_features',
      description:
        'Find FEATURE nodes similar to a given feature by shared IMPLEMENTS targets or similar labels.',
      input_schema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'Feature name or partial label' },
        },
        required: ['feature'],
      },
    },
    {
      name: 'generate_acceptance_criteria',
      description:
        'Generate acceptance criteria for a feature. Uses the LLM when available; otherwise returns heuristic criteria from the feature description.',
      input_schema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'Feature name or partial label' },
        },
        required: ['feature'],
      },
    },
    {
      name: 'suggest_architecture',
      description:
        'Suggest modules and domain services related to a feature via IMPLEMENTS/CALLS edges.',
      input_schema: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: 'Feature name or partial label' },
        },
        required: ['feature'],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeISSTool(
  tc: ToolCall,
  db: Database.Database,
  _workspaceRoot: string,
  getProvider: () => ILLMProvider | null,
): Promise<string> {
  switch (tc.name) {
    case 'trace_feature_to_code':
      return execTraceFeature(tc.input, db)
    case 'impact_analysis':
      return execImpactAnalysis(tc.input, db)
    case 'feature_status':
      return execFeatureStatus(tc.input, db)
    case 'find_similar_features':
      return execFindSimilar(tc.input, db)
    case 'generate_acceptance_criteria':
      return execGenCriteria(tc.input, db, getProvider)
    case 'suggest_architecture':
      return execSuggestArch(tc.input, db)
    default:
      return `Unknown ISS tool: ${tc.name}`
  }
}

export function registerISSToolPlugins(getProvider: () => ILLMProvider | null): void {
  for (const tool of buildISSTools()) {
    registerToolPlugin({
      tool,
      execute: (input, db, root) =>
        executeISSTool({ id: '', name: tool.name, input }, db, root, getProvider),
    })
  }
}

// ---------------------------------------------------------------------------
// Individual tools
// ---------------------------------------------------------------------------

function findFeatures(
  db: Database.Database,
  feature: string,
): { id: number; label: string; description: string | null }[] {
  const q = `%${feature.replace(/%/g, '')}%`
  return db
    .prepare<[string], { id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind IN ('FEATURE','EPIC','USER_STORY') AND label LIKE ? COLLATE NOCASE
       ORDER BY label LIMIT 20`,
    )
    .all(q)
}

function isTestPath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  const p = filePath.replace(/\\/g, '/').toLowerCase()
  return (
    p.includes('/__tests__/') ||
    p.includes('/__mocks__/') ||
    p.includes('/test/') ||
    p.includes('/tests/') ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(p)
  )
}

function execTraceFeature(input: Record<string, unknown>, db: Database.Database): string {
  const feature = String(input['feature'] ?? '').trim()
  if (!feature) return 'Error: feature is required'

  const features = findFeatures(db, feature)
  if (features.length === 0) return `No FEATURE nodes matching "${feature}".`

  const lines: string[] = [`# Feature → Code Trace: ${feature}`, '']

  for (const f of features) {
    lines.push(`## ${f.label} (id=${f.id})`, '')

    type TraceRow = {
      code_id: number
      code_label: string
      code_kind: string
      file_path: string | null
      sdlc_phase: string | null
      trace_type: string
      confidence: number
      edge_source: string | null
    }

    let rows = db
      .prepare<[number], TraceRow>(
        `SELECT
           cn.id as code_id, cn.label as code_label, cn.kind as code_kind,
           cn.file_path, cn.sdlc_phase,
           ft.trace_type, ft.confidence,
           (SELECT ge.source FROM graph_edges ge
            WHERE ge.from_node_id = ft.feature_node_id AND ge.to_node_id = ft.code_node_id
              AND ge.kind = 'IMPLEMENTS' LIMIT 1) as edge_source
         FROM feature_traces ft
         JOIN graph_nodes cn ON cn.id = ft.code_node_id
         WHERE ft.feature_node_id = ?
         ORDER BY cn.sdlc_phase, ft.confidence DESC`,
      )
      .all(f.id)

    // Fallback: direct IMPLEMENTS edges (before materializer ran, or materializer missed)
    if (rows.length === 0) {
      rows = db
        .prepare<[number], TraceRow>(
          `SELECT
             cn.id as code_id, cn.label as code_label, cn.kind as code_kind,
             cn.file_path, cn.sdlc_phase,
             'direct' as trace_type, ge.confidence,
             ge.source as edge_source
           FROM graph_edges ge
           JOIN graph_nodes cn ON cn.id = ge.to_node_id
           WHERE ge.from_node_id = ? AND ge.kind = 'IMPLEMENTS'
           ORDER BY ge.confidence DESC`,
        )
        .all(f.id)
    }

    const prodRows = rows.filter((r) => !isTestPath(r.file_path))
    const testOnly = rows.length > 0 && prodRows.length === 0
    rows = prodRows

    // Fallback: keyword suggestions from production code
    if (rows.length === 0) {
      const suggested = suggestCodeForFeature(db, f.label, f.description).filter(
        (s) => !isTestPath(s.file_path),
      )
      if (suggested.length === 0) {
        lines.push(
          testOnly
            ? '_Previously linked only to test fixtures (e.g. `__tests__`). No production code match found for this feature in this repo._'
            : '_No production code links for this feature._',
          '',
          'This often means the feature was auto-discovered but the app has no real implementation yet (common for “Authentication” in RIAF Studio).',
          '',
        )
        continue
      }

      lines.push(
        testOnly
          ? '_Ignored test-fixture links. Showing production code suggestions:_'
          : '_No formal IMPLEMENTS links yet — showing likely production code matches:_',
        '',
        '### suggested',
      )
      for (const r of suggested) {
        const loc = r.file_path ? ` \`${r.file_path}\`` : ''
        lines.push(
          `- **${r.code_label}** (${r.code_kind})${loc} — suggested, score=${r.score.toFixed(2)}`,
        )
      }
      lines.push('')
      continue
    }

    const byPhase = new Map<string, TraceRow[]>()
    for (const r of rows) {
      const phase = r.sdlc_phase ?? 'unknown'
      const list = byPhase.get(phase) ?? []
      list.push(r)
      byPhase.set(phase, list)
    }

    for (const [phase, items] of byPhase) {
      lines.push(`### ${phase}`)
      for (const r of items) {
        const loc = r.file_path ? ` \`${r.file_path}\`` : ''
        const src = formatTraceSource(r.edge_source)
        lines.push(
          `- **${r.code_label}** (${r.code_kind})${loc} — ${r.trace_type}, conf=${r.confidence.toFixed(2)}${src}`,
        )
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

/** Human-readable match method — avoid raw `bm25_fallback` which looks like an error. */
function formatTraceSource(source: string | null): string {
  if (!source) return ''
  if (source === 'bm25_fallback') return ' · via keyword match'
  if (source === 'llm') return ' · via embeddings'
  return ` · via ${source}`
}

/** Best-effort code suggestions when a feature has no IMPLEMENTS / feature_traces yet. */
function suggestCodeForFeature(
  db: Database.Database,
  label: string,
  description: string | null,
): { code_label: string; code_kind: string; file_path: string | null; score: number }[] {
  const raw = `${label} ${description ?? ''}`
  const tokens = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .flatMap((t) => {
      const out = [t]
      if (t.endsWith('ing') && t.length > 5) out.push(t.slice(0, -3))
      if (t.endsWith('er') && t.length > 4) out.push(t.slice(0, -2))
      return out
    })
    .filter((t) => t.length >= 4)
  const uniq = [...new Set(tokens)].slice(0, 10)
  if (uniq.length === 0) return []

  try {
    const rows = db
      .prepare<[], { code_label: string; code_kind: string; file_path: string | null }>(
        `SELECT label as code_label, kind as code_kind, file_path
         FROM graph_nodes
         WHERE kind IN ('DOMAIN_SERVICE','CLASS','MODULE','FUNCTION','INTERFACE')
         LIMIT 5000`,
      )
      .all()

    const scored = rows
      .map((r) => {
        if (isTestPath(r.file_path)) return null
        const hay = `${r.code_label} ${r.file_path ?? ''}`.toLowerCase()
        let hits = 0
        for (const t of uniq) {
          if (hay.includes(t)) hits += 1
        }
        return { ...r, score: hits / uniq.length }
      })
      .filter((r): r is NonNullable<typeof r> => r != null && r.score >= 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)

    return scored
  } catch {
    return []
  }
}

async function execImpactAnalysis(
  input: Record<string, unknown>,
  db: Database.Database,
): Promise<string> {
  const query = String(input['query'] ?? '').trim()
  if (!query) return 'Error: query is required'

  const modeRaw = input['mode']
  const mode: SDLCMode =
    typeof modeRaw === 'string' && modeRaw.length > 0
      ? (modeRaw as SDLCMode)
      : new SDLCRouter(db).detect({ userText: query })

  const engine = new FISEngine(db)
  const ranked = await engine.score(query, mode, 20)
  if (ranked.length === 0) return `No impact results for query: "${query}"`

  const blast = engine.getBlastRadius(
    ranked.slice(0, 5).map((r) => r.filePath),
    2,
  )

  const lines: string[] = [
    `# Impact Analysis`,
    `Query: ${query}`,
    `SDLC mode: ${mode}`,
    '',
    '## Ranked files',
    '',
  ]

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!
    const phase = r.sdlcPhase ?? '—'
    const kind = r.nodeKind ?? '—'
    lines.push(
      `${i + 1}. **${r.filePath}** — score=${r.score.toFixed(3)} · phase=${phase} · kind=${kind} · fan-in=${r.importedByCount}`,
    )
    lines.push(
      `   α=${r.components.alpha.toFixed(2)} β=${r.components.beta.toFixed(2)} γ=${r.components.gamma.toFixed(2)} δ=${r.components.delta.toFixed(2)} ε=${r.components.epsilon.toFixed(2)}`,
    )
  }

  if (blast.length > 0) {
    lines.push('', '## Blast radius (co-change partners)', '')
    for (const f of blast.slice(0, 30)) lines.push(`- ${f}`)
  }

  return lines.join('\n')
}

function computeCompletionPct(db: Database.Database, featureId: number): number {
  const summary = db
    .prepare<[number], { completion_pct: number }>(
      'SELECT completion_pct FROM sdlc_phase_summary WHERE feature_node_id = ?',
    )
    .get(featureId)
  if (summary) return summary.completion_pct

  const phases = db
    .prepare<[number], { sdlc_phase: string | null }>(
      `SELECT DISTINCT cn.sdlc_phase
       FROM graph_edges ge
       JOIN graph_nodes cn ON cn.id = ge.to_node_id
       WHERE ge.from_node_id = ? AND ge.kind = 'IMPLEMENTS' AND cn.sdlc_phase IS NOT NULL`,
    )
    .all(featureId)

  const set = new Set(phases.map((p) => p.sdlc_phase).filter(Boolean))
  const expected = ['requirements', 'design', 'implementation', 'testing', 'deployment']
  const hit = expected.filter((p) => set.has(p)).length
  return hit === 0 && set.size === 0
    ? 0
    : Math.round((hit / expected.length) * 1000) / 10
}

function execFeatureStatus(input: Record<string, unknown>, db: Database.Database): string {
  const filter =
    typeof input['feature'] === 'string' && input['feature'].trim()
      ? `%${String(input['feature']).replace(/%/g, '')}%`
      : null

  const features = filter
    ? db
        .prepare<[string], { id: number; label: string; description: string | null; source_type: string }>(
          `SELECT id, label, description, source_type FROM graph_nodes
           WHERE kind = 'FEATURE' AND label LIKE ? COLLATE NOCASE
           ORDER BY label`,
        )
        .all(filter)
    : db
        .prepare<[], { id: number; label: string; description: string | null; source_type: string }>(
          `SELECT id, label, description, source_type FROM graph_nodes
           WHERE kind = 'FEATURE' ORDER BY label`,
        )
        .all()

  if (features.length === 0) return 'No FEATURE nodes found.'

  const lines: string[] = ['# Feature Status', '']
  for (const f of features) {
    const pct = computeCompletionPct(db, f.id)
    const summary = db
      .prepare<
        [number],
        {
          has_requirements: number
          has_design: number
          has_implementation: number
          has_testing: number
          has_deployment: number
        }
      >(
        `SELECT has_requirements, has_design, has_implementation, has_testing, has_deployment
         FROM sdlc_phase_summary WHERE feature_node_id = ?`,
      )
      .get(f.id)

    const flags = summary
      ? [
          summary.has_requirements ? 'R' : '-',
          summary.has_design ? 'D' : '-',
          summary.has_implementation ? 'I' : '-',
          summary.has_testing ? 'T' : '-',
          summary.has_deployment ? 'P' : '-',
        ].join('')
      : 'computed'

    lines.push(
      `- **${f.label}** (${f.source_type}) — ${pct}% complete [${flags}]${f.description ? `\n  ${f.description.slice(0, 120)}` : ''}`,
    )
  }
  return lines.join('\n')
}

function execFindSimilar(input: Record<string, unknown>, db: Database.Database): string {
  const feature = String(input['feature'] ?? '').trim()
  if (!feature) return 'Error: feature is required'

  const features = findFeatures(db, feature)
  if (features.length === 0) return `No FEATURE nodes matching "${feature}".`

  const seed = features[0]!
  const lines: string[] = [`# Similar Features to "${seed.label}"`, '']

  const shared = db
    .prepare<
      [number, number],
      { id: number; label: string; shared: number }
    >(
      `SELECT other.id, other.label, COUNT(*) as shared
       FROM graph_edges ge1
       JOIN graph_edges ge2 ON ge2.to_node_id = ge1.to_node_id AND ge2.kind = 'IMPLEMENTS'
       JOIN graph_nodes other ON other.id = ge2.from_node_id AND other.kind = 'FEATURE'
       WHERE ge1.from_node_id = ? AND ge1.kind = 'IMPLEMENTS' AND other.id != ?
       GROUP BY other.id
       ORDER BY shared DESC
       LIMIT 15`,
    )
    .all(seed.id, seed.id)

  if (shared.length > 0) {
    lines.push('## Shared IMPLEMENTS targets', '')
    for (const s of shared) {
      lines.push(`- **${s.label}** — ${s.shared} shared target(s)`)
    }
    lines.push('')
  }

  const tokens = seed.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
  const labelHits: { id: number; label: string }[] = []
  if (tokens.length > 0) {
    const like = `%${tokens[0]}%`
    const rows = db
      .prepare<[number, string], { id: number; label: string }>(
        `SELECT id, label FROM graph_nodes
         WHERE kind = 'FEATURE' AND id != ? AND label LIKE ? COLLATE NOCASE
         ORDER BY label LIMIT 15`,
      )
      .all(seed.id, like)
    for (const r of rows) {
      if (!shared.some((s) => s.id === r.id)) labelHits.push(r)
    }
  }

  if (labelHits.length > 0) {
    lines.push('## Similar labels', '')
    for (const h of labelHits) lines.push(`- **${h.label}**`)
  }

  if (shared.length === 0 && labelHits.length === 0) {
    lines.push('_No similar features found._')
  }

  return lines.join('\n')
}

async function execGenCriteria(
  input: Record<string, unknown>,
  db: Database.Database,
  getProvider: () => ILLMProvider | null,
): Promise<string> {
  const feature = String(input['feature'] ?? '').trim()
  if (!feature) return 'Error: feature is required'

  const features = findFeatures(db, feature)
  if (features.length === 0) return `No FEATURE nodes matching "${feature}".`

  const f = features[0]!
  const desc = f.description ?? f.label

  const existingTests = db
    .prepare<[number], { label: string }>(
      `SELECT cn.label FROM feature_traces ft
       JOIN graph_nodes cn ON cn.id = ft.code_node_id
       WHERE ft.feature_node_id = ? AND cn.kind IN ('TEST_CASE','TEST_SUITE')
       LIMIT 10`,
    )
    .all(f.id)

  const provider = safeProvider(getProvider)
  if (provider) {
    try {
      const testHint =
        existingTests.length > 0
          ? `\nExisting test cases:\n${existingTests.map((t) => `- ${t.label}`).join('\n')}`
          : ''
      const msg = await provider.complete({
        model: getSetting('defaultModel'),
        system:
          'You write concise Given/When/Then acceptance criteria for product features. Return a markdown bullet list only.',
        messages: [
          {
            role: 'user',
            content: `Feature: ${f.label}\nDescription: ${desc}${testHint}\n\nWrite 5–8 acceptance criteria.`,
          },
        ],
        max_tokens: 800,
      })
      const text = llmText(msg).trim()
      if (text) return `# Acceptance Criteria: ${f.label}\n\n${text}`
    } catch {
      // fall through to heuristic
    }
  }

  // Heuristic fallback
  const sentences = desc
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
  const lines: string[] = [`# Acceptance Criteria: ${f.label}`, '', '_Heuristic (LLM unavailable)_', '']
  if (sentences.length === 0) {
    lines.push(`- Given the system is available, when a user uses "${f.label}", then the described behavior succeeds.`)
  } else {
    for (const s of sentences.slice(0, 6)) {
      lines.push(`- Given a valid context, when ${s.charAt(0).toLowerCase()}${s.slice(1)}, then the outcome is observable and correct.`)
    }
  }
  for (const t of existingTests.slice(0, 3)) {
    lines.push(`- Cover existing test: ${t.label}`)
  }
  return lines.join('\n')
}

function execSuggestArch(input: Record<string, unknown>, db: Database.Database): string {
  const feature = String(input['feature'] ?? '').trim()
  if (!feature) return 'Error: feature is required'

  const features = findFeatures(db, feature)
  if (features.length === 0) return `No FEATURE nodes matching "${feature}".`

  const f = features[0]!
  const lines: string[] = [`# Architecture Suggestions: ${f.label}`, '']

  const related = db
    .prepare<
      [number],
      {
        id: number
        label: string
        kind: string
        file_path: string | null
        importance_score: number
        via: string
      }
    >(
      `SELECT DISTINCT gn.id, gn.label, gn.kind, gn.file_path, gn.importance_score,
              ge.kind as via
       FROM graph_edges ge
       JOIN graph_nodes gn ON gn.id = ge.to_node_id
       WHERE ge.from_node_id = ?
         AND ge.kind IN ('IMPLEMENTS','CALLS','DEPENDS_ON')
         AND gn.kind IN ('DOMAIN_SERVICE','MODULE','CLASS')
       ORDER BY gn.importance_score DESC
       LIMIT 25`,
    )
    .all(f.id)

  // Also pull DOMAIN_SERVICE / MODULE nodes linked transitively via IMPLEMENTS → CALLS
  const transitive = db
    .prepare<
      [number],
      {
        id: number
        label: string
        kind: string
        file_path: string | null
        importance_score: number
      }
    >(
      `SELECT DISTINCT ds.id, ds.label, ds.kind, ds.file_path, ds.importance_score
       FROM graph_edges ge1
       JOIN graph_edges ge2 ON ge2.from_node_id = ge1.to_node_id AND ge2.kind IN ('CALLS','DEPENDS_ON','IMPORTS')
       JOIN graph_nodes ds ON ds.id = ge2.to_node_id
       WHERE ge1.from_node_id = ? AND ge1.kind = 'IMPLEMENTS'
         AND ds.kind IN ('DOMAIN_SERVICE','MODULE')
       ORDER BY ds.importance_score DESC
       LIMIT 15`,
    )
    .all(f.id)

  if (related.length === 0 && transitive.length === 0) {
    // Fallback: top services by importance + label similarity
    const token = f.label.split(/\s+/)[0] ?? f.label
    const fallback = db
      .prepare<[string], { id: number; label: string; kind: string; file_path: string | null; importance_score: number }>(
        `SELECT id, label, kind, file_path, importance_score FROM graph_nodes
         WHERE kind IN ('DOMAIN_SERVICE','MODULE')
           AND (label LIKE ? COLLATE NOCASE OR importance_score > 0.3)
         ORDER BY importance_score DESC LIMIT 15`,
      )
      .all(`%${token}%`)

    if (fallback.length === 0) return `${lines.join('\n')}_No related modules/services found._`

    lines.push('## Suggested modules / services (by importance + label)', '')
    for (const r of fallback) {
      const loc = r.file_path ? ` — \`${r.file_path}\`` : ''
      lines.push(
        `- **${r.label}** (${r.kind}, score=${r.importance_score.toFixed(3)})${loc}`,
      )
    }
    return lines.join('\n')
  }

  if (related.length > 0) {
    lines.push('## Directly related (IMPLEMENTS / CALLS)', '')
    for (const r of related) {
      const loc = r.file_path ? ` — \`${r.file_path}\`` : ''
      lines.push(
        `- **${r.label}** (${r.kind}, via ${r.via}, score=${r.importance_score.toFixed(3)})${loc}`,
      )
    }
    lines.push('')
  }

  if (transitive.length > 0) {
    lines.push('## Related via call graph', '')
    const seen = new Set(related.map((r) => r.id))
    for (const r of transitive) {
      if (seen.has(r.id)) continue
      const loc = r.file_path ? ` — \`${r.file_path}\`` : ''
      lines.push(
        `- **${r.label}** (${r.kind}, score=${r.importance_score.toFixed(3)})${loc}`,
      )
    }
  }

  return lines.join('\n')
}
