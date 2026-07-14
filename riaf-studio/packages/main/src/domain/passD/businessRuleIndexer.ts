// packages/main/src/domain/passD/businessRuleIndexer.ts
import type Database from 'better-sqlite3'
import type { BusinessRuleDef } from '@shared/index'
import { upsertNode, insertEdge, getNodeId } from '../graphWrite'

/**
 * Index BUSINESS_RULE nodes.
 * Adds BELONGS_TO_CONTEXT, CONSTRAINED_BY (regulation), and ENFORCES edges
 * where the referenced nodes can be found.
 */
export function indexBusinessRules(
  db: Database.Database,
  rules: BusinessRuleDef[],
  contextMap: Map<string, number>,
): void {
  if (rules.length === 0) return

  const tx = db.transaction(() => {
    for (const rule of rules) {
      const nodeId = upsertNode(
        db,
        'BUSINESS_RULE',
        rule.name,
        rule.statement,
        rule.id,
        { sourceType: 'manual', importanceScore: 0.6 },
      )

      const ctxId = contextMap.get(rule.context)
      if (ctxId !== undefined) {
        insertEdge(db, nodeId, ctxId, 'BELONGS_TO_CONTEXT', 0.9)
      }

      if (rule.regulation) {
        const regId = getNodeId(db, 'REGULATION', rule.regulation)
        if (regId !== null) {
          insertEdge(db, nodeId, regId, 'CONSTRAINED_BY', 0.9)
        }
      }

      if (rule.enforcedBy) {
        for (const enforced of rule.enforcedBy) {
          const target = db
            .prepare<[string], { id: number }>(
              'SELECT id FROM graph_nodes WHERE label = ? LIMIT 1',
            )
            .get(enforced)
          if (target) {
            insertEdge(db, nodeId, target.id, 'ENFORCES', 0.8)
          }
        }
      }
    }
  })

  tx()
}
