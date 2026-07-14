// packages/main/src/iss/fisEngine.ts
import type Database from 'better-sqlite3'
import type { FISResult, SDLCMode, FISWeights, SDLCPhase } from '@shared/index'
import { EmbeddingService } from '../indexer/embeddingService'

const PHASE_WEIGHTS: Record<SDLCMode, FISWeights> = {
  requirements: { alpha: 0.3, beta: 0.4, gamma: 0.1, delta: 0.1, epsilon: 0.1 },
  design: { alpha: 0.2, beta: 0.3, gamma: 0.2, delta: 0.1, epsilon: 0.2 },
  implementation: { alpha: 0.2, beta: 0.2, gamma: 0.2, delta: 0.2, epsilon: 0.2 },
  testing: { alpha: 0.1, beta: 0.2, gamma: 0.1, delta: 0.3, epsilon: 0.3 },
  deployment: { alpha: 0.15, beta: 0.15, gamma: 0.2, delta: 0.2, epsilon: 0.3 },
  maintenance: { alpha: 0.2, beta: 0.15, gamma: 0.15, delta: 0.3, epsilon: 0.2 },
  auto: { alpha: 0.25, beta: 0.25, gamma: 0.2, delta: 0.15, epsilon: 0.15 },
}

const PHASE_RELEVANCE: Record<string, Record<string, number>> = {
  requirements: { requirements: 1.0, design: 0.5, implementation: 0.2, testing: 0.1 },
  design: { design: 1.0, requirements: 0.5, implementation: 0.4, testing: 0.2 },
  implementation: { implementation: 1.0, design: 0.6, testing: 0.4, maintenance: 0.3 },
  testing: { testing: 1.0, implementation: 0.5, maintenance: 0.3, design: 0.2 },
  deployment: { deployment: 1.0, testing: 0.4, maintenance: 0.4, implementation: 0.2 },
  maintenance: { maintenance: 1.0, testing: 0.4, implementation: 0.3, deployment: 0.3 },
}

export class FISEngine {
  constructor(private readonly db: Database.Database) {}

