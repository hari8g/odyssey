// packages/main/src/domain/passD/passDOrchestrator.ts
import type Database from 'better-sqlite3'
import type { DomainPackManifest, AEPPassProgress } from '@shared/index'
import { indexContexts } from './contextIndexer'
import { indexGlossary } from './glossaryIndexer'
import { indexBusinessRules } from './businessRuleIndexer'
import { indexKpis } from './kpiIndexer'
import { indexEvents } from './eventIndexer'
import { indexRegulations } from './regulationIndexer'

export type PassDProgressCallback = (progress: AEPPassProgress) => void

export type PassDResult = {
  nodes: number
  edges: number
}

/**
 * Run Pass D for a list of domain pack manifests.
 *
 * Order is important:
 *   1. contexts  — must exist before glossary / rules attempt to link to them
 *   2. glossary  — DOMAIN_CONCEPT + GLOSSARY_TERM
 *   3. rules     — BUSINESS_RULE (may CONSTRAINED_BY regulations indexed later, re-link is fine)
 *   4. kpis      — KPI + kpi_registry upsert
 *   5. events    — DOMAIN_EVENT + EMITS/CONSUMES
 *   6. regulations — REGULATION + GOVERNED_BY on matched files
 */
export async function runPassD(
  db: Database.Database,
  packs: DomainPackManifest[],
  push?: PassDProgressCallback,
): Promise<PassDResult> {
  const countNodes = () =>
    (db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM graph_nodes').get()?.c ?? 0)
  const countEdges = () =>
    (db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM graph_edges').get()?.c ?? 0)

  const nodesBefore = countNodes()
  const edgesBefore = countEdges()

  const total = packs.length
  const stepsPerPack = 6

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]!
    const baseStep = i * stepsPerPack
    const totalSteps = total * stepsPerPack

    const pct = (step: number) => Math.round(((baseStep + step) / totalSteps) * 90) + 5

    push?.({
      pass: 'D',
      stage: `${pack.name}: contexts`,
      pct: pct(0),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    const contextMap = indexContexts(db, pack.contexts ?? [])

    push?.({
      pass: 'D',
      stage: `${pack.name}: glossary`,
      pct: pct(1),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    indexGlossary(db, pack.concepts ?? [], contextMap)

    push?.({
      pass: 'D',
      stage: `${pack.name}: rules`,
      pct: pct(2),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    indexBusinessRules(db, pack.rules ?? [], contextMap)

    push?.({
      pass: 'D',
      stage: `${pack.name}: kpis`,
      pct: pct(3),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    indexKpis(db, pack.kpis ?? [])

    push?.({
      pass: 'D',
      stage: `${pack.name}: events`,
      pct: pct(4),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    indexEvents(db, pack.events ?? [])

    push?.({
      pass: 'D',
      stage: `${pack.name}: regulations`,
      pct: pct(5),
      detail: `Pack ${i + 1}/${total}: ${pack.name}`,
    })
    indexRegulations(db, pack.regulations ?? [])
  }

  const nodesAdded = countNodes() - nodesBefore
  const edgesAdded = countEdges() - edgesBefore

  push?.({
    pass: 'D',
    stage: 'index_complete',
    pct: 95,
    detail: `Indexed ${nodesAdded} nodes, ${edgesAdded} edges across ${total} packs`,
  })

  return { nodes: nodesAdded, edges: edgesAdded }
}
