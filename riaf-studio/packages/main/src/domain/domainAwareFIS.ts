// packages/main/src/domain/domainAwareFIS.ts
import type Database from 'better-sqlite3'
import type { SDLCMode, FISWeights, DomainAwareFISResult } from '@shared/index'
import { FISEngine } from '../iss/fisEngine'

type DomainInfo = {
  domainRelevance: number
  isGoverned: boolean
  contexts: string[]
}

/**
 * Wraps FISEngine to add a zeta component for domain relevance.
 *
 * zeta = domainRelevance × 0.15 + (isGoverned ? 0.05 : 0)
 *
 * domainRelevance is:
 *   1.0 — if the file belongs to a BOUNDED_CONTEXT whose label appears in the
 *          query, or if any graph node for that file is itself a matched concept
 *   0.5 — if the file is governed by a REGULATION (even without context match)
 *   0.2 — default (file has no domain metadata)
 */
export class DomainAwareFIS {
  private readonly fis: FISEngine

  constructor(private readonly db: Database.Database) {
    this.fis = new FISEngine(db)
  }

  async score(
    query: string,
    sdlcMode: SDLCMode,
    maxResults = 20,
    overrides?: Partial<FISWeights>,
  ): Promise<DomainAwareFISResult[]> {
    const baseResults = await this.fis.score(query, sdlcMode, maxResults * 2, overrides)

    // Build a set of concept/context node ids whose labels match the query
    const queryLower = query.toLowerCase()
    const conceptRows = this.db
      .prepare<[], { id: number; label: string }>(
        `SELECT id, label
         FROM graph_nodes
         WHERE kind IN ('DOMAIN_CONCEPT', 'GLOSSARY_TERM', 'BOUNDED_CONTEXT')`,
      )
      .all()

    const relevantConceptIds = new Set(
      conceptRows
        .filter((c) => queryLower.includes(c.label.toLowerCase()))
        .map((c) => c.id),
    )

    const enriched: DomainAwareFISResult[] = []

    for (const r of baseResults) {
      const info = this.getDomainInfo(r.filePath, relevantConceptIds)
      const zeta = info.domainRelevance * 0.15 + (info.isGoverned ? 0.05 : 0)

      enriched.push({
        filePath: r.filePath,
        score: r.score + zeta,
        components: { ...r.components, zeta },
        sdlcPhase: r.sdlcPhase,
        nodeKind: r.nodeKind,
        importedByCount: r.importedByCount,
        domainRelevance: info.domainRelevance,
        isGoverned: info.isGoverned,
        contexts: info.contexts,
      })
    }

    return enriched.sort((a, b) => b.score - a.score).slice(0, maxResults)
  }

  private getDomainInfo(filePath: string, relevantConceptIds: Set<number>): DomainInfo {
    // All graph nodes for this file path
    const fileNodeIds = this.db
      .prepare<[string], { id: number }>(
        'SELECT id FROM graph_nodes WHERE file_path = ?',
      )
      .all(filePath)
      .map((r) => r.id)

    if (fileNodeIds.length === 0) {
      return { domainRelevance: 0.2, isGoverned: false, contexts: [] }
    }

    const placeholders = fileNodeIds.map(() => '?').join(',')

    // BOUNDED_CONTEXT nodes reachable via BELONGS_TO_CONTEXT
    const contextRows = this.db
      .prepare<number[], { contextLabel: string; contextId: number }>(
        `SELECT gn.label AS contextLabel, gn.id AS contextId
         FROM graph_edges ge
         JOIN graph_nodes gn ON gn.id = ge.to_node_id
         WHERE ge.from_node_id IN (${placeholders})
           AND ge.kind = 'BELONGS_TO_CONTEXT'
           AND gn.kind = 'BOUNDED_CONTEXT'`,
      )
      .all(...fileNodeIds)

    const contexts = [...new Set(contextRows.map((c) => c.contextLabel))]
    const contextIds = contextRows.map((c) => c.contextId)
    const governed = this.db
      .prepare<number[]>(
        `SELECT 1 FROM graph_edges
         WHERE from_node_id IN (${placeholders}) AND kind = 'GOVERNED_BY'
         LIMIT 1`,
      )
      .get(...fileNodeIds)
    const isGoverned = !!governed

    // Compute domain relevance
    const hasRelevantContext = contextIds.some((id) => relevantConceptIds.has(id))
    const hasDirectMatch = fileNodeIds.some((id) => relevantConceptIds.has(id))

    let domainRelevance = 0.2
    if (hasRelevantContext || hasDirectMatch) {
      domainRelevance = 1.0
    } else if (isGoverned) {
      domainRelevance = 0.5
    }

    return { domainRelevance, isGoverned, contexts }
  }
}
