// packages/main/src/iss/passC/embeddingAligner.ts
import type Database from 'better-sqlite3'
import type { AlignmentResult } from '@shared/index'
import { EmbeddingService } from '../../indexer/embeddingService'
import { getSetting } from '../../settingsStore'

/** Cosine floor — Odyssey features vs short service labels often score ~0.1–0.3. */
const COSINE_THRESHOLD = 0.42
const KEYWORD_CONFIDENCE = 0.55
const ALIGN_KINDS = `('DOMAIN_SERVICE','CLASS','MODULE')` as const
const EMBED_BATCH = 64

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

type CodeTarget = {
  id: number
  label: string
  description: string | null
  file_path: string | null
  embedding_vec: Buffer | null
  tokens: string[]
}

const WEAK_TOKENS = new Set([
  'and',
  'for',
  'the',
  'with',
  'from',
  'into',
  'that',
  'this',
  'code',
  'file',
  'data',
  'user',
  'system',
  'access',
  'control',
  'management',
  'based',
  'multi',
  'powered',
  'studio',
  'main',
  'packages',
  'src',
  'index',
  'agent',
  'agents',
])

/** Split CamelCase / snake / punctuation and light stems for matching. */
export function tokenizeLabel(text: string): string[] {
  const parts = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)

  const out = new Set<string>()
  for (const t of parts) {
    if (WEAK_TOKENS.has(t)) continue
    out.add(t)
    if (t.endsWith('ing') && t.length > 5) out.add(t.slice(0, -3))
    if (t.endsWith('tion') && t.length > 6) out.add(t.slice(0, -4))
    if (t.endsWith('ment') && t.length > 6) out.add(t.slice(0, -4))
    if (t.endsWith('ers') && t.length > 5) out.add(t.slice(0, -1))
    if (t.endsWith('er') && t.length > 4) {
      out.add(t.slice(0, -2))
      out.add(t)
    }
  }
  for (const t of [...out]) {
    if (t.endsWith('ing') && t.length > 5) out.add(t.slice(0, -3))
  }
  return [...out].filter((t) => !WEAK_TOKENS.has(t))
}

function stemCompatible(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (!longer.startsWith(shorter) || shorter.length < 4) return false
  const suffix = longer.slice(shorter.length)
  return (
    suffix === '' ||
    suffix === 'e' ||
    suffix === 's' ||
    suffix === 'er' ||
    suffix === 'ers' ||
    suffix === 'ing' ||
    suffix === 'or' ||
    suffix === 'ion' ||
    suffix === 'tion' ||
    suffix === 'ation' ||
    suffix === 'ment'
  )
}

export function keywordScore(featureLabel: string, featureDesc: string | null, code: CodeTarget): number {
  const labelTokens = tokenizeLabel(featureLabel)
  const descTokens = tokenizeLabel(featureDesc ?? '')
  if (labelTokens.length === 0 && descTokens.length === 0) return 0
  const cTokens = code.tokens
  const cSet = new Set(cTokens)

  const matchCount = (tokens: string[]): number => {
    let hits = 0
    for (const t of tokens) {
      if (cSet.has(t)) {
        hits += t.length >= 5 ? 2 : 1
        continue
      }
      for (const ct of cTokens) {
        if (stemCompatible(t, ct)) {
          hits += 1.5
          break
        }
      }
    }
    return hits
  }

  const labelHits = matchCount(labelTokens)
  const descHits = matchCount(descTokens.slice(0, 12))
  // Don't invent links from description noise when the label itself doesn't match
  if (labelTokens.length > 0 && labelHits === 0) return 0
  const labelScore = labelTokens.length ? labelHits / Math.max(labelTokens.length, 1) : 0
  const descScore = descTokens.length ? descHits / Math.max(Math.min(descTokens.length, 12), 1) : 0
  return Math.max(labelScore, labelScore * 0.75 + descScore * 0.25)
}

export class EmbeddingAligner {
  private readonly embedSvc: EmbeddingService
  private readonly insertEdge: Database.Statement
  private readonly updateVec: Database.Statement

