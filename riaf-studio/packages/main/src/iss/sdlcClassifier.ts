// packages/main/src/iss/sdlcClassifier.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ISSPassProgress } from '@shared/index'
import type { ILLMProvider, LLMMessage } from '../llm/llmProvider.interface'

type PhaseTag =
  | 'requirements'
  | 'design'
  | 'implementation'
  | 'testing'
  | 'deployment'
  | 'maintenance'
type Rule = { pattern: RegExp; phase: PhaseTag; confidence: number }

function llmText(msg: LLMMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
}

const RULES: Rule[] = [
  { pattern: /\.(spec|test)\.(ts|tsx|js|jsx|py|java|go|rs)$/i, phase: 'testing', confidence: 0.99 },
  { pattern: /__tests__\//i, phase: 'testing', confidence: 0.98 },
  { pattern: /Dockerfile$|docker-compose/i, phase: 'deployment', confidence: 0.99 },
  { pattern: /\.github\/workflows\//i, phase: 'deployment', confidence: 0.99 },
  { pattern: /terraform\/.*\.tf$/i, phase: 'deployment', confidence: 0.98 },
  { pattern: /kubernetes\/|k8s\//i, phase: 'deployment', confidence: 0.97 },
  { pattern: /migrations?\/.*\.(sql|ts|js|py)$/i, phase: 'maintenance', confidence: 0.97 },
  { pattern: /CHANGELOG\.md$/i, phase: 'maintenance', confidence: 0.95 },
  { pattern: /\.interface\.(ts|tsx)$/i, phase: 'design', confidence: 0.95 },
  { pattern: /openapi\.(ya?ml|json)$|swagger\.(ya?ml|json)$/i, phase: 'design', confidence: 0.97 },
  { pattern: /\.proto$/i, phase: 'design', confidence: 0.97 },
  { pattern: /ARCHITECTURE\.md$/i, phase: 'design', confidence: 0.93 },
  { pattern: /\.feature$/i, phase: 'requirements', confidence: 0.99 },
  { pattern: /README\.md$/i, phase: 'requirements', confidence: 0.8 },
  { pattern: /\.service\.(ts|js)$/i, phase: 'implementation', confidence: 0.92 },
  { pattern: /\.controller\.(ts|js)$/i, phase: 'implementation', confidence: 0.92 },
  { pattern: /\.repository\.(ts|js)$/i, phase: 'implementation', confidence: 0.92 },
  { pattern: /\.(ts|tsx|js|jsx|py|java|go|rs|cs|kt)$/i, phase: 'implementation', confidence: 0.75 },
]

const LLM_THRESHOLD = 0.8

export class SDLCClassifier {
  private readonly updatePhase: Database.Statement

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
    private readonly provider: ILLMProvider | null,
  ) {
    this.updatePhase = db.prepare(
      'UPDATE graph_nodes SET sdlc_phase = ?, sdlc_confidence = ? WHERE id = ?',
    )
  }

  async classifyAll(push: (p: ISSPassProgress) => void): Promise<void> {
    const nodes = this.db
      .prepare<[], { id: number; file_path: string | null; label: string }>(
        'SELECT id, file_path, label FROM graph_nodes WHERE sdlc_phase IS NULL',
      )
      .all()

    const llmQueue: typeof nodes = []
    const ruleBatch: { id: number; phase: PhaseTag; confidence: number }[] = []
    const total = nodes.length || 1

    const flushRules = this.db.transaction(
      (rows: { id: number; phase: PhaseTag; confidence: number }[]) => {
        for (const r of rows) this.updatePhase.run(r.phase, r.confidence, r.id)
      },
    )

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const fp = node.file_path ?? node.label
      const hit = this.matchRule(fp)

      if (hit) {
        ruleBatch.push({ id: node.id, phase: hit.phase, confidence: hit.confidence })
        if (hit.confidence < LLM_THRESHOLD && node.file_path) llmQueue.push(node)
      } else {
        ruleBatch.push({ id: node.id, phase: 'requirements', confidence: 0.5 })
      }

      if (i % 500 === 0) {
        flushRules(ruleBatch.splice(0))
        push({
          pass: 'A',
          stage: 'sdlc_classify',
          pct: Math.round((i / total) * 90),
          detail: `${i}/${nodes.length}`,
        })
      }
    }
    if (ruleBatch.length > 0) flushRules(ruleBatch)

    if (llmQueue.length > 0 && this.provider) {
      push({
        pass: 'A',
        stage: 'sdlc_classify',
        pct: 90,
        detail: `LLM fallback for ${llmQueue.length} ambiguous files…`,
      })
      await this.llmClassify(llmQueue)
    }

    push({
      pass: 'A',
      stage: 'sdlc_classify',
      pct: 100,
      detail: `${nodes.length} nodes phase-tagged`,
    })
  }

  private matchRule(fp: string): { phase: PhaseTag; confidence: number } | null {
    for (const r of RULES) if (r.pattern.test(fp)) return r
    return null
  }

  private async llmClassify(nodes: { id: number; file_path: string | null }[]) {
    if (!this.provider) return

    const BATCH = 10
    const batchUpdate = this.db.transaction(
      (rows: { id: number; phase: PhaseTag; confidence: number }[]) => {
        for (const r of rows) this.updatePhase.run(r.phase, r.confidence, r.id)
      },
    )

    for (let i = 0; i < nodes.length; i += BATCH) {
      const batch = nodes.slice(i, i + BATCH)
      const fileList = batch
        .map((n) => {
          const fp = n.file_path!
          let first50 = ''
          try {
            first50 = fs
              .readFileSync(path.join(this.root, fp), 'utf8')
              .split('\n')
              .slice(0, 50)
              .join('\n')
          } catch {
            /* ignore */
          }
          return `FILE: ${fp}\n${first50}\n---`
        })
        .join('\n')

      try {
        const resp = await this.provider.complete({
          model: 'claude-haiku-4-5',
          system: 'You classify files by SDLC phase. Return only JSON array, no prose.',
          messages: [
            {
              role: 'user',
              content:
                `Classify each file. Reply ONLY with JSON:\n` +
                `[{"path":"...","phase":"requirements|design|implementation|testing|deployment|maintenance","confidence":0.0}]\n\n${fileList}`,
            },
          ],
          max_tokens: 300,
        })
        const text = llmText(resp)
        const results = JSON.parse(text.replace(/```json|```/g, '').trim()) as {
          path: string
          phase: PhaseTag
          confidence: number
        }[]
        batchUpdate(
          batch.map((n) => {
            const found = results.find((r) => r.path === n.file_path)
            return {
              id: n.id,
              phase: found?.phase ?? 'implementation',
              confidence: found?.confidence ?? 0.6,
            }
          }),
        )
      } catch {
        /* keep rule-based classification on failure */
      }
    }
  }
}
