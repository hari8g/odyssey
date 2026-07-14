import Database from 'better-sqlite3'
import type { CodebaseSearchResult } from '@shared/index'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_BASE_URL = 'https://api.openai.com'
/** Keep batches small — large Odyssey workspaces hang on 96×long chunks. */
const EMBED_BATCH_SIZE = 24
const EMBED_DIMENSIONS = 1536
/** OpenAI embedding models accept ~8k tokens; stay well under with chars. */
const MAX_EMBED_CHARS = 6_000
const FETCH_TIMEOUT_MS = 45_000
const RRF_K = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
}

type EmbedResponse = {
  data: Array<{ embedding: number[]; index: number }>
}

// ---------------------------------------------------------------------------
// EmbeddingService — singleton
// ---------------------------------------------------------------------------

export class EmbeddingService {
  private static _instance: EmbeddingService | null = null

  private apiKey = ''
  private baseUrl = DEFAULT_BASE_URL
  private model = DEFAULT_MODEL

  private constructor() {}

  static get instance(): EmbeddingService {
    if (!EmbeddingService._instance) {
      EmbeddingService._instance = new EmbeddingService()
    }
    return EmbeddingService._instance
  }

  configure(config: EmbeddingConfig): void {
    this.apiKey = config.apiKey.trim()
    if (config.baseUrl) this.baseUrl = config.baseUrl.replace(/\/$/, '')
    if (config.model) this.model = config.model
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0
  }

  // ---------------------------------------------------------------------------
  // Workspace indexing
  // ---------------------------------------------------------------------------

  /**
   * Fetch embeddings for all code chunks that are not yet embedded and store
   * them in chunk_embeddings. Skips gracefully when no API key is set.
   */
  async indexWorkspace(
    db: Database.Database,
    opts?: {
      signal?: AbortSignal
      onProgress?: (done: number, total: number, detail: string) => void
    },
  ): Promise<void> {
    if (!this.isConfigured) {
      opts?.onProgress?.(0, 0, 'Embeddings skipped — not configured')
      return
    }

    type ChunkRow = { id: string; chunk_text: string }
    const pending = db
      .prepare<[], ChunkRow>(`
        SELECT cc.id, cc.chunk_text
        FROM code_chunks cc
        LEFT JOIN chunk_embeddings ce ON ce.chunk_id = cc.id
        WHERE ce.chunk_id IS NULL
      `)
      .all()

    if (pending.length === 0) {
      opts?.onProgress?.(1, 1, 'All chunks already embedded')
      return
    }

    const insert = db.prepare(`
      INSERT OR REPLACE INTO chunk_embeddings (chunk_id, model, embedding, created_at)
      VALUES (?, ?, ?, ?)
    `)

    const insertBatch = db.transaction(
      (rows: Array<{ id: string; vec: number[] }>) => {
        const now = Date.now()
        for (const { id, vec } of rows) {
          insert.run(id, this.model, EmbeddingService.serializeFloat32(vec), now)
        }
      },
    )

    let consecutiveFailures = 0
    const totalBatches = Math.ceil(pending.length / EMBED_BATCH_SIZE)

    for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
      if (opts?.signal?.aborted) return

      const batchNum = Math.floor(i / EMBED_BATCH_SIZE) + 1
      const batch = pending.slice(i, i + EMBED_BATCH_SIZE)
      const texts = batch.map((c) =>
        c.chunk_text.length > MAX_EMBED_CHARS
          ? c.chunk_text.slice(0, MAX_EMBED_CHARS)
          : c.chunk_text,
      )

      opts?.onProgress?.(
        i,
        pending.length,
        `Embedding batch ${batchNum}/${totalBatches} (${i}/${pending.length} chunks)`,
      )

      let embeddings: number[][]
      try {
        embeddings = await this.fetchEmbeddings(texts, opts?.signal)
        consecutiveFailures = 0
      } catch (err) {
        consecutiveFailures++
        console.error(
          `[EmbeddingService] batch ${batchNum}/${totalBatches} failed:`,
          err instanceof Error ? err.message : err,
        )
        // Don't block indexing forever — bail after a few hard failures
        if (consecutiveFailures >= 3) {
          opts?.onProgress?.(
            i,
            pending.length,
            `Embeddings stopped after failures (${i} chunks saved). Rest will retry next index.`,
          )
          return
        }
        continue
      }

      const rows = batch
        .map((c, idx) => ({ id: c.id, vec: embeddings[idx] ?? [] }))
        .filter((r) => r.vec.length > 0)

      insertBatch(rows)
    }

