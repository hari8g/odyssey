// packages/shared/src/indexer.types.ts

export type IndexingStage =
  | 'scan'
  | 'chunk'
  | 'symbols'
  | 'fts'
  | 'imports'
  | 'graph'
  | 'commands'
  | 'git'
  | 'embeddings'
  | 'profile'

export type IndexingStatus =
  | { stage: IndexingStage; phase: 'running'; pct: number; detail: string }
  | { stage: 'done'; totalMs: number }
  | { stage: 'error'; message: string }

export type IndexerState = {
  isRunning: boolean
  lastStatus: IndexingStatus | null
  lastCompletedAt: number | null
}