  async score(
    query: string,
    sdlcMode: SDLCMode,
    maxResults = 20,
    overrides?: Partial<FISWeights>,
  ): Promise<FISResult[]> {
    const W = { ...PHASE_WEIGHTS[sdlcMode], ...overrides }
    const bm25 = this.getBM25(query, maxResults * 3)
    const cosine = await this.getCosine(query, bm25)
    const pr = this.getPageRank(bm25.map((r) => r.filePath))
    const cc = this.getCoChange(bm25.slice(0, 5).map((r) => r.filePath))
    const phases = this.getPhases(bm25.map((r) => r.filePath))

    const scored: FISResult[] = bm25.map((r) => {
      const a = W.alpha * Math.min(1, Math.max(0, 1 + r.raw / 10))
      const b = W.beta * (cosine.get(r.filePath) ?? 0)
      const g = W.gamma * (pr.get(r.filePath) ?? 0)
      const d = W.delta * (cc.get(r.filePath) ?? 0)
      const e =
        W.epsilon * ((PHASE_RELEVANCE[sdlcMode] ?? {})[phases.get(r.filePath) ?? ''] ?? 0.1)
      return {
        filePath: r.filePath,
        score: a + b + g + d + e,
        components: { alpha: a, beta: b, gamma: g, delta: d, epsilon: e },
        sdlcPhase: (phases.get(r.filePath) as SDLCPhase) ?? null,
        nodeKind: r.nodeKind,
        importedByCount: r.fanIn,
      }
    })

    for (const [fp, w] of cc) {
      if (!scored.find((s) => s.filePath === fp) && w >= 0.5) {
        const pr2 = pr.get(fp) ?? 0
        const ph = phases.get(fp) ?? ''
        const e = W.epsilon * ((PHASE_RELEVANCE[sdlcMode] ?? {})[ph] ?? 0.1)
        scored.push({
          filePath: fp,
          score: W.delta * w + W.gamma * pr2 + e,
          components: { alpha: 0, beta: 0, gamma: W.gamma * pr2, delta: W.delta * w, epsilon: e },
          sdlcPhase: (ph as SDLCPhase) || null,
          nodeKind: null,
          importedByCount: 0,
        })
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, maxResults)
  }

  getBlastRadius(topFiles: string[], depth = 2): string[] {
    const visited = new Set(topFiles)
    let frontier = [...topFiles]
    for (let d = 0; d < depth; d++) {
      const ids = frontier
        .map(
          (f) =>
            this.db
              .prepare<[string], { id: number }>('SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1')
              .get(f)?.id,
        )
        .filter((id): id is number => Boolean(id))
      if (!ids.length) break
      const next: string[] = []
      for (const r of this.db
        .prepare<[], { metadata_json: string }>(
          `SELECT DISTINCT metadata_json FROM graph_edges
         WHERE kind='CO_CHANGES_WITH' AND from_node_id IN (${ids.join(',')}) AND weight>=0.4`,
        )
        .all()) {
        try {
          const meta = JSON.parse(r.metadata_json) as { file_a?: string; file_b?: string }
          for (const f of [meta.file_a, meta.file_b]) {
            if (f && !visited.has(f)) {
              visited.add(f)
              next.push(f)
            }
          }
        } catch {
          /* skip */
        }
      }
      frontier = next
      if (!frontier.length) break
    }
    return [...visited].filter((f) => !topFiles.includes(f))
  }

  private getBM25(q: string, limit: number) {
    const sanitized = EmbeddingService.sanitizeFts(q)
    if (!sanitized) return []
    try {
      return this.db
        .prepare<
          [string, number],
          { filePath: string; raw: number; nodeKind: string | null; fanIn: number }
        >(
          `SELECT c.file_path as filePath, bm25(chunks_fts) as raw,
               gn.kind as nodeKind, COALESCE(ucg.imported_by_count,0) as fanIn
        FROM chunks_fts JOIN code_chunks c ON c.rowid=chunks_fts.rowid
        LEFT JOIN graph_nodes gn ON gn.file_path=c.file_path AND gn.kind IN ('DOMAIN_SERVICE','CLASS','MODULE')
        LEFT JOIN ucg_file_nodes ucg ON ucg.file_path=c.file_path
        WHERE chunks_fts MATCH ? ORDER BY raw LIMIT ?`,
        )
        .all(sanitized, limit)
    } catch {
      return []
    }
  }

  private async getCosine(q: string, hits: { filePath: string }[]) {
    const map = new Map<string, number>()
    if (!hits.length) return map
    try {
      const results = await EmbeddingService.instance.hybridSearch(this.db, q, hits.length)
      for (const r of results) map.set(r.filePath, Math.max(0, r.score))
    } catch {
      /* embedding unavailable */
    }
    return map
  }

  private getPageRank(fps: string[]) {
    if (!fps.length) return new Map<string, number>()
    return new Map(
      this.db
        .prepare<string[], { file_path: string; importance_score: number }>(
          `SELECT file_path, MAX(importance_score) as importance_score FROM graph_nodes
         WHERE file_path IN (${fps.map(() => '?').join(',')}) AND importance_score>0
         GROUP BY file_path`,
        )
        .all(...fps)
        .map((r) => [r.file_path, r.importance_score]),
    )
  }

  private getCoChange(seeds: string[]) {
    const map = new Map<string, number>()
    if (!seeds.length) return map
    const ids = seeds
      .map(
        (f) =>
          this.db
            .prepare<[string], { id: number }>('SELECT id FROM graph_nodes WHERE file_path=? LIMIT 1')
            .get(f)?.id,
      )
      .filter((id): id is number => Boolean(id))
    if (!ids.length) return map
    for (const r of this.db
      .prepare<[], { metadata_json: string; weight: number }>(
        `SELECT metadata_json, AVG(weight) as weight FROM graph_edges
       WHERE kind='CO_CHANGES_WITH' AND from_node_id IN (${ids.join(',')})
       GROUP BY to_node_id ORDER BY weight DESC LIMIT 30`,
      )
      .all()) {
      try {
        const meta = JSON.parse(r.metadata_json) as { file_a?: string; file_b?: string }
        const f = meta.file_b ?? meta.file_a
        if (f) map.set(f, r.weight)
      } catch {
        /* skip */
      }
    }
    return map
  }

  private getPhases(fps: string[]) {
    if (!fps.length) return new Map<string, string>()
    return new Map(
      this.db
        .prepare<string[], { file_path: string; sdlc_phase: string }>(
          `SELECT file_path, sdlc_phase FROM graph_nodes
         WHERE file_path IN (${fps.map(() => '?').join(',')}) AND sdlc_phase IS NOT NULL
         GROUP BY file_path`,
        )
        .all(...fps)
        .map((r) => [r.file_path, r.sdlc_phase]),
    )
  }
}