    opts?.onProgress?.(pending.length, pending.length, `Embedded ${pending.length} chunks`)
  }

  // ---------------------------------------------------------------------------
  // Hybrid search (FTS5 BM25 + cosine vector, merged via RRF)
  // ---------------------------------------------------------------------------

  async hybridSearch(
    db: Database.Database,
    query: string,
    limit = 10,
  ): Promise<CodebaseSearchResult[]> {
    const ftsResults = this.ftsSearch(db, query, limit * 3)
    const vectorResults = this.isConfigured
      ? await this.vectorSearch(db, query, limit * 3)
      : []

    return mergeRRF(ftsResults, vectorResults, limit)
  }

  // ---------------------------------------------------------------------------
  // Private search helpers
  // ---------------------------------------------------------------------------

  private ftsSearch(
    db: Database.Database,
    query: string,
    limit: number,
  ): CodebaseSearchResult[] {
    const sanitized = EmbeddingService.sanitizeFts(query)
    if (!sanitized) return []

    type Row = {
      chunk_text: string
      file_path: string
      start_line: number
      end_line: number
      score: number
    }

    try {
      return db
        .prepare<[string, number], Row>(`
          SELECT chunk_text, file_path, start_line, end_line,
                 bm25(chunks_fts) AS score
          FROM chunks_fts
          WHERE chunks_fts MATCH ?
          ORDER BY score
          LIMIT ?
        `)
        .all(sanitized, limit)
        .map((r) => ({
          filePath: r.file_path,
          startLine: r.start_line,
          endLine: r.end_line,
          snippet: r.chunk_text.slice(0, 300),
          score: Math.abs(r.score), // bm25 returns negative values in SQLite
        }))
    } catch {
      return []
    }
  }

  private async vectorSearch(
    db: Database.Database,
    query: string,
    limit: number,
  ): Promise<CodebaseSearchResult[]> {
    let queryVec: number[]
    try {
      const vecs = await this.fetchEmbeddings([query])
      queryVec = vecs[0] ?? []
    } catch {
      return []
    }
    if (queryVec.length === 0) return []

    type EmbRow = { chunk_id: string; embedding: Buffer }
    const rows = db
      .prepare<[], EmbRow>('SELECT chunk_id, embedding FROM chunk_embeddings')
      .all()

    if (rows.length === 0) return []

    // Score all stored embeddings
    const scored = rows.map((r) => ({
      chunkId: r.chunk_id,
      score: EmbeddingService.cosine(
        queryVec,
        EmbeddingService.deserializeFloat32(r.embedding),
      ),
    }))

    scored.sort((a, b) => b.score - a.score)

    const topIds = scored.slice(0, limit).map((s) => s.chunkId)
    if (topIds.length === 0) return []

    type ChunkRow = { id: string; chunk_text: string; file_path: string; start_line: number; end_line: number }
    const placeholders = topIds.map(() => '?').join(',')
    const chunks = db
      .prepare<string[], ChunkRow>(
        `SELECT id, chunk_text, file_path, start_line, end_line
         FROM code_chunks WHERE id IN (${placeholders})`,
      )
      .all(...topIds)

    const scoreMap = new Map(scored.map((s) => [s.chunkId, s.score]))
    return chunks.map((c) => ({
      filePath: c.file_path,
      startLine: c.start_line,
      endLine: c.end_line,
      snippet: c.chunk_text.slice(0, 300),
      score: scoreMap.get(c.id) ?? 0,
    }))
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compat /v1/embeddings
  // ---------------------------------------------------------------------------

  private async fetchEmbeddings(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`
    const body = JSON.stringify({ input: texts, model: this.model })

    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    const merged =
      signal != null && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeout])
        : timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
      signal: merged,
    })

    if (!response.ok) {
      const errBody = await response.text().catch(() => '')
      throw new Error(
        `Embeddings API error: ${response.status} ${response.statusText}${errBody ? ` — ${errBody.slice(0, 200)}` : ''}`,
      )
    }

    const json = (await response.json()) as EmbedResponse
    // Sort by index to ensure order matches input
    const sorted = [...json.data].sort((a, b) => a.index - b.index)
    return sorted.map((d) => d.embedding)
  }

  // ---------------------------------------------------------------------------
  // Static float32 buffer helpers
  // ---------------------------------------------------------------------------

  /** Serialize a number[] as a little-endian Float32 BLOB. */
  static serializeFloat32(vec: number[]): Buffer {
    const buf = Buffer.allocUnsafe(vec.length * 4)
    for (let i = 0; i < vec.length; i++) {
      buf.writeFloatLE(vec[i] ?? 0, i * 4)
    }
    return buf
  }

  /** Deserialize a Float32 BLOB back to number[]. */
  static deserializeFloat32(buf: Buffer): number[] {
    const len = Math.floor(buf.byteLength / 4)
    const out = new Array<number>(len)
    for (let i = 0; i < len; i++) {
      out[i] = buf.readFloatLE(i * 4)
    }
    return out
  }

  /** Cosine similarity in [−1, 1]. Returns 0 for zero vectors. */
  static cosine(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length, EMBED_DIMENSIONS)
    let dot = 0
    let magA = 0
    let magB = 0
    for (let i = 0; i < len; i++) {
      const ai = a[i] ?? 0
      const bi = b[i] ?? 0
      dot += ai * bi
      magA += ai * ai
      magB += bi * bi
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    return denom === 0 ? 0 : dot / denom
  }

  /**
   * Sanitize a query string for use in SQLite FTS5 MATCH expressions.
   * Strips operators and control characters that would cause parse errors.
   */
  static sanitizeFts(query: string): string {
    return query
      .replace(/['"*():<>^{}[\]\\|!]/g, ' ')
      .replace(/\b(AND|OR|NOT)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

// ---------------------------------------------------------------------------
// RRF merge
// ---------------------------------------------------------------------------

function mergeRRF(
  ftsResults: CodebaseSearchResult[],
  vectorResults: CodebaseSearchResult[],
  limit: number,
): CodebaseSearchResult[] {
  const key = (r: CodebaseSearchResult) =>
    `${r.filePath}:${r.startLine}:${r.endLine}`

  const rrfScores = new Map<string, number>()
  const resultMap = new Map<string, CodebaseSearchResult>()

  const addRanked = (results: CodebaseSearchResult[]) => {
    results.forEach((r, idx) => {
      const k = key(r)
      rrfScores.set(k, (rrfScores.get(k) ?? 0) + 1 / (RRF_K + idx + 1))
      if (!resultMap.has(k)) resultMap.set(k, r)
    })
  }

  addRanked(ftsResults)
  addRanked(vectorResults)

  return [...rrfScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, score]) => {
      const r = resultMap.get(k)!
      return { ...r, score }
    })
}
