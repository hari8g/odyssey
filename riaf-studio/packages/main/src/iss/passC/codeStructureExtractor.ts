// packages/main/src/iss/passC/codeStructureExtractor.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../llm/llmProvider.interface'

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export class CodeStructureExtractor {
  private readonly insertSuggestion: Database.Statement
  private readonly findSuggestion: Database.Statement<[string], { id: number }>

  constructor(
    private readonly db: Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.insertSuggestion = db.prepare(`
      INSERT INTO feature_suggestions
        (label, description, sdlc_phase, confidence, source, status)
      VALUES (?, ?, 'requirements', 0.50, 'code_structure', 'pending')
    `)
    this.findSuggestion = db.prepare<[string], { id: number }>(
      `SELECT id FROM feature_suggestions WHERE LOWER(label) = LOWER(?) LIMIT 1`,
    )
  }

  async extract(progress: (pct: number, detail: string) => void): Promise<number> {
    progress(10, 'Reading domain services from graph…')

    const services = this.db
      .prepare<[], { label: string; file_path: string | null }>(
        `SELECT label, file_path FROM graph_nodes
       WHERE kind = 'DOMAIN_SERVICE' ORDER BY importance_score DESC LIMIT 30`,
      )
      .all()

    const modules = this.db
      .prepare<[], { label: string }>(
        `SELECT label FROM graph_nodes WHERE kind = 'MODULE'
       ORDER BY importance_score DESC LIMIT 15`,
      )
      .all()

    const hotFiles = this.db
      .prepare<[], { file_path: string }>(
        `SELECT file_path FROM ucg_file_nodes
       ORDER BY imported_by_count DESC LIMIT 10`,
      )
      .all()

    const serviceList = services
      .map((s) => `  - ${s.label}${s.file_path ? ` (${s.file_path})` : ''}`)
      .join('\n')
    const moduleList = modules.map((m) => `  - ${m.label}`).join('\n')
    const hotList = hotFiles.map((f) => `  - ${f.file_path}`).join('\n')

    if (services.length === 0 && modules.length === 0) {
      progress(100, 'No structural data yet — run Pass A first')
      return 0
    }

    progress(40, 'Asking LLM to infer features from code structure…')

    const prompt = `You are analyzing a software codebase. Based on the structural information below,
infer what BUSINESS FEATURES this codebase likely implements.

Domain Services found:
${serviceList || '  (none found)'}

Top-level Modules:
${moduleList || '  (none found)'}

Most-imported files (architectural hotspots):
${hotList || '  (none found)'}

Task: Generate 5–10 likely business feature names with descriptions.
Each feature should be a distinct user-facing capability.
Return ONLY a JSON array — no prose, no markdown fences:
[{"name": "Feature Name", "description": "One sentence: what users can do"}]`

    try {
      const response = await this.provider.complete({
        model: 'claude-haiku-4-5',
        system: 'You infer business features from code structure. Return only JSON array.',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      })

      progress(80, 'Saving suggestions for review…')

      const clean = llmText(response).replace(/```json|```/g, '').trim()
      const features = JSON.parse(clean) as { name: string; description: string }[]

      let inserted = 0
      const batch = this.db.transaction(() => {
        for (const f of features) {
          if (!f.name || f.name.length < 3) continue
          const label = f.name.slice(0, 200)
          if (this.findSuggestion.get(label)) continue
          this.insertSuggestion.run(label, (f.description ?? '').slice(0, 500))
          inserted++
        }
      })
      batch()

      const count = (
        this.db
          .prepare<[], { n: number }>(
            `SELECT COUNT(*) as n FROM feature_suggestions WHERE status = 'pending'`,
          )
          .get()!
      ).n

      progress(100, `${count} suggestions saved for review`)
      return count
    } catch (err) {
      progress(100, `Auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`)
      return 0
    }
  }

  approveSuggestion(id: number): { nodeId: number } {
    const sug = this.db
      .prepare<[number], { id: number; label: string; description: string; sdlc_phase: string }>(
        'SELECT id, label, description, sdlc_phase FROM feature_suggestions WHERE id = ?',
      )
      .get(id)
    if (!sug) throw new Error(`Suggestion ${id} not found`)

    const result = this.db
      .prepare(
        `
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'code_structure', ?, 0.50, 0.0, unixepoch() * 1000)
    `,
      )
      .run(sug.label, sug.description, sug.sdlc_phase)

    const nodeId = Number(result.lastInsertRowid)
    this.db
      .prepare(
        `UPDATE feature_suggestions SET status = 'approved', node_id = ?, reviewed_at = unixepoch() * 1000 WHERE id = ?`,
      )
      .run(nodeId, id)

    return { nodeId }
  }

  rejectSuggestion(id: number): void {
    this.db
      .prepare(
        `UPDATE feature_suggestions SET status = 'rejected', reviewed_at = unixepoch() * 1000 WHERE id = ?`,
      )
      .run(id)
  }

  approveAll(): number {
    const pending = this.db
      .prepare<[], { id: number }>(`SELECT id FROM feature_suggestions WHERE status = 'pending'`)
      .all()
    let approved = 0
    for (const { id } of pending) {
      try {
        this.approveSuggestion(id)
        approved++
      } catch {
        /* skip */
      }
    }
    return approved
  }
}