  constructor(private readonly db: Database.Database) {
    this.embedSvc = EmbeddingService.instance
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'IMPLEMENTS', 1.0, ?, ?, ?, unixepoch() * 1000)
    `)
    this.updateVec = db.prepare('UPDATE graph_nodes SET embedding_vec = ? WHERE id = ?')
  }

  async align(progress: (pct: number, detail: string) => void): Promise<AlignmentResult> {
    const cleared = this.clearTestImplements()
    if (cleared > 0) {
      progress(0, `Removed ${cleared} test-fixture IMPLEMENTS edges`)
    }

    const embeddingAvailable = await this.checkEmbeddingEndpoint()

    // When embeddings come online after a keyword-only Pass C, drop weak keyword
    // edges so features can be re-linked with cosine similarity.
    if (embeddingAvailable) {
      const upgraded = this.clearKeywordImplements()
      if (upgraded > 0) {
        progress(2, `Cleared ${upgraded} keyword links for embedding re-alignment`)
      }
    }

    let embResult: AlignmentResult = {
      mode: embeddingAvailable ? 'embedding' : 'bm25_fallback',
      aligned: 0,
      skipped: 0,
      fallback: !embeddingAvailable,
    }

    if (embeddingAvailable) {
      progress(5, 'Embedding alignment…')
      embResult = await this.alignEmbedding(progress)
    } else {
      progress(5, 'Embedding endpoint unavailable — using keyword alignment')
    }

    // Always run keyword pass for leftovers (embeddings alone often score < 0.3 here)
    progress(85, 'Keyword alignment for remaining features…')
    const kw = this.alignKeyword((pct, detail) =>
      progress(85 + Math.round(pct * 0.15), detail),
    )

    const aligned = embResult.aligned + kw.aligned
    const skipped = kw.skipped
    const mode =
      embeddingAvailable && embResult.aligned > 0
        ? 'embedding'
        : kw.aligned > 0
          ? 'bm25_fallback'
          : embResult.mode

    progress(
      100,
      `${aligned} IMPLEMENTS edges (embedding=${embResult.aligned}, keyword=${kw.aligned})`,
    )

    return {
      mode: mode as AlignmentResult['mode'],
      aligned,
      skipped,
      fallback: !embeddingAvailable || kw.aligned > embResult.aligned,
    }
  }

  async checkEmbeddingEndpoint(): Promise<boolean> {
    const apiKey = getSetting('embeddingApiKey')
    const base = getSetting('embeddingBaseUrl')
    if (!apiKey || !base) return false
    if (!this.embedSvc.isConfigured) {
      this.embedSvc.configure({
        apiKey,
        baseUrl: base,
        model: getSetting('embeddingModel') || 'text-embedding-3-small',
      })
    }
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: getSetting('embeddingModel') || 'text-embedding-3-small',
          input: ['ping'],
        }),
        signal: AbortSignal.timeout(8_000),
      })
      return r.ok
    } catch {
      return false
    }
  }

  private loadTargets(): CodeTarget[] {
    const rows = this.db
      .prepare<
        [],
        {
          id: number
          label: string
          description: string | null
          file_path: string | null
          embedding_vec: Buffer | null
        }
      >(
        `SELECT id, label, description, file_path, embedding_vec FROM graph_nodes
         WHERE kind IN ${ALIGN_KINDS}
         ORDER BY CASE kind WHEN 'CLASS' THEN 0 WHEN 'DOMAIN_SERVICE' THEN 1 ELSE 2 END
         LIMIT 2000`,
      )
      .all()
      .filter((r) => !isTestPath(r.file_path))

    return rows.map((r) => ({
      ...r,
      tokens: tokenizeLabel(`${r.label} ${r.file_path ?? ''} ${r.description ?? ''}`),
    }))
  }

  /**
   * Drop IMPLEMENTS edges that point at test fixtures so alignment can retry
   * against production code.
   */
  clearTestImplements(): number {
    const result = this.db
      .prepare(
        `DELETE FROM graph_edges
         WHERE kind = 'IMPLEMENTS'
           AND to_node_id IN (
             SELECT id FROM graph_nodes
             WHERE file_path LIKE '%/__tests__/%'
                OR file_path LIKE '%.test.%'
                OR file_path LIKE '%.spec.%'
                OR file_path LIKE '%/__mocks__/%'
           )`,
      )
      .run()
    return result.changes
  }

  /** Remove keyword-only IMPLEMENTS so embedding alignment can replace them. */
  clearKeywordImplements(): number {
    const result = this.db
      .prepare(
        `DELETE FROM graph_edges
         WHERE kind = 'IMPLEMENTS' AND source = 'bm25_fallback'`,
      )
      .run()
    return result.changes
  }

  private unalignedFeatures(): { id: number; label: string; description: string | null }[] {
    return this.db
      .prepare<[], { id: number; label: string; description: string | null }>(
        `SELECT id, label, description FROM graph_nodes
         WHERE kind IN ('FEATURE','USER_STORY')
           AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind = 'IMPLEMENTS')`,
      )
      .all()
  }

  private async alignEmbedding(
    progress: (pct: number, detail: string) => void,
  ): Promise<AlignmentResult> {
    let aligned = 0
    let skipped = 0

    const features = this.unalignedFeatures()
    const services = this.loadTargets()

    if (features.length === 0) return { mode: 'embedding', aligned: 0, skipped: 0, fallback: false }
    if (services.length === 0)
      return { mode: 'embedding', aligned: 0, skipped: features.length, fallback: false }

    // Embed code targets missing vectors (batched)
    const toEmbed = services.filter((s) => !s.embedding_vec)
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
      const slice = toEmbed.slice(i, i + EMBED_BATCH)
      const texts = slice.map((s) => `${s.label}: ${(s.description ?? s.file_path ?? '').slice(0, 200)}`)
      progress(
        Math.round((i / Math.max(toEmbed.length, 1)) * 40),
        `Embedding code nodes ${i + slice.length}/${toEmbed.length}`,
      )
      const vecs = await this.callEmbeddings(texts)
      if (!vecs) continue
      const b = this.db.transaction(() =>
        slice.forEach((s, j) => {
          if (vecs[j]) {
            const buf = EmbeddingService.serializeFloat32(vecs[j]!)
            this.updateVec.run(buf, s.id)
            s.embedding_vec = buf
          }
        }),
      )
      b()
    }

    const svcVecs = services
      .map((s) => ({
        id: s.id,
        vec: s.embedding_vec ? EmbeddingService.deserializeFloat32(s.embedding_vec) : null,
      }))
      .filter((s): s is { id: number; vec: number[] } => s.vec !== null)

    const total = features.length
    for (let i = 0; i < features.length; i += 20) {
      const batch = features.slice(i, i + 20)
      const texts = batch.map((f) => `${f.label}: ${(f.description ?? '').slice(0, 200)}`)
      const vecs = await this.callEmbeddings(texts)
      if (!vecs) {
        skipped += batch.length
        continue
      }

      const edgeBatch = this.db.transaction(() => {
        batch.forEach((f, j) => {
          const fVec = vecs[j]
          if (!fVec) {
            skipped++
            return
          }
          this.updateVec.run(EmbeddingService.serializeFloat32(fVec), f.id)
          let best = 0
          let bestId: number | null = null
          for (const svc of svcVecs) {
            const c = EmbeddingService.cosine(fVec, svc.vec)
            if (c >= COSINE_THRESHOLD && c > best) {
              best = c
              bestId = svc.id
            }
          }
          if (bestId) {
            this.insertEdge.run(
              f.id,
              bestId,
              best,
              'llm',
              JSON.stringify({ method: 'embedding_cosine', score: best }),
            )
            aligned++
          } else {
            skipped++
          }
        })
      })
      edgeBatch()
      progress(
        40 + Math.round(((i + batch.length) / total) * 45),
        `Features ${i + batch.length}/${total} · ${aligned} embedding-aligned`,
      )
    }
    return { mode: 'embedding', aligned, skipped, fallback: false }
  }

  /** Token overlap against CLASS / MODULE / DOMAIN_SERVICE (+ file path). */
  alignKeyword(progress: (pct: number, detail: string) => void): AlignmentResult {
    let aligned = 0
    let skipped = 0

    const features = this.unalignedFeatures()
    const targets = this.loadTargets()
    const total = features.length || 1

    if (features.length === 0 || targets.length === 0) {
      return { mode: 'bm25_fallback', aligned: 0, skipped: features.length, fallback: true }
    }

    const batch = this.db.transaction(() => {
      features.forEach((f, i) => {
        if (i % 20 === 0)
          progress(Math.round((i / total) * 100), `Keyword: ${i}/${features.length}`)

        const textLabel = f.label
        const textDesc = f.description
        let bestId: number | null = null
        let bestScore = 0

        for (const t of targets) {
          const score = keywordScore(textLabel, textDesc, t)
          const adjusted = score + t.label.length * 0.00001
          if (score >= 0.28 && adjusted > bestScore) {
            bestScore = adjusted
            bestId = t.id
          }
        }

        if (bestId) {
          this.insertEdge.run(
            f.id,
            bestId,
            Math.min(0.85, KEYWORD_CONFIDENCE + bestScore * 0.2),
            'bm25_fallback',
            JSON.stringify({ method: 'keyword_token', score: bestScore, query: f.label }),
          )
          aligned++
        } else {
          skipped++
        }
      })
    })
    batch()

    progress(100, `Keyword: ${aligned} IMPLEMENTS edges`)
    return { mode: 'bm25_fallback', aligned, skipped, fallback: true }
  }

  private async callEmbeddings(texts: string[]): Promise<number[][] | null> {
    const apiKey = getSetting('embeddingApiKey')
    const base = getSetting('embeddingBaseUrl')
    if (!apiKey || !base || texts.length === 0) return null
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: getSetting('embeddingModel') || 'text-embedding-3-small',
          input: texts,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!r.ok) return null
      const json = (await r.json()) as { data: { embedding: number[]; index: number }[] }
      const sorted = [...json.data].sort((a, b) => a.index - b.index)
      return sorted.map((d) => d.embedding)
    } catch {
      return null
    }
  }
}
