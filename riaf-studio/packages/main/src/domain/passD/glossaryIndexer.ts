// packages/main/src/domain/passD/glossaryIndexer.ts
import type Database from 'better-sqlite3'
import type { DomainConceptDef } from '@shared/index'
import { upsertNode, insertEdge } from '../graphWrite'

/**
 * For each concept:
 *   - Insert a DOMAIN_CONCEPT node
 *   - Insert a GLOSSARY_TERM node with an ABOUT → DOMAIN_CONCEPT edge
 *   - If context is set and found in contextMap, add BELONGS_TO_CONTEXT edge
 *   - Insert synonym GLOSSARY_TERM nodes each pointing ABOUT → DOMAIN_CONCEPT
 */
export function indexGlossary(
  db: Database.Database,
  concepts: DomainConceptDef[],
  contextMap: Map<string, number>,
): void {
  if (concepts.length === 0) return

  const tx = db.transaction(() => {
    for (const concept of concepts) {
      const conceptId = upsertNode(
        db,
        'DOMAIN_CONCEPT',
        concept.name,
        concept.definition,
        null,
        { sourceType: 'manual', importanceScore: 0.6 },
      )

      const termId = upsertNode(
        db,
        'GLOSSARY_TERM',
        concept.name,
        concept.definition,
        null,
        { sourceType: 'manual', importanceScore: 0.5 },
      )

      insertEdge(db, termId, conceptId, 'ABOUT', 1.0)

      if (concept.context) {
        const ctxId = contextMap.get(concept.context)
        if (ctxId !== undefined) {
          insertEdge(db, conceptId, ctxId, 'BELONGS_TO_CONTEXT', 0.9)
        }
      }

      if (concept.synonyms) {
        for (const syn of concept.synonyms) {
          const synId = upsertNode(
            db,
            'GLOSSARY_TERM',
            syn,
            `Synonym for ${concept.name}: ${concept.definition}`,
            null,
            { sourceType: 'manual', importanceScore: 0.4 },
          )
          insertEdge(db, synId, conceptId, 'ABOUT', 0.9)
        }
      }
    }
  })

  tx()
}
