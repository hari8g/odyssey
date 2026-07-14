// packages/main/src/iss/passC/passCOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../../llm/llmProvider.interface'
import type { ISSPassProgress } from '@shared/index'
import { IPC } from '@shared/index'
import { GherkinParser } from './gherkinParser'
import { GitHubIssueIngester } from './githubIssueIngester'
import { DocMiner } from './docMiner'
import { CodeStructureExtractor } from './codeStructureExtractor'
import { EmbeddingAligner } from './embeddingAligner'
import { FeatureTracesMaterializer } from '../featureTracesMaterializer'
import { getSetting } from '../../settingsStore'

export class PassCOrchestrator {
  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
    private readonly win: BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  private push = (p: ISSPassProgress) => this.win.webContents.send(IPC.ISS_PASS_PROGRESS, p)

  private featureCount(): number {
    return (
      this.db
        .prepare<[], { n: number }>(
          `SELECT COUNT(*) as n FROM graph_nodes
         WHERE kind IN ('FEATURE','EPIC','USER_STORY')`,
        )
        .get()!
    ).n
  }

  async runGherkin(): Promise<number> {
    this.push({ pass: 'C1', stage: 'gherkin', pct: 0, detail: 'Scanning .feature files…' })
    const before = this.featureCount()
    const result = new GherkinParser(this.db, this.root).parse()
    const added = this.featureCount() - before
    this.push({
      pass: 'C1',
      stage: 'gherkin',
      pct: 100,
      detail:
        added > 0
          ? `${result.features} features · ${result.stories} stories · ${result.criteria} criteria`
          : 'No .feature files found',
    })
    return added
  }

  async runGitHub(): Promise<number> {
    const token = getSetting('githubToken')
    const owner = getSetting('githubRepoOwner')
    const repo = getSetting('githubRepoName')

    if (!token || !owner || !repo) {
      this.push({
        pass: 'C2',
        stage: 'github',
        pct: 100,
        detail: 'Skipped — GitHub token/owner/repo not configured in Settings',
      })
      return 0
    }

    this.push({ pass: 'C2', stage: 'github', pct: 0, detail: 'Fetching GitHub issues…' })
    const before = this.featureCount()
    try {
      const ingester = new GitHubIssueIngester(this.db, token, owner, repo)
      const result = await ingester.ingest((pct, detail) =>
        this.push({ pass: 'C2', stage: 'github', pct, detail }),
      )
      const added = this.featureCount() - before
      this.push({
        pass: 'C2',
        stage: 'github',
        pct: 100,
        detail: `${result.epics} epics · ${result.features} features · ${result.stories} stories`,
      })
      return added
    } catch (err) {
      this.push({
        pass: 'C2',
        stage: 'github',
        pct: 100,
        detail: `GitHub ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return 0
    }
  }

  async runDocMining(): Promise<number> {
    this.push({ pass: 'C3', stage: 'doc_mining', pct: 0, detail: 'Mining documentation…' })
    const before = this.featureCount()
    try {
      const count = await new DocMiner(this.db, this.root, this.getProvider()).mine((pct, detail) =>
        this.push({ pass: 'C3', stage: 'doc_mining', pct, detail }),
      )
      const added = this.featureCount() - before
      this.push({
        pass: 'C3',
        stage: 'doc_mining',
        pct: 100,
        detail:
          count > 0
            ? `${count} features extracted from docs`
            : 'No documentation found or LLM unavailable',
      })
      return added
    } catch (err) {
      this.push({
        pass: 'C3',
        stage: 'doc_mining',
        pct: 100,
        detail: `Doc mining failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return 0
    }
  }

  async runAutoDiscovery(): Promise<{ suggestions: number }> {
    this.push({
      pass: 'C3.5',
      stage: 'auto_discovery',
      pct: 0,
      detail: 'Auto-discovering features from code structure…',
    })
    try {
      const extractor = new CodeStructureExtractor(this.db, this.getProvider())
      const suggestions = await extractor.extract((pct, detail) =>
        this.push({ pass: 'C3.5', stage: 'auto_discovery', pct, detail }),
      )
      this.push({
        pass: 'C3.5',
        stage: 'auto_discovery',
        pct: 100,
        detail:
          suggestions > 0
            ? `${suggestions} feature suggestions ready for review`
            : 'No suggestions generated',
      })
      return { suggestions }
    } catch (err) {
      this.push({
        pass: 'C3.5',
        stage: 'auto_discovery',
        pct: 100,
        detail: `Auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      return { suggestions: 0 }
    }
  }

  checkFeatureGate(): boolean {
    const count = this.featureCount()
    if (count === 0) {
      this.win.webContents.send(IPC.ISS_NEEDS_FEATURES, {
        message:
          'No features could be automatically discovered. ' +
          'Please add features manually or approve the auto-discovered suggestions.',
        suggestions: this.db
          .prepare('SELECT COUNT(*) as n FROM feature_suggestions WHERE status = "pending"')
          .get() as { n: number },
      })
      return false
    }
    return true
  }

  async runAlignment(): Promise<void> {
    if (!this.checkFeatureGate()) {
      this.push({
        pass: 'C4',
        stage: 'alignment',
        pct: 0,
        detail: 'Blocked — no FEATURE nodes exist. Add features manually to proceed.',
      })
      return
    }

    this.push({ pass: 'C4', stage: 'alignment', pct: 0, detail: 'Aligning features to code…' })

    const aligner = new EmbeddingAligner(this.db)
    const result = await aligner.align((pct, detail) =>
      this.push({ pass: 'C4', stage: 'alignment', pct, detail }),
    )

    const modeLabel =
      result.mode === 'embedding'
        ? 'embeddings'
        : result.mode === 'bm25_fallback'
          ? 'keyword match'
          : result.mode
    this.push({
      pass: 'C4',
      stage: 'alignment',
      pct: 100,
      detail: `${result.aligned} IMPLEMENTS edges (${modeLabel})`,
    })

    new FeatureTracesMaterializer(this.db).materialize()
    this.win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'C' })
  }

  async runAll(): Promise<void> {
    await this.runGherkin()
    await this.runGitHub()
    await this.runDocMining()

    if (this.featureCount() === 0) {
      const { suggestions } = await this.runAutoDiscovery()
      if (suggestions > 0) {
        this.win.webContents.send(IPC.ISS_NEEDS_FEATURES, {
          message:
            `${suggestions} feature suggestions are ready. ` +
            'Approve them to proceed with alignment.',
          suggestions: { n: suggestions },
        })
        return
      }
    }

    await this.runAlignment()
  }
}
