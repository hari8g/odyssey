// packages/main/src/iss/passB/passBOrchestrator.ts
import type Database from 'better-sqlite3'
import type { ISSPassProgress } from '@shared/index'
import { CommitMiner } from './commitMiner'
import { JaccardNormalizer } from './jaccardNormalizer'
import { CoChangeMaterializer } from './coChangeMaterializer'

export class PassBOrchestrator {
  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {}

  async run(push: (p: ISSPassProgress) => void): Promise<void> {
    push({ pass: 'B', stage: 'commit_mining', pct: 0, detail: 'Mining git history…' })
    const miner = new CommitMiner(this.db, this.root)
    const { commits, pairs, traces } = await miner.mine((pct, detail) =>
      push({ pass: 'B', stage: 'commit_mining', pct, detail }),
    )
    push({
      pass: 'B',
      stage: 'commit_mining',
      pct: 100,
      detail: `${commits} commits · ${pairs} pairs · ${traces} TRACES_TO edges`,
    })

    push({ pass: 'B', stage: 'jaccard', pct: 0, detail: 'Normalizing…' })
    const above = new JaccardNormalizer(this.db).normalize()
    push({
      pass: 'B',
      stage: 'jaccard',
      pct: 100,
      detail: `${above} pairs above threshold 0.3`,
    })

    push({ pass: 'B', stage: 'materialize', pct: 0, detail: 'Writing CO_CHANGES_WITH…' })
    const written = new CoChangeMaterializer(this.db).materialize()
    push({
      pass: 'B',
      stage: 'materialize',
      pct: 100,
      detail: `${written} CO_CHANGES_WITH edges written`,
    })
  }
}
