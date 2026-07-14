// packages/main/src/iss/passC/docMiner.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage } from '../../llm/llmProvider.interface'

const DOC_FILES = [
  'README.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/features.md',
]

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

export class DocMiner {
  private readonly insert: Database.Statement
  private readonly findByLabel: Database.Statement<[string], { id: number }>

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
    private readonly provider: ILLMProvider,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase, sdlc_confidence,
         importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'llm', 'requirements', 0.60, 0.0, unixepoch() * 1000)
    `)
    this.findByLabel = db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'FEATURE' AND LOWER(label) = LOWER(?) LIMIT 1`,
    )
  }

  async mine(progress: (pct: number, detail: string) => void): Promise<number> {
    const docs = DOC_FILES.map((f) => path.join(this.root, f)).filter(fs.existsSync)
    let total = 0
    if (docs.length === 0) {
      progress(100, 'No documentation found')
      return 0
    }

    for (let i = 0; i < docs.length; i++) {
      progress(Math.round((i / docs.length) * 100), `Mining ${path.basename(docs[i]!)}…`)
      const content = fs.readFileSync(docs[i]!, 'utf8').slice(0, 8_000)
      try {
        const resp = await this.provider.complete({
          model: 'claude-haiku-4-5',
          system: 'Extract feature names from documentation. Return only JSON array, no prose.',
          messages: [
            {
              role: 'user',
              content:
                `Extract all software features. Return ONLY:\n` +
                `[{"name":"Short feature name","description":"One sentence"}]\n\n${content}`,
            },
          ],
          max_tokens: 1500,
        })
        const text = llmText(resp)
        const features = JSON.parse(text.replace(/```json|```/g, '').trim()) as {
          name: string
          description: string
        }[]
        const batch = this.db.transaction(() => {
          for (const f of features) {
            if (!f.name || f.name.length < 3) continue
            const label = f.name.slice(0, 200)
            if (this.findByLabel.get(label)) continue
            this.insert.run(label, (f.description ?? '').slice(0, 500))
            total++
          }
        })
        batch()
      } catch {
        /* skip this doc on any error */
      }
    }
    return total
  }
}
