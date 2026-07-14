// packages/main/src/aep/upstream/passE/passEOrchestrator.ts
import type Database from 'better-sqlite3'
import type { AEPPassProgress } from '@shared/index'
import type { ILLMProvider } from '../../../llm/llmProvider.interface'
import { OrgPackLoader } from './orgPackLoader'
import { CustomerSignalIngester } from './customerSignalIngester'
import { PainPointClusterer } from './painPointClusterer'

export interface PassEInput {
  orgPackPaths?: string[]
  orgPackDir?: string
  signalFilePaths?: string[]
  rawSignals?: { cohort: string; type: string; text: string; date?: string }[]
  sourceSystem?: string
}

export interface PassEResult {
  orgPacksLoaded: number
  signalsInserted: number
  signalsSkipped: number
  painPointIds: number[]
  signalNodeIds: number[]
  expressesEdges: number
}

export class PassEOrchestrator {
  constructor(
    private readonly db: Database.Database,
    private readonly llm?: ILLMProvider,
  ) {}

  async run(
    input: PassEInput,
    push: (p: AEPPassProgress) => void,
  ): Promise<PassEResult> {
    // ── E_org: ingest org packs ────────────────────────────────────────────
    push({ pass: 'E_org', stage: 'org_packs', pct: 0, detail: 'Loading org packs…' })
    const loader = new OrgPackLoader(this.db)
    let orgPacksLoaded = 0

    if (input.orgPackDir) {
      const results = loader.loadDirectory(input.orgPackDir)
      orgPacksLoaded += results.length
    }
    for (const p of input.orgPackPaths ?? []) {
      loader.load(p)
      orgPacksLoaded++
    }
    push({
      pass: 'E_org',
      stage: 'org_packs',
      pct: 100,
      detail: `${orgPacksLoaded} org pack(s) loaded`,
    })

    // ── E_signals: ingest customer signals ────────────────────────────────
    push({
      pass: 'E_signals',
      stage: 'signal_ingest',
      pct: 0,
      detail: 'Ingesting customer signals…',
    })
    const ingester = new CustomerSignalIngester(this.db)
    let totalInserted = 0
    let totalSkipped = 0
    const allSignalNodeIds: number[] = []

    for (const fp of input.signalFilePaths ?? []) {
      const r = ingester.ingestFile(fp, input.sourceSystem)
      totalInserted += r.inserted
      totalSkipped += r.skipped
      allSignalNodeIds.push(...r.signalNodeIds)
    }
    if (input.rawSignals?.length) {
      const r = ingester.ingestRaw(input.rawSignals, input.sourceSystem ?? 'api')
      totalInserted += r.inserted
      totalSkipped += r.skipped
      allSignalNodeIds.push(...r.signalNodeIds)
    }
    push({
      pass: 'E_signals',
      stage: 'signal_ingest',
      pct: 100,
      detail: `${totalInserted} inserted, ${totalSkipped} skipped`,
    })

    // ── E_cluster: cluster signals into pain points ───────────────────────
    push({
      pass: 'E_cluster',
      stage: 'clustering',
      pct: 0,
      detail: `Clustering ${allSignalNodeIds.length} signal(s)…`,
    })
    const clusterer = new PainPointClusterer(this.db, this.llm)
    const { clusters, expressesEdges } = await clusterer.cluster(allSignalNodeIds)
    push({
      pass: 'E_cluster',
      stage: 'clustering',
      pct: 100,
      detail: `${clusters.length} pain point(s), ${expressesEdges} EXPRESSES edges`,
    })

    return {
      orgPacksLoaded,
      signalsInserted: totalInserted,
      signalsSkipped: totalSkipped,
      painPointIds: clusters.map((c) => c.painPointId),
      signalNodeIds: allSignalNodeIds,
      expressesEdges,
    }
  }
}
