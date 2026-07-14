// packages/main/src/domain/domainEnrichment.ts
import type Database from 'better-sqlite3'
import { EmbeddingService } from '../indexer/embeddingService'
import { getSetting } from '../settingsStore'
import { insertEdge } from './graphWrite'

type FeatureRow = {
  id: number
  label: string
  description: string | null
  embedding_vec: Buffer | null
}

type ConceptRow = {
  id: number
  label: string
  embedding_vec: Buffer | null
}

/**
 * Keyword-match FEATURE / USER_STORY descriptions against DOMAIN_CONCEPT /
 * GLOSSARY_TERM labels and add ABOUT edges.
 *
 * If embeddingsEnabled is true and the EmbeddingService is configured, also
 * runs a cosine-similarity pass over stored embedding vectors (cosine ≥ 0.75).
 *
 * Returns the number of new ABOUT edges added.
 */
export async function runDomainEnrichment(db: Database.Database): Promise<number> {
  const featureNodes = db
    .prepare<[], FeatureRow>(
      `SELECT id, label, description, embedding_vec
       FROM graph_nodes
       WHERE kind IN ('FEATURE', 'USER_STORY') AND description IS NOT NULL`,
    )
    .all()

  const conceptNodes = db
    .prepare<[], ConceptRow>(
      `SELECT id, label, embedding_vec
       FROM graph_nodes
       WHERE kind IN ('DOMAIN_CONCEPT', 'GLOSSARY_TERM')`,
    )
    .all()

  if (featureNodes.length === 0 || conceptNodes.length === 0) return 0

  const embeddingsEnabled =
    !!getSetting('embeddingsEnabled') &&
    !!(getSetting('embeddingApiKey') as string | undefined)?.length &&
    EmbeddingService.instance.isConfigured

  // Pre-compute tokenised concept labels for fast keyword pass
  const conceptMeta = conceptNodes.map((c) => ({
    id: c.id,
    lower: c.label.toLowerCase(),
    tokens: c.label.toLowerCase().split(/\W+/).filter(Boolean),
    embVec: c.embedding_vec,
  }))

  let edgesAdded = 0

  for (const feature of featureNodes) {
    const haystack = `${feature.label} ${feature.description ?? ''}`.toLowerCase()

    // ── Keyword pass ──────────────────────────────────────────────────────────
    for (const concept of conceptMeta) {
      const matched =
        concept.tokens.length > 1
          ? concept.tokens.every((t) => haystack.includes(t))
          : haystack.includes(concept.lower)

      if (matched) {
        insertEdge(db, feature.id, concept.id, 'ABOUT', 0.7)
        edgesAdded++
      }
    }

    // ── Embedding pass (optional) ─────────────────────────────────────────────
    if (embeddingsEnabled && feature.embedding_vec) {
      const queryVec = EmbeddingService.deserializeFloat32(feature.embedding_vec)

      for (const concept of conceptMeta) {
        if (!concept.embVec) continue
        const conceptVec = EmbeddingService.deserializeFloat32(concept.embVec)
        const sim = EmbeddingService.cosine(queryVec, conceptVec)

        if (sim >= 0.75) {
          insertEdge(db, feature.id, concept.id, 'ABOUT', sim)
          edgesAdded++
        }
      }
    }
  }

  return edgesAdded
}
