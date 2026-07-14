# ISS Graph — Complete Implementation Plan (with Manual Feature Injection)
## Part 2 of 2: Pass C Fallback Chain, Manual Ingestion, FIS, Router, Tools, UI, Build Order

---

## Table of Contents — Part 2

11. [Pass C — The Complete Four-Level Fallback Chain](#11-pass-c--the-complete-four-level-fallback-chain)
12. [ManualFeatureIngester](#12-manualfeatureingester)
13. [FeatureImportParser — Multi-Format Bulk Import](#13-featureimportparser--multi-format-bulk-import)
14. [CodeStructureExtractor — C3.5 Auto-Discovery](#14-codestructureextractor--c35-auto-discovery)
15. [EmbeddingAligner — C4 Dual-Mode (Embedding + BM25 Fallback)](#15-embeddingaligner--c4-dual-mode)
16. [Feature Impact Scoring (FIS) Engine](#16-feature-impact-scoring-fis-engine)
17. [SDLC Phase Router](#17-sdlc-phase-router)
18. [The Six PO-Facing Agent Tools](#18-the-six-po-facing-agent-tools)
19. [Approval Gate Hook](#19-approval-gate-hook)
20. [ISS IPC Handler Registration](#20-iss-ipc-handler-registration)
21. [Renderer — Stores & UI Panels](#21-renderer--stores--ui-panels)
22. [RIAF Agent Integration](#22-riaf-agent-integration)
23. [Build Order & Milestones](#23-build-order--milestones)
24. [Complete File Manifest](#24-complete-file-manifest)

---

## 11. Pass C — The Complete Four-Level Fallback Chain

### 11.0 `passC/passCOrchestrator.ts` — The Gate Keeper

This is the most important change from the previous plan. The orchestrator now owns
the fallback chain logic explicitly. C4 is blocked until at least one FEATURE node
exists from any upstream level. If all automatic levels produce nothing, the
orchestrator pushes a `ISS_NEEDS_FEATURES` event to the UI — a clear, actionable prompt.

```typescript
// packages/main/src/iss/passC/passCOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../../llm/llmProvider.interface'
import type { ISSPassProgress } from '@shared/index'
import { IPC } from '@shared/index'
import { GherkinParser }            from './gherkinParser'
import { GitHubIssueIngester }      from './githubIssueIngester'
import { DocMiner }                 from './docMiner'
import { CodeStructureExtractor }   from './codeStructureExtractor'
import { ManualFeatureIngester }    from './manualFeatureIngester'
import { EmbeddingAligner }         from './embeddingAligner'
import { FeatureTracesMaterializer } from '../featureTracesMaterializer'
import { getSetting }               from '../../settingsStore'

// Sent to renderer when the system cannot auto-populate intent nodes
// and needs the user to take action (manual entry or approve suggestions)
const ISS_NEEDS_FEATURES = 'iss:needsFeatures'

export class PassCOrchestrator {
  constructor(
    private readonly db:          Database.Database,
    private readonly root:        string,
    private readonly win:         BrowserWindow,
    private readonly getProvider: () => ILLMProvider,
  ) {}

  private push = (p: ISSPassProgress) =>
    this.win.webContents.send(IPC.ISS_PASS_PROGRESS, p)

  /** Count FEATURE/EPIC/USER_STORY nodes currently in the graph */
  private featureCount(): number {
    return (this.db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) as n FROM graph_nodes
         WHERE kind IN ('FEATURE','EPIC','USER_STORY')`
      )
      .get()!).n
  }

  // ── Level 1: C1 — Gherkin ──────────────────────────────────────────────────
  async runGherkin(): Promise<number> {
    this.push({ pass: 'C1', stage: 'gherkin', pct: 0, detail: 'Scanning .feature files…' })
    const before = this.featureCount()
    const result = new GherkinParser(this.db, this.root).parse()
    const added  = this.featureCount() - before
    this.push({ pass: 'C1', stage: 'gherkin', pct: 100,
      detail: added > 0 ?
        `${result.features} features · ${result.stories} stories · ${result.criteria} criteria` :
        'No .feature files found'
    })
    return added
  }

  // ── Level 1: C2 — GitHub Issues ───────────────────────────────────────────
  async runGitHub(): Promise<number> {
    const token = getSetting('githubToken')
    const owner = getSetting('githubRepoOwner')
    const repo  = getSetting('githubRepoName')

    if (!token || !owner || !repo) {
      this.push({ pass: 'C2', stage: 'github', pct: 100,
        detail: 'Skipped — GitHub token/owner/repo not configured in Settings' })
      return 0
    }

    this.push({ pass: 'C2', stage: 'github', pct: 0, detail: 'Fetching GitHub issues…' })
    const before = this.featureCount()
    try {
      const ingester = new GitHubIssueIngester(this.db, token, owner, repo)
      const result   = await ingester.ingest(
        (pct, detail) => this.push({ pass: 'C2', stage: 'github', pct, detail })
      )
      const added = this.featureCount() - before
      this.push({ pass: 'C2', stage: 'github', pct: 100,
        detail: `${result.epics} epics · ${result.features} features · ${result.stories} stories` })
      return added
    } catch (err) {
      this.push({ pass: 'C2', stage: 'github', pct: 100,
        detail: `GitHub ingestion failed: ${err instanceof Error ? err.message : String(err)}` })
      return 0
    }
  }

  // ── Level 2: C3 — Doc Mining ───────────────────────────────────────────────
  async runDocMining(): Promise<number> {
    this.push({ pass: 'C3', stage: 'doc_mining', pct: 0, detail: 'Mining documentation…' })
    const before = this.featureCount()
    try {
      const count = await new DocMiner(this.db, this.root, this.getProvider())
        .mine((pct, detail) => this.push({ pass: 'C3', stage: 'doc_mining', pct, detail }))
      const added = this.featureCount() - before
      this.push({ pass: 'C3', stage: 'doc_mining', pct: 100,
        detail: count > 0 ? `${count} features extracted from docs` :
                'No documentation found or LLM unavailable' })
      return added
    } catch (err) {
      this.push({ pass: 'C3', stage: 'doc_mining', pct: 100,
        detail: `Doc mining failed: ${err instanceof Error ? err.message : String(err)}` })
      return 0
    }
  }

  // ── Level 3: C3.5 — Code Structure Auto-Discovery ─────────────────────────
  async runAutoDiscovery(): Promise<{ suggestions: number }> {
    this.push({ pass: 'C3.5', stage: 'auto_discovery', pct: 0,
      detail: 'Auto-discovering features from code structure…' })
    try {
      const extractor   = new CodeStructureExtractor(this.db, this.getProvider())
      const suggestions = await extractor.extract(
        (pct, detail) => this.push({ pass: 'C3.5', stage: 'auto_discovery', pct, detail })
      )
      this.push({ pass: 'C3.5', stage: 'auto_discovery', pct: 100,
        detail: suggestions > 0 ?
          `${suggestions} feature suggestions ready for review` :
          'No suggestions generated' })
      return { suggestions }
    } catch (err) {
      this.push({ pass: 'C3.5', stage: 'auto_discovery', pct: 100,
        detail: `Auto-discovery failed: ${err instanceof Error ? err.message : String(err)}` })
      return { suggestions: 0 }
    }
  }

  // ── Level 4: Manual Entry Gate ─────────────────────────────────────────────
  // Called after all automatic levels have been attempted.
  // If no features exist, signals the renderer to show the manual entry prompt.
  checkFeatureGate(): boolean {
    const count = this.featureCount()
    if (count === 0) {
      // Push to renderer: all automatic methods failed, user action required
      this.win.webContents.send(ISS_NEEDS_FEATURES, {
        message: 'No features could be automatically discovered. ' +
                 'Please add features manually or approve the auto-discovered suggestions.',
        suggestions: this.db
          .prepare('SELECT COUNT(*) as n FROM feature_suggestions WHERE status = "pending"')
          .get() as { n: number },
      })
      return false  // C4 must not run yet
    }
    return true
  }

  // ── C4: Embedding Alignment ────────────────────────────────────────────────
  async runAlignment(): Promise<void> {
    // Gate: abort if no features exist
    if (!this.checkFeatureGate()) {
      this.push({ pass: 'C4', stage: 'alignment', pct: 0,
        detail: 'Blocked — no FEATURE nodes exist. Add features manually to proceed.' })
      return
    }

    this.push({ pass: 'C4', stage: 'alignment', pct: 0,
      detail: 'Aligning features to code…' })

    const aligner = new EmbeddingAligner(this.db, this.getProvider())
    const result  = await aligner.align(
      (pct, detail) => this.push({ pass: 'C4', stage: 'alignment', pct, detail })
    )

    this.push({ pass: 'C4', stage: 'alignment', pct: 100,
      detail: `${result.aligned} IMPLEMENTS edges (mode: ${result.mode})` +
              (result.fallback ? ' ⚠ BM25 fallback used' : '') })

    // Re-materialize traces with new intent nodes
    new FeatureTracesMaterializer(this.db).materialize()
    this.win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'C' })
  }

  // ── Full Pass C (runs all levels in order) ─────────────────────────────────
  async runAll(): Promise<void> {
    // Level 1
    await this.runGherkin()
    await this.runGitHub()

    // Level 2
    await this.runDocMining()

    // Level 3 — auto-discovery if still empty
    if (this.featureCount() === 0) {
      const { suggestions } = await this.runAutoDiscovery()
      if (suggestions > 0) {
        // Pause here — notify UI, wait for user approval
        // C4 will be triggered by the renderer after user approves suggestions
        this.win.webContents.send(ISS_NEEDS_FEATURES, {
          message: `${suggestions} feature suggestions are ready. ` +
                   'Approve them to proceed with alignment.',
          suggestions: { n: suggestions },
        })
        return  // C4 not run yet; user must approve suggestions
      }
    }

    // Level 4 gate + C4
    await this.runAlignment()
  }
}
```

### 11.1 `passC/gherkinParser.ts`

```typescript
// packages/main/src/iss/passC/gherkinParser.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

const DESCRIBE_RE = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g
const IT_RE       = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g

export class GherkinParser {
  private readonly insert: Database.Statement
  private readonly edge:   Database.Statement
  private readonly get:    Database.Statement

  constructor(
    private readonly db:   Database.Database,
    private readonly root: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref, sdlc_phase,
         sdlc_confidence, file_path, importance_score, created_at)
      VALUES (?, ?, ?, 'gherkin', ?, 'requirements', 0.99, ?, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.edge  = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'gherkin', unixepoch() * 1000)
    `)
    this.get   = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1'
    )
  }

  parse(): { features: number; stories: number; criteria: number } {
    let features = 0, stories = 0, criteria = 0
    const files = this.db.prepare<[], { file_path: string }>(
      `SELECT file_path FROM file_metadata WHERE file_path LIKE '%.feature'`
    ).all()

    const batch = this.db.transaction(() => {
      for (const { file_path } of files) {
        const abs = path.join(this.root, file_path)
        if (!fs.existsSync(abs)) continue
        const lines = fs.readFileSync(abs, 'utf8').split('\n')
        let currentFeatureId: number | null = null
        let currentStoryId:   number | null = null
        let afterThen = false

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.trim()
          if (line.startsWith('Feature:')) {
            const label = line.slice(8).trim()
            this.insert.run('FEATURE', label, `Gherkin feature: ${label}`,
              `gherkin:${file_path}`, file_path)
            currentFeatureId = this.get.get('FEATURE', label)?.id ?? null
            features++
          } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
            const label = line.replace(/Scenario(?: Outline)?:/, '').trim()
            this.insert.run('USER_STORY', label, `Gherkin scenario: ${label}`,
              `gherkin:${file_path}:${i + 1}`, file_path)
            currentStoryId = this.get.get('USER_STORY', label)?.id ?? null
            if (currentFeatureId && currentStoryId)
              this.edge.run(currentFeatureId, currentStoryId, 'SPECIFIES')
            afterThen = false; stories++
          } else if (line.startsWith('Then ')) {
            afterThen = true
            const label = line.slice(5).trim()
            this.insert.run('ACCEPTANCE_CRITERION', label, `Then: ${label}`,
              `gherkin:${file_path}:${i + 1}`, file_path)
            const ac = this.get.get('ACCEPTANCE_CRITERION', label)
            if (ac && currentStoryId) this.edge.run(currentStoryId, ac.id, 'SPECIFIES')
            criteria++
          } else if (afterThen && line.startsWith('And ')) {
            const label = line.slice(4).trim()
            this.insert.run('ACCEPTANCE_CRITERION', label, `And (Then): ${label}`,
              `gherkin:${file_path}:${i + 1}`, file_path)
            const ac = this.get.get('ACCEPTANCE_CRITERION', label)
            if (ac && currentStoryId) this.edge.run(currentStoryId, ac.id, 'SPECIFIES')
            criteria++
          }
        }
      }
    })
    batch()
    return { features, stories, criteria }
  }
}
```

### 11.2 `passC/githubIssueIngester.ts`

```typescript
// packages/main/src/iss/passC/githubIssueIngester.ts
import type Database from 'better-sqlite3'

const EPIC_LABELS    = new Set(['epic','initiative','theme'])
const FEATURE_LABELS = new Set(['feature','enhancement','feat'])
const STORY_LABELS   = new Set(['user-story','story','task'])

export class GitHubIssueIngester {
  private readonly insert: Database.Statement
  private readonly edge:   Database.Statement
  private readonly getRef: Database.Statement

  constructor(
    private readonly db:    Database.Database,
    private readonly token: string,
    private readonly owner: string,
    private readonly repo:  string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, 'issue', ?, 'requirements', 0.95, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
    this.edge   = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, 0.90, 'issue', ?, unixepoch() * 1000)
    `)
    this.getRef = db.prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE source_ref = ? LIMIT 1'
    )
  }

  async ingest(
    progress: (pct: number, detail: string) => void,
  ): Promise<{ epics: number; features: number; stories: number }> {
    let epics = 0, features = 0, stories = 0
    const all: { number: number; title: string; body: string | null; labels: { name: string }[] }[] = []
    let page = 1

    while (true) {
      const resp = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.v3+json' },
          signal: AbortSignal.timeout(30_000) }
      )
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`)
      const batch = await resp.json() as typeof all
      if (batch.length === 0) break
      all.push(...batch)
      progress(Math.min(90, Math.round((all.length / 300) * 90)), `Fetched ${all.length} issues…`)
      page++
      if (batch.length < 100) break
    }

    const batchInsert = this.db.transaction(() => {
      for (const issue of all) {
        const kind = this.classify(issue.labels)
        const ref  = `gh:${this.owner}/${this.repo}#${issue.number}`
        this.insert.run(kind, issue.title, (issue.body ?? '').slice(0, 1000), ref)
        if (kind === 'EPIC')       epics++
        else if (kind === 'FEATURE') features++
        else                         stories++
      }
      for (const issue of all) {
        const ref   = `gh:${this.owner}/${this.repo}#${issue.number}`
        const child = this.getRef.get(ref)
        if (!child) continue
        for (const parentRef of this.parentRefs(issue.body ?? '')) {
          const parent = this.getRef.get(parentRef)
          if (parent) this.edge.run(child.id, parent.id, 'PRECEDED_BY',
            JSON.stringify({ child: ref, parent: parentRef }))
        }
      }
    })
    batchInsert()
    return { epics, features, stories }
  }

  private classify(labels: { name: string }[]): 'EPIC'|'FEATURE'|'USER_STORY' {
    const set = new Set(labels.map(l => l.name.toLowerCase()))
    if ([...set].some(l => EPIC_LABELS.has(l)))    return 'EPIC'
    if ([...set].some(l => FEATURE_LABELS.has(l))) return 'FEATURE'
    return 'USER_STORY'
  }

  private parentRefs(body: string): string[] {
    const refs: string[] = []
    for (const p of [/part of #(\d+)/gi, /parent #(\d+)/gi, /epic #(\d+)/gi]) {
      p.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = p.exec(body)) !== null)
        refs.push(`gh:${this.owner}/${this.repo}#${m[1]}`)
    }
    return refs
  }
}
```

### 11.3 `passC/docMiner.ts`

```typescript
// packages/main/src/iss/passC/docMiner.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../llm/llmProvider.interface'

const DOC_FILES = [
  'README.md','ARCHITECTURE.md','CONTRIBUTING.md',
  'docs/README.md','docs/architecture.md','docs/features.md',
]

export class DocMiner {
  private readonly insert: Database.Statement

  constructor(
    private readonly db:       Database.Database,
    private readonly root:     string,
    private readonly provider: ILLMProvider,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase, sdlc_confidence,
         importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'llm', 'requirements', 0.60, 0.0, unixepoch() * 1000)
      ON CONFLICT DO NOTHING
    `)
  }

  async mine(progress: (pct: number, detail: string) => void): Promise<number> {
    const docs  = DOC_FILES.map(f => path.join(this.root, f)).filter(fs.existsSync)
    let total   = 0

    for (let i = 0; i < docs.length; i++) {
      progress(Math.round((i / docs.length) * 100), `Mining ${path.basename(docs[i]!)}…`)
      const content = fs.readFileSync(docs[i]!, 'utf8').slice(0, 8_000)
      try {
        const resp = await this.provider.complete({
          model:    'claude-haiku-4-5',
          system:   'Extract feature names from documentation. Return only JSON array, no prose.',
          messages: [{ role: 'user', content:
            `Extract all software features. Return ONLY:\n` +
            `[{"name":"Short feature name","description":"One sentence"}]\n\n${content}`
          }],
          max_tokens: 1500,
        })
        const features = JSON.parse(resp.replace(/```json|```/g, '').trim()) as
          { name: string; description: string }[]
        const batch = this.db.transaction(() => {
          for (const f of features) {
            if (!f.name || f.name.length < 3) continue
            this.insert.run(f.name.slice(0, 200), (f.description ?? '').slice(0, 500))
            total++
          }
        })
        batch()
      } catch { /* skip this doc on any error */ }
    }
    return total
  }
}
```

---

## 12. ManualFeatureIngester

The centrepiece of the new architecture. Every create/update/delete is logged to
`manual_feature_audit`. After any write, the orchestrator's alignment is re-triggered
so IMPLEMENTS edges are always up to date.

```typescript
// packages/main/src/iss/passC/manualFeatureIngester.ts
import type Database from 'better-sqlite3'
import type { FeatureCreateInput, FeatureUpdateInput, SDLCPhase } from '@shared/index'

export class ManualFeatureIngester {
  private readonly insertNode:  Database.Statement
  private readonly updateNode:  Database.Statement
  private readonly insertAudit: Database.Statement
  private readonly getNode:     Database.Statement

  constructor(private readonly db: Database.Database) {
    this.insertNode = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'manual', ?,
              ?, 1.0, 0.0, unixepoch() * 1000)
    `)
    this.updateNode = db.prepare(`
      UPDATE graph_nodes
      SET label = COALESCE(?, label),
          description = COALESCE(?, description),
          sdlc_phase  = COALESCE(?, sdlc_phase),
          source_ref  = COALESCE(?, source_ref)
      WHERE id = ? AND source_type = 'manual'
    `)
    this.insertAudit = db.prepare(`
      INSERT INTO manual_feature_audit(node_id, action, label, meta_json)
      VALUES (?, ?, ?, ?)
    `)
    this.getNode = db.prepare<[number], {
      id: number; label: string; description: string | null;
      sdlc_phase: string; source_ref: string | null; source_type: string
    }>('SELECT id, label, description, sdlc_phase, source_ref, source_type FROM graph_nodes WHERE id = ?')
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  create(input: FeatureCreateInput): { id: number; label: string } {
    this.validate(input.label, input.description)

    const result = this.insertNode.run(
      input.label.trim(),
      input.description.trim(),
      input.sourceRef ?? null,
      input.sdlcPhase ?? 'requirements',
    )
    const id = Number(result.lastInsertRowid)
    this.insertAudit.run(id, 'create', input.label,
      JSON.stringify({ description: input.description, sdlcPhase: input.sdlcPhase }))
    return { id, label: input.label }
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  update(input: FeatureUpdateInput): boolean {
    const existing = this.getNode.get(input.id)
    if (!existing) throw new Error(`Feature node ${input.id} not found`)
    if (existing.source_type !== 'manual') {
      throw new Error(
        `Cannot update node ${input.id}: it was created by '${existing.source_type}', not manually. ` +
        `Only manually created features can be edited here.`
      )
    }
    if (input.label) this.validate(input.label, input.description ?? existing.description ?? '')
    this.updateNode.run(
      input.label?.trim() ?? null,
      input.description?.trim() ?? null,
      input.sdlcPhase ?? null,
      input.sourceRef ?? null,
      input.id,
    )
    this.insertAudit.run(input.id, 'update', existing.label,
      JSON.stringify({ before: existing, after: input }))
    return true
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  delete(id: number): boolean {
    const node = this.getNode.get(id)
    if (!node) throw new Error(`Feature node ${id} not found`)
    // Log before deleting (FK cascade will clear node from graph_nodes)
    this.insertAudit.run(null, 'delete', node.label,
      JSON.stringify({ deletedId: id, label: node.label }))
    // ON DELETE CASCADE will propagate to graph_edges and feature_traces
    this.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(id)
    return true
  }

  // ── Bulk import (called by FeatureImportParser) ────────────────────────────
  bulkCreate(
    items: FeatureCreateInput[],
    sourceName: string,
  ): { created: number; duplicates: number; errors: string[] } {
    let created = 0, duplicates = 0
    const errors: string[] = []

    const batch = this.db.transaction(() => {
      for (const item of items) {
        try {
          this.validate(item.label, item.description)

          // Check for duplicates (same label, case-insensitive)
          const existing = this.db
            .prepare<[string], { id: number }>(
              `SELECT id FROM graph_nodes WHERE LOWER(label) = LOWER(?) AND kind = 'FEATURE'`
            )
            .get(item.label.trim())

          if (existing) { duplicates++; continue }

          const result = this.insertNode.run(
            item.label.trim(), item.description.trim(),
            item.sourceRef ?? null, item.sdlcPhase ?? 'requirements'
          )
          const id = Number(result.lastInsertRowid)
          this.insertAudit.run(id, 'bulk_import', item.label,
            JSON.stringify({ source: sourceName }))
          created++
        } catch (err) {
          errors.push(`"${item.label}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
    batch()
    return { created, duplicates, errors }
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  private validate(label: string, description: string): void {
    if (!label || label.trim().length < 3) {
      throw new Error('Feature label must be at least 3 characters')
    }
    if (label.trim().length > 200) {
      throw new Error('Feature label must be 200 characters or fewer')
    }
    if (!description || description.trim().length < 10) {
      throw new Error(
        'Feature description must be at least 10 characters. ' +
        'A meaningful description is needed for C4 alignment to work correctly.'
      )
    }
  }
}
```

---

## 13. FeatureImportParser — Multi-Format Bulk Import

Parses text, CSV, JSON, and YAML into `FeatureCreateInput[]` without any
native binary dependencies. YAML is handled by a tiny regex-based parser
sufficient for the common feature-list format — no `js-yaml` runtime needed.

```typescript
// packages/main/src/iss/passC/featureImportParser.ts
import type { FeatureCreateInput, ImportFormat, ImportPreviewResult, SDLCPhase } from '@shared/index'

const VALID_PHASES = new Set([
  'requirements','design','implementation','testing','deployment','maintenance'
])

export class FeatureImportParser {

  // ── Detect format ──────────────────────────────────────────────────────────
  detectFormat(content: string, hint?: string): ImportFormat {
    if (hint === 'csv')  return 'csv'
    if (hint === 'json') return 'json'
    if (hint === 'yaml' || hint === 'yml') return 'yaml'
    const trimmed = content.trim()
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json'
    if (trimmed.includes('label:') || trimmed.includes('- name:')) return 'yaml'
    if (trimmed.includes(',') && trimmed.split('\n')[0]?.includes(',')) return 'csv'
    return 'text'
  }

  // ── Parse: dispatch by format ──────────────────────────────────────────────
  parse(content: string, format?: ImportFormat): FeatureCreateInput[] {
    const fmt = format ?? this.detectFormat(content)
    switch (fmt) {
      case 'text': return this.parseText(content)
      case 'csv':  return this.parseCsv(content)
      case 'json': return this.parseJson(content)
      case 'yaml': return this.parseYaml(content)
    }
  }

  // ── Preview (dry run) ──────────────────────────────────────────────────────
  preview(content: string, format?: ImportFormat, existingLabels?: Set<string>): ImportPreviewResult {
    const fmt = format ?? this.detectFormat(content)
    let items: FeatureCreateInput[] = []
    let parseError: string | null = null

    try {
      items = this.parse(content, fmt)
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err)
    }

    const known = existingLabels ?? new Set<string>()
    const previews = items.map(item => {
      const errors: string[] = []
      if (!item.label || item.label.length < 3)
        errors.push('Label must be at least 3 characters')
      if (!item.description || item.description.length < 10)
        errors.push('Description must be at least 10 characters (needed for C4 alignment)')
      const isDuplicate = known.has(item.label.toLowerCase())
      return {
        label:       item.label,
        description: item.description,
        sdlcPhase:   item.sdlcPhase ?? 'requirements' as SDLCPhase,
        valid:       errors.length === 0 && !isDuplicate,
        error:       errors.length > 0 ? errors.join('; ') :
                     isDuplicate ? 'Duplicate: a feature with this name already exists' : undefined,
      }
    })

    if (parseError) {
      return { format: fmt, total: 0, valid: 0, invalid: 0, duplicates: 0,
               items: [{ label:'', description: parseError, sdlcPhase:'requirements', valid: false, error: parseError }] }
    }

    return {
      format:     fmt,
      total:      previews.length,
      valid:      previews.filter(p => p.valid).length,
      invalid:    previews.filter(p => !p.valid && !p.error?.startsWith('Duplicate')).length,
      duplicates: previews.filter(p => p.error?.startsWith('Duplicate')).length,
      items:      previews,
    }
  }

  // ── Format parsers ─────────────────────────────────────────────────────────

  /** Plain text: one feature per line.
   * Format: "Feature Name — Description" or just "Feature Name"
   * Lines starting with # are comments and ignored.
   */
  private parseText(content: string): FeatureCreateInput[] {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(line => {
        // Split on em-dash, en-dash, or double-hyphen
        const sepIdx = line.search(/\s*[—–]|--|:\s/)
        if (sepIdx > 0) {
          const label = line.slice(0, sepIdx).trim()
          const description = line.slice(sepIdx)
            .replace(/^[—–:–\-]+\s*/, '').trim()
          return { label, description, sdlcPhase: 'requirements' as SDLCPhase }
        }
        // No separator: whole line is the label; description defaults to label
        return { label: line, description: line, sdlcPhase: 'requirements' as SDLCPhase }
      })
  }

  /** CSV: header row required.
   * Columns: name/label, description/desc, phase (optional), source_ref (optional)
   * Comma or semicolon delimited. Quoted fields supported.
   */
  private parseCsv(content: string): FeatureCreateInput[] {
    const lines = content.trim().split('\n')
    if (lines.length < 2) return []

    const headers = this.splitCsvRow(lines[0]!).map(h => h.toLowerCase().trim())
    const nameIdx  = headers.findIndex(h => ['name','label','feature','title'].includes(h))
    const descIdx  = headers.findIndex(h => ['description','desc','details','summary'].includes(h))
    const phaseIdx = headers.findIndex(h => ['phase','sdlc_phase','stage'].includes(h))
    const refIdx   = headers.findIndex(h => ['source_ref','ref','id','ticket'].includes(h))

    if (nameIdx === -1) throw new Error(
      'CSV must have a column named "name", "label", "feature", or "title"'
    )
    if (descIdx === -1) throw new Error(
      'CSV must have a column named "description", "desc", "details", or "summary". ' +
      'A description is required for C4 alignment.'
    )

    return lines.slice(1)
      .map(line => this.splitCsvRow(line))
      .filter(cols => cols.length > nameIdx && cols[nameIdx]?.trim())
      .map(cols => {
        const rawPhase = phaseIdx >= 0 ? cols[phaseIdx]?.toLowerCase().trim() : undefined
        const phase = (rawPhase && VALID_PHASES.has(rawPhase) ?
          rawPhase : 'requirements') as SDLCPhase
        return {
          label:       (cols[nameIdx] ?? '').trim(),
          description: (cols[descIdx] ?? '').trim(),
          sdlcPhase:   phase,
          sourceRef:   refIdx >= 0 ? cols[refIdx]?.trim() : undefined,
        }
      })
  }

  /** JSON: array of objects.
   * Supported shapes:
   *   [{ "name": "...", "description": "...", "phase": "..." }]
   *   [{ "label": "...", "description": "..." }]
   *   [{ "feature": "...", "details": "..." }]
   */
  private parseJson(content: string): FeatureCreateInput[] {
    let parsed: unknown
    try { parsed = JSON.parse(content.replace(/```json|```/g, '').trim()) }
    catch (e) { throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`) }

    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.map((item, idx) => {
      if (typeof item !== 'object' || !item) throw new Error(`Item ${idx}: expected object`)
      const obj = item as Record<string, unknown>
      const label = (obj['name'] ?? obj['label'] ?? obj['feature'] ?? obj['title'] ?? '') as string
      const description = (
        obj['description'] ?? obj['desc'] ?? obj['details'] ?? obj['summary'] ?? ''
      ) as string
      const rawPhase = (obj['phase'] ?? obj['sdlc_phase'] ?? 'requirements') as string
      const phase = (VALID_PHASES.has(rawPhase.toLowerCase()) ?
        rawPhase.toLowerCase() : 'requirements') as SDLCPhase

      return {
        label:       String(label).trim(),
        description: String(description).trim(),
        sdlcPhase:   phase,
        sourceRef:   obj['source_ref'] ? String(obj['source_ref']) : undefined,
      }
    })
  }

  /** YAML: simple feature list format (no full YAML spec; covers common cases).
   * Expected format:
   *   features:
   *     - name: Feature Name
   *       description: Feature description
   *       phase: requirements
   * OR flat list:
   *   - Feature Name -- Description
   */
  private parseYaml(content: string): FeatureCreateInput[] {
    const result: FeatureCreateInput[] = []
    const lines = content.split('\n')
    let current: Partial<FeatureCreateInput> | null = null

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      // New list item
      if (line.startsWith('- ')) {
        if (current?.label) result.push(this.normalizeYamlItem(current))
        const value = line.slice(2).trim()
        if (value.includes(':')) {
          // Inline key-value: - name: Foo  OR  - label: Foo
          const sep = value.indexOf(':')
          const key = value.slice(0, sep).toLowerCase().trim()
          const val = value.slice(sep + 1).trim()
          current = {}
          if (['name','label','feature'].includes(key)) current.label = val
          else if (['desc','description'].includes(key)) current.description = val
        } else if (value.includes('--') || value.includes('—')) {
          // Inline: - Feature Name -- Description
          const sep = value.search(/--|—/)
          current = {
            label:       value.slice(0, sep).trim(),
            description: value.slice(sep).replace(/^[-—]+\s*/, '').trim(),
            sdlcPhase:   'requirements',
          }
          result.push(this.normalizeYamlItem(current))
          current = null
        } else {
          current = { label: value }
        }
        continue
      }

      // Key-value continuation under current item
      if (current && line.includes(':')) {
        const sep = line.indexOf(':')
        const key = line.slice(0, sep).toLowerCase().trim()
        const val = line.slice(sep + 1).trim()
        if (['name','label','feature'].includes(key))        current.label = val
        if (['desc','description','details'].includes(key))  current.description = val
        if (['phase','sdlc_phase'].includes(key))            current.sdlcPhase = val as SDLCPhase
        if (['source_ref','ref','id'].includes(key))         current.sourceRef = val
      }
    }
    if (current?.label) result.push(this.normalizeYamlItem(current))
    return result
  }

  private normalizeYamlItem(item: Partial<FeatureCreateInput>): FeatureCreateInput {
    return {
      label:       (item.label ?? '').trim(),
      description: (item.description ?? item.label ?? '').trim(),
      sdlcPhase:   (VALID_PHASES.has(item.sdlcPhase ?? '') ?
                    item.sdlcPhase! : 'requirements') as SDLCPhase,
      sourceRef:   item.sourceRef,
    }
  }

  private splitCsvRow(line: string): string[] {
    const result: string[] = []
    let field = '', inQuote = false, sep = ','
    // Auto-detect separator
    if (!line.includes(',') && line.includes(';')) sep = ';'
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === sep && !inQuote) { result.push(field); field = ''; continue }
      field += ch
    }
    result.push(field)
    return result.map(f => f.trim().replace(/^"|"$/g, ''))
  }
}
```

---

## 14. CodeStructureExtractor — C3.5 Auto-Discovery

Uses the graph data already built by Pass A (DOMAIN_SERVICE names, module structure,
import hotspots) to infer likely feature descriptions — no file reading, no external API
for the inference prompt context. Outputs to `feature_suggestions` table for user review.

```typescript
// packages/main/src/iss/passC/codeStructureExtractor.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../llm/llmProvider.interface'
import type { ISSPassProgress } from '@shared/index'

export class CodeStructureExtractor {
  private readonly insertSuggestion: Database.Statement

  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.insertSuggestion = db.prepare(`
      INSERT INTO feature_suggestions
        (label, description, sdlc_phase, confidence, source, status)
      VALUES (?, ?, 'requirements', 0.50, 'code_structure', 'pending')
      ON CONFLICT DO NOTHING
    `)
  }

  async extract(
    progress: (pct: number, detail: string) => void,
  ): Promise<number> {
    progress(10, 'Reading domain services from graph…')

    // Build a structural summary from what Pass A already populated
    const services = this.db.prepare<[], { label: string; file_path: string | null }>(
      `SELECT label, file_path FROM graph_nodes
       WHERE kind = 'DOMAIN_SERVICE' ORDER BY importance_score DESC LIMIT 30`
    ).all()

    const modules = this.db.prepare<[], { label: string }>(
      `SELECT label FROM graph_nodes WHERE kind = 'MODULE'
       ORDER BY importance_score DESC LIMIT 15`
    ).all()

    const hotFiles = this.db.prepare<[], { file_path: string }>(
      `SELECT file_path FROM ucg_file_nodes
       ORDER BY imported_by_count DESC LIMIT 10`
    ).all()

    // Build the context block — entirely from the local graph, no file I/O
    const serviceList = services
      .map(s => `  - ${s.label}${s.file_path ? ` (${s.file_path})` : ''}`)
      .join('\n')
    const moduleList = modules.map(m => `  - ${m.label}`).join('\n')
    const hotList    = hotFiles.map(f => `  - ${f.file_path}`).join('\n')

    if (services.length === 0 && modules.length === 0) {
      progress(100, 'No structural data yet — run Pass A first')
      return 0
    }

    progress(40, 'Asking LLM to infer features from code structure…')

    const prompt = `You are analyzing a software codebase. Based on the structural information below,
infer what BUSINESS FEATURES this codebase likely implements.

Domain Services found:
${serviceList || '  (none found)'}

Top-level Modules:
${moduleList || '  (none found)'}

Most-imported files (architectural hotspots):
${hotList || '  (none found)'}

Task: Generate 5–10 likely business feature names with descriptions.
Each feature should be a distinct user-facing capability.
Return ONLY a JSON array — no prose, no markdown fences:
[{"name": "Feature Name", "description": "One sentence: what users can do"}]`

    try {
      const response = await this.provider.complete({
        model:      'claude-haiku-4-5',
        system:     'You infer business features from code structure. Return only JSON array.',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      })

      progress(80, 'Saving suggestions for review…')

      const clean    = response.replace(/```json|```/g, '').trim()
      const features = JSON.parse(clean) as { name: string; description: string }[]

      const batch = this.db.transaction(() => {
        for (const f of features) {
          if (!f.name || f.name.length < 3) continue
          this.insertSuggestion.run(f.name.slice(0, 200), (f.description ?? '').slice(0, 500))
        }
      })
      batch()

      const count = (this.db
        .prepare<[], { n: number }>(`SELECT COUNT(*) as n FROM feature_suggestions WHERE status = 'pending'`)
        .get()!).n

      progress(100, `${count} suggestions saved for review`)
      return count
    } catch (err) {
      progress(100, `Auto-discovery failed: ${err instanceof Error ? err.message : String(err)}`)
      return 0
    }
  }

  /** Promote approved suggestions to graph_nodes and clear them */
  approveSuggestion(id: number): { nodeId: number } {
    const sug = this.db.prepare<[number], {
      id: number; label: string; description: string; sdlc_phase: string
    }>('SELECT id, label, description, sdlc_phase FROM feature_suggestions WHERE id = ?').get(id)
    if (!sug) throw new Error(`Suggestion ${id} not found`)

    const result = this.db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, sdlc_phase,
         sdlc_confidence, importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'code_structure', ?, 0.50, 0.0, unixepoch() * 1000)
    `).run(sug.label, sug.description, sug.sdlc_phase)

    const nodeId = Number(result.lastInsertRowid)
    this.db.prepare(
      `UPDATE feature_suggestions SET status = 'approved', node_id = ?, reviewed_at = unixepoch() * 1000 WHERE id = ?`
    ).run(nodeId, id)

    return { nodeId }
  }

  rejectSuggestion(id: number): void {
    this.db.prepare(
      `UPDATE feature_suggestions SET status = 'rejected', reviewed_at = unixepoch() * 1000 WHERE id = ?`
    ).run(id)
  }

  approveAll(): number {
    const pending = this.db.prepare<[], { id: number }>(
      `SELECT id FROM feature_suggestions WHERE status = 'pending'`
    ).all()
    let approved = 0
    for (const { id } of pending) {
      try { this.approveSuggestion(id); approved++ } catch { /* skip */ }
    }
    return approved
  }
}
```

---

## 15. EmbeddingAligner — C4 Dual-Mode

```typescript
// packages/main/src/iss/passC/embeddingAligner.ts
import type Database from 'better-sqlite3'
import type { ILLMProvider } from '../../llm/llmProvider.interface'
import type { AlignmentResult } from '@shared/index'
import { EmbeddingService } from '../../indexer/embeddingService'
import { getSetting }       from '../../settingsStore'

const COSINE_THRESHOLD = 0.75
const BM25_CONFIDENCE  = 0.50    // capped confidence for BM25-fallback edges

export class EmbeddingAligner {
  private readonly embedSvc:   EmbeddingService
  private readonly insertEdge: Database.Statement
  private readonly updateVec:  Database.Statement

  constructor(
    private readonly db:       Database.Database,
    private readonly provider: ILLMProvider,
  ) {
    this.embedSvc   = EmbeddingService.getInstance()
    this.insertEdge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'IMPLEMENTS', 1.0, ?, ?, ?, unixepoch() * 1000)
    `)
    this.updateVec  = db.prepare(
      'UPDATE graph_nodes SET embedding_vec = ? WHERE id = ?'
    )
  }

  async align(
    progress: (pct: number, detail: string) => void,
  ): Promise<AlignmentResult> {
    const embeddingAvailable = await this.checkEmbeddingEndpoint()

    if (!embeddingAvailable) {
      progress(0, '⚠ Embedding endpoint unavailable — using BM25 fallback mode')
      return this.alignBM25(progress)
    }

    return this.alignEmbedding(progress)
  }

  // ── Mode A: Embedding alignment ────────────────────────────────────────────
  private async alignEmbedding(
    progress: (pct: number, detail: string) => void,
  ): Promise<AlignmentResult> {
    let aligned = 0, skipped = 0

    const features = this.db.prepare<[], { id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind IN ('FEATURE','USER_STORY')
         AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind = 'IMPLEMENTS')
         AND embedding_vec IS NULL`
    ).all()

    const services = this.db.prepare<[], {
      id: number; label: string; description: string | null; embedding_vec: Buffer | null
    }>(`SELECT id, label, description, embedding_vec FROM graph_nodes WHERE kind = 'DOMAIN_SERVICE'`).all()

    if (features.length === 0) return { mode: 'embedding', aligned: 0, skipped: 0, fallback: false }
    if (services.length === 0) return { mode: 'embedding', aligned: 0, skipped: features.length, fallback: false }

    // Pre-embed services without vectors
    const toEmbed = services.filter(s => !s.embedding_vec)
    if (toEmbed.length > 0) {
      const texts = toEmbed.map(s =>
        `${s.label}: ${(s.description ?? '').slice(0, 200)}`
      )
      const vecs = await this.callEmbeddings(texts)
      if (vecs) {
        const b = this.db.transaction(() =>
          toEmbed.forEach((s, i) => {
            if (vecs[i]) this.updateVec.run(this.embedSvc.serialize(vecs[i]!), s.id)
          })
        )
        b()
        toEmbed.forEach((s, i) => { s.embedding_vec = vecs[i] ? this.embedSvc.serialize(vecs[i]!) : null })
      }
    }

    const svcVecs = services
      .map(s => ({ id: s.id, vec: s.embedding_vec ? this.embedSvc.deserialize(s.embedding_vec) : null }))
      .filter(s => s.vec !== null)

    const BATCH = 20, total = features.length
    for (let i = 0; i < features.length; i += BATCH) {
      const batch = features.slice(i, i + BATCH)
      const texts = batch.map(f => `${f.label}: ${(f.description ?? '').slice(0, 200)}`)
      const vecs  = await this.callEmbeddings(texts)
      if (!vecs) { skipped += batch.length; continue }

      const edgeBatch = this.db.transaction(() => {
        batch.forEach((f, j) => {
          const fVec = vecs[j]
          if (!fVec) { skipped++; return }
          this.updateVec.run(this.embedSvc.serialize(fVec), f.id)
          let best = 0, bestId: number | null = null
          for (const svc of svcVecs) {
            const c = this.embedSvc.cosine(fVec, svc.vec!)
            if (c >= COSINE_THRESHOLD && c > best) { best = c; bestId = svc.id }
          }
          if (bestId) {
            this.insertEdge.run(f.id, bestId, best, 'llm',
              JSON.stringify({ method: 'embedding_cosine', score: best }))
            aligned++
          } else {
            skipped++
          }
        })
      })
      edgeBatch()
      progress(Math.round(((i + batch.length) / total) * 100),
               `${i + batch.length}/${total} · ${aligned} aligned`)
    }
    return { mode: 'embedding', aligned, skipped, fallback: false }
  }

  // ── Mode B: BM25 fallback alignment ────────────────────────────────────────
  // When the embedding endpoint is down, we match feature labels/descriptions
  // against DOMAIN_SERVICE labels using FTS5 BM25. Confidence is capped at 0.50
  // and source is tagged 'bm25_fallback' so the UI can flag these edges.
  private async alignBM25(
    progress: (pct: number, detail: string) => void,
  ): Promise<AlignmentResult> {
    let aligned = 0, skipped = 0

    const features = this.db.prepare<[], { id: number; label: string; description: string | null }>(
      `SELECT id, label, description FROM graph_nodes
       WHERE kind IN ('FEATURE','USER_STORY')
         AND id NOT IN (SELECT from_node_id FROM graph_edges WHERE kind = 'IMPLEMENTS')`
    ).all()

    const total = features.length

    // Pre-build a lookup: DOMAIN_SERVICE label → node_id
    const services = this.db.prepare<[], { id: number; label: string }>(
      `SELECT id, label FROM graph_nodes WHERE kind = 'DOMAIN_SERVICE'`
    ).all()
    const svcIndex = new Map(services.map(s => [s.label.toLowerCase(), s.id]))

    const batch = this.db.transaction(() => {
      features.forEach((f, i) => {
        if (i % 50 === 0) progress(Math.round((i / total) * 100),
          `BM25 fallback: ${i}/${total}`)

        const searchText = `${f.label} ${f.description ?? ''}`.toLowerCase()
        let bestId: number | null = null
        let bestLen = 0

        // Find the service whose name appears as the longest substring in the feature text
        for (const [svcName, svcId] of svcIndex) {
          const baseName = svcName
            .replace(/service|repository|controller|handler|manager|provider|gateway|client|adapter/gi, '')
            .trim()
          if (baseName.length < 3) continue
          if (searchText.includes(baseName) && baseName.length > bestLen) {
            bestLen = baseName.length; bestId = svcId
          }
        }

        // Fallback to FTS5 search if no substring match
        if (!bestId) {
          const sanitized = f.label.replace(/['"*()]/g, ' ').trim() + '*'
          try {
            const hit = this.db.prepare<[string], { id: number }>(`
              SELECT gn.id FROM graph_nodes gn
              WHERE gn.kind = 'DOMAIN_SERVICE'
                AND (LOWER(gn.label) LIKE LOWER(?) OR LOWER(COALESCE(gn.description,'')) LIKE LOWER(?))
              LIMIT 1
            `).get(`%${f.label.slice(0, 20)}%`, `%${f.label.slice(0, 20)}%`)
            if (hit) bestId = hit.id
          } catch { /* FTS5 search failed */ }
        }

        if (bestId) {
          this.insertEdge.run(
            f.id, bestId, BM25_CONFIDENCE, 'bm25_fallback',
            JSON.stringify({ method: 'bm25_fallback', query: f.label })
          )
          aligned++
        } else {
          skipped++
        }
      })
    })
    batch()

    progress(100, `BM25 fallback: ${aligned} IMPLEMENTS edges (confidence: 0.50)`)
    return { mode: 'bm25_fallback', aligned, skipped, fallback: true }
  }

  private async checkEmbeddingEndpoint(): Promise<boolean> {
    const apiKey = getSetting('embeddingApiKey')
    const base   = getSetting('embeddingBaseUrl')
    if (!apiKey || !base) return false
    try {
      const r = await fetch(`${base}/v1/embeddings`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: getSetting('embeddingModel') || 'text-embedding-3-small',
                                  input: ['ping'] }),
        signal:  AbortSignal.timeout(5_000),
      })
      return r.ok
    } catch { return false }
  }

  private async callEmbeddings(texts: string[]): Promise<number[][] | null> {
    const apiKey = getSetting('embeddingApiKey')
    const base   = getSetting('embeddingBaseUrl')
    try {
      const r = await fetch(`${base}/v1/embeddings`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: getSetting('embeddingModel') || 'text-embedding-3-small',
                                  input: texts }),
        signal:  AbortSignal.timeout(30_000),
      })
      if (!r.ok) return null
      const json = await r.json() as { data: { embedding: number[] }[] }
      return json.data.map(d => d.embedding)
    } catch { return null }
  }
}
```

---

## 16. Feature Impact Scoring (FIS) Engine

*(Identical to previous plan — included here for completeness)*

```typescript
// packages/main/src/iss/fisEngine.ts
import type Database from 'better-sqlite3'
import type { FISResult, SDLCMode, FISWeights } from '@shared/index'
import { EmbeddingService } from '../indexer/embeddingService'

const PHASE_WEIGHTS: Record<SDLCMode, FISWeights> = {
  requirements:  { alpha:0.30, beta:0.40, gamma:0.10, delta:0.10, epsilon:0.10 },
  design:        { alpha:0.20, beta:0.30, gamma:0.20, delta:0.10, epsilon:0.20 },
  implementation:{ alpha:0.20, beta:0.20, gamma:0.20, delta:0.20, epsilon:0.20 },
  testing:       { alpha:0.10, beta:0.20, gamma:0.10, delta:0.30, epsilon:0.30 },
  deployment:    { alpha:0.15, beta:0.15, gamma:0.20, delta:0.20, epsilon:0.30 },
  maintenance:   { alpha:0.20, beta:0.15, gamma:0.15, delta:0.30, epsilon:0.20 },
  auto:          { alpha:0.25, beta:0.25, gamma:0.20, delta:0.15, epsilon:0.15 },
}

const PHASE_RELEVANCE: Record<string, Record<string, number>> = {
  requirements:   { requirements:1.0, design:0.5, implementation:0.2, testing:0.1 },
  design:         { design:1.0, requirements:0.5, implementation:0.4, testing:0.2 },
  implementation: { implementation:1.0, design:0.6, testing:0.4, maintenance:0.3 },
  testing:        { testing:1.0, implementation:0.5, maintenance:0.3, design:0.2 },
  deployment:     { deployment:1.0, testing:0.4, maintenance:0.4, implementation:0.2 },
  maintenance:    { maintenance:1.0, testing:0.4, implementation:0.3, deployment:0.3 },
}

export class FISEngine {
  constructor(private readonly db: Database.Database) {}

  async score(
    query: string, sdlcMode: SDLCMode, maxResults = 20,
    overrides?: Partial<FISWeights>,
  ): Promise<FISResult[]> {
    const W = { ...PHASE_WEIGHTS[sdlcMode], ...overrides }
    const bm25   = this.getBM25(query, maxResults * 3)
    const cosine = await this.getCosine(query, bm25)
    const pr     = this.getPageRank(bm25.map(r => r.filePath))
    const cc     = this.getCoChange(bm25.slice(0, 5).map(r => r.filePath))
    const phases = this.getPhases(bm25.map(r => r.filePath))

    const scored = bm25.map(r => {
      const a = W.alpha   * Math.min(1, Math.max(0, 1 + r.raw / 10))
      const b = W.beta    * (cosine.get(r.filePath) ?? 0)
      const g = W.gamma   * (pr.get(r.filePath) ?? 0)
      const d = W.delta   * (cc.get(r.filePath) ?? 0)
      const e = W.epsilon * ((PHASE_RELEVANCE[sdlcMode] ?? {})[phases.get(r.filePath) ?? ''] ?? 0.1)
      return { filePath: r.filePath, score: a+b+g+d+e,
               components: { alpha:a, beta:b, gamma:g, delta:d, epsilon:e },
               sdlcPhase: phases.get(r.filePath) as import('@shared/index').SDLCPhase ?? null,
               nodeKind: r.nodeKind, importedByCount: r.fanIn }
    })

    // Append high-weight co-change partners not already in list
    for (const [fp, w] of cc) {
      if (!scored.find(s => s.filePath === fp) && w >= 0.5) {
        const pr2 = pr.get(fp) ?? 0
        const ph  = phases.get(fp) ?? ''
        const e   = W.epsilon * ((PHASE_RELEVANCE[sdlcMode] ?? {})[ph] ?? 0.1)
        scored.push({ filePath: fp, score: W.delta*w + W.gamma*pr2 + e,
          components: { alpha:0, beta:0, gamma: W.gamma*pr2, delta: W.delta*w, epsilon:e },
          sdlcPhase: ph as import('@shared/index').SDLCPhase ?? null,
          nodeKind: null, importedByCount: 0 })
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, maxResults)
  }

  getBlastRadius(topFiles: string[], depth = 2): string[] {
    const visited = new Set(topFiles)
    let frontier  = [...topFiles]
    for (let d = 0; d < depth; d++) {
      const ids = frontier.map(f =>
        (this.db.prepare<[string], { id: number }>(
          'SELECT id FROM graph_nodes WHERE file_path = ? LIMIT 1'
        ).get(f))?.id
      ).filter((id): id is number => Boolean(id))
      if (!ids.length) break
      const next: string[] = []
      for (const r of this.db.prepare<number[], { metadata_json: string }>(
        `SELECT DISTINCT metadata_json FROM graph_edges
         WHERE kind='CO_CHANGES_WITH' AND from_node_id IN (${ids.join(',')}) AND weight>=0.4`
      ).all()) {
        try {
          const f = (JSON.parse(r.metadata_json) as { file_b: string }).file_b
          if (!visited.has(f)) { visited.add(f); next.push(f) }
        } catch { /* skip */ }
      }
      frontier = next
      if (!frontier.length) break
    }
    return [...visited].filter(f => !topFiles.includes(f))
  }

  private getBM25(q: string, limit: number) {
    const s = q.replace(/['"*()]/g, ' ').trim() + '*'
    return this.db.prepare<[string, number], {
      filePath: string; raw: number; nodeKind: string|null; fanIn: number
    }>(`SELECT c.file_path as filePath, bm25(chunks_fts) as raw,
               gn.kind as nodeKind, COALESCE(ucg.imported_by_count,0) as fanIn
        FROM chunks_fts JOIN code_chunks c ON c.rowid=chunks_fts.rowid
        LEFT JOIN graph_nodes gn ON gn.file_path=c.file_path AND gn.kind IN ('DOMAIN_SERVICE','CLASS','MODULE')
        LEFT JOIN ucg_file_nodes ucg ON ucg.file_path=c.file_path
        WHERE chunks_fts MATCH ? ORDER BY raw LIMIT ?`
    ).all(s, limit)
  }

  private async getCosine(q: string, hits: { filePath: string }[]) {
    const map = new Map<string, number>()
    try {
      const results = await EmbeddingService.getInstance().hybridSearch(this.db, q, hits.length)
      for (const r of results) map.set(r.filePath, Math.max(0, r.score - 0.4))
    } catch { /* embedding unavailable */ }
    return map
  }

  private getPageRank(fps: string[]) {
    if (!fps.length) return new Map<string, number>()
    return new Map(
      this.db.prepare<string[], { file_path: string; importance_score: number }>(
        `SELECT file_path, importance_score FROM graph_nodes
         WHERE file_path IN (${fps.map(() => '?').join(',')}) AND importance_score>0
         GROUP BY file_path HAVING MAX(importance_score)`
      ).all(...fps).map(r => [r.file_path, r.importance_score])
    )
  }

  private getCoChange(seeds: string[]) {
    const map = new Map<string, number>()
    if (!seeds.length) return map
    const ids = seeds.map(f =>
      (this.db.prepare<[string], { id: number }>(
        'SELECT id FROM graph_nodes WHERE file_path=? LIMIT 1'
      ).get(f))?.id
    ).filter((id): id is number => Boolean(id))
    if (!ids.length) return map
    for (const r of this.db.prepare<number[], { metadata_json: string; weight: number }>(
      `SELECT metadata_json, AVG(weight) as weight FROM graph_edges
       WHERE kind='CO_CHANGES_WITH' AND from_node_id IN (${ids.join(',')})
       GROUP BY to_node_id ORDER BY weight DESC LIMIT 30`
    ).all()) {
      try {
        const f = (JSON.parse(r.metadata_json) as { file_b: string }).file_b
        map.set(f, r.weight)
      } catch { /* skip */ }
    }
    return map
  }

  private getPhases(fps: string[]) {
    if (!fps.length) return new Map<string, string>()
    return new Map(
      this.db.prepare<string[], { file_path: string; sdlc_phase: string }>(
        `SELECT file_path, sdlc_phase FROM graph_nodes
         WHERE file_path IN (${fps.map(() => '?').join(',')}) AND sdlc_phase IS NOT NULL
         GROUP BY file_path`
      ).all(...fps).map(r => [r.file_path, r.sdlc_phase])
    )
  }
}
```

---

## 17. SDLC Phase Router

*(Same as previous plan — unchanged)*

```typescript
// packages/main/src/iss/sdlcRouter.ts
import type Database from 'better-sqlite3'
import type { SDLCMode } from '@shared/index'

const MODE_SIGNALS: { mode: SDLCMode; patterns: RegExp[] }[] = [
  { mode: 'requirements', patterns: [/requirements?|user stor|epic|acceptance criteria|product owner|backlog/i] },
  { mode: 'design',       patterns: [/design|architect|interface|schema|openapi|api contract|data model/i] },
  { mode: 'implementation', patterns: [/implement|build|code|develop|write the/i] },
  { mode: 'testing',      patterns: [/test|spec|coverage|assertion|vitest|jest|pytest|e2e/i] },
  { mode: 'deployment',   patterns: [/deploy|docker|kubernetes|ci\/cd|pipeline|terraform|release/i] },
  { mode: 'maintenance',  patterns: [/migrat|deprecat|refactor|changelog|legacy|technical debt/i] },
]

export class SDLCRouter {
  private current: SDLCMode = 'auto'
  constructor(private readonly db: Database.Database) {}
  getMode() { return this.current }
  setMode(m: SDLCMode) { this.current = m }

  detect(opts: { userText?: string; activeFile?: string; featureId?: number }): SDLCMode {
    if (this.current !== 'auto') return this.current
    if (opts.userText) {
      for (const { mode, patterns } of MODE_SIGNALS)
        if (patterns.some(p => p.test(opts.userText!))) return mode
    }
    if (opts.activeFile) {
      const row = this.db.prepare<[string], { sdlc_phase: string | null }>(
        'SELECT sdlc_phase FROM graph_nodes WHERE file_path=? AND sdlc_phase IS NOT NULL LIMIT 1'
      ).get(opts.activeFile)
      if (row?.sdlc_phase) return row.sdlc_phase as SDLCMode
    }
    if (opts.featureId) {
      const has = this.db.prepare<[number], { cnt: number }>(
        `SELECT COUNT(*) as cnt FROM graph_edges WHERE from_node_id=? AND kind='IMPLEMENTS'`
      ).get(opts.featureId)
      if ((has?.cnt ?? 0) === 0) return 'design'
    }
    return 'implementation'
  }

  getActiveTools(mode: SDLCMode): string[] {
    const PO   = ['trace_feature_to_code','impact_analysis','feature_completion_status',
                  'find_similar_features','generate_acceptance_criteria','suggest_architecture']
    const RIAF = ['read_file','search_codebase','search_symbols','get_file_outline',
                  'get_import_graph','get_tests_for_file','get_ucg_metrics','ls_dir','get_recently_changed']
    if (mode === 'requirements') return [...PO, 'read_file','search_codebase']
    if (mode === 'design')       return [...PO, 'read_file','search_symbols','get_file_outline']
    return [...PO, ...RIAF]
  }

  getModePromptBlock(mode: SDLCMode): string {
    const FRAMES: Partial<Record<SDLCMode, string>> = {
      requirements:   'You are helping a PRODUCT OWNER define features. Prioritize business clarity.',
      design:         'You are helping design interfaces and architecture matching this codebase\'s conventions.',
      implementation: 'You are helping a developer implement features. Be precise about call chains and types.',
      testing:        'You are helping write and review tests. Focus on coverage gaps.',
      deployment:     'You are helping with deployment. Focus on Docker, CI config, environment variables.',
      maintenance:    'You are helping with maintenance. Focus on migrations, deprecations, technical debt.',
    }
    const f = FRAMES[mode]
    return f ? `\n## SDLC Mode: ${mode.toUpperCase()}\n${f}\n` : ''
  }
}
```

---

## 18. The Six PO-Facing Agent Tools

*(Architecture identical to previous plan. Key implementation points:)*

- `trace_feature_to_code`: queries `feature_traces` materialized table → depth-grouped by SDLC phase
- `impact_analysis`: calls `FISEngine.score()` + `FISEngine.getBlastRadius()`
- `feature_completion_status`: phase-by-phase subgraph check via `graph_edges`
- `find_similar_features`: BM25 label match + embedding cosine over FEATURE nodes
- `generate_acceptance_criteria`: LLM + existing TEST_CASE node patterns from Pass A
- `suggest_architecture`: nearest DOMAIN_SERVICE nodes by importance_score + label similarity

All six are registered via `registerToolPlugin()` in `issIpcHandlers.ts` — same plugin contract as the previous plan.

**One addition** for manual features: `trace_feature_to_code` now shows the edge source
(llm/gherkin/issue/git/bm25_fallback/manual) alongside each implementing node, so the
user can see how confident the trace is.

---

## 19. Approval Gate Hook

```typescript
// packages/main/src/iss/approvalGateHook.ts
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import { IPC } from '@shared/index'

export class ApprovalGateHook {
  constructor(
    private readonly db:  Database.Database,
    private readonly win: BrowserWindow,
  ) {}

  register(): void {
    ipcMain.handle('iss:checkCoChangeWarning', (_e, { filePath }: { filePath: string }) =>
      this.getWarning(filePath)
    )
  }

  getWarning(filePath: string): { hasWarning: boolean; partners: { filePath: string; weight: number }[] } {
    const node = this.db
      .prepare<[string], { id: number }>('SELECT id FROM graph_nodes WHERE file_path=? LIMIT 1')
      .get(filePath)
    if (!node) return { hasWarning: false, partners: [] }

    const rows = this.db.prepare<[number], { metadata_json: string; weight: number }>(
      `SELECT metadata_json, weight FROM graph_edges
       WHERE kind='CO_CHANGES_WITH' AND from_node_id=? AND weight>=0.5 ORDER BY weight DESC LIMIT 5`
    ).all(node.id)

    const partners = rows.map(r => {
      try {
        const meta = JSON.parse(r.metadata_json) as { file_b: string }
        return { filePath: meta.file_b, weight: r.weight }
      } catch { return null }
    }).filter((p): p is { filePath: string; weight: number } => p !== null)

    if (partners.length > 0) {
      this.win.webContents.send(IPC.ISS_COCHANGE_WARNING, {
        editedFile: filePath,
        partners,
        message: `⚠️ "${filePath}" co-changes with ${partners.length} file(s). Consider reviewing them.`,
      })
    }
    return { hasWarning: partners.length > 0, partners }
  }
}
```

---

## 20. ISS IPC Handler Registration

All handlers are in `issIpcHandlers.ts`. Key additions over the previous plan:

```typescript
// packages/main/src/iss/issIpcHandlers.ts (additions for manual feature + suggestions)

// ── Manual feature CRUD ────────────────────────────────────────────────────
ipcMain.handle('iss:featureCreate', (_e, input: FeatureCreateInput) => {
  const ingester = new ManualFeatureIngester(db)
  const result   = ingester.create(input)
  // Trigger C4 re-alignment asynchronously after manual create
  scheduleRealignment(db, root, win, getProvider)
  return result
})

ipcMain.handle('iss:featureUpdate', (_e, input: FeatureUpdateInput) =>
  new ManualFeatureIngester(db).update(input)
)

ipcMain.handle('iss:featureDelete', (_e, { id }: { id: number }) => {
  new ManualFeatureIngester(db).delete(id)
  new FeatureTracesMaterializer(db).materialize()
  return true
})

// ── Bulk import with preview ───────────────────────────────────────────────
ipcMain.handle('iss:featureImportPreview', (_e, {
  content, format
}: { content: string; format?: ImportFormat }) => {
  const parser = new FeatureImportParser()
  const existingLabels = new Set(
    (db.prepare<[], { label: string }>(
      `SELECT label FROM graph_nodes WHERE kind IN ('FEATURE','EPIC','USER_STORY')`
    ).all() as { label: string }[]).map(r => r.label.toLowerCase())
  )
  return parser.preview(content, format, existingLabels)
})

ipcMain.handle('iss:featureImport', (_e, {
  content, format, sourceName
}: { content: string; format?: ImportFormat; sourceName: string }) => {
  const parser  = new FeatureImportParser()
  const items   = parser.parse(content, format)
  const ingester = new ManualFeatureIngester(db)
  const result  = ingester.bulkCreate(items, sourceName)
  if (result.created > 0) scheduleRealignment(db, root, win, getProvider)
  return result
})

// ── Audit log ──────────────────────────────────────────────────────────────
ipcMain.handle('iss:featureGetAudit', (_e, { nodeId }: { nodeId?: number }) => {
  const where = nodeId ? `WHERE node_id = ${nodeId}` : ''
  return db.prepare(`SELECT * FROM manual_feature_audit ${where} ORDER BY created_at DESC LIMIT 100`).all()
})

// ── C3.5 suggestions ──────────────────────────────────────────────────────
ipcMain.handle('iss:discoverFeatures', async () => {
  const extractor = new CodeStructureExtractor(db, getProvider())
  const push = (p: ISSPassProgress) => win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
  const count = await extractor.extract(push)
  return { suggestions: count }
})

ipcMain.handle('iss:getSuggestions', () =>
  db.prepare(`SELECT * FROM feature_suggestions ORDER BY confidence DESC, created_at DESC`).all()
)

ipcMain.handle('iss:approveSuggestion', (_e, { id }: { id: number }) => {
  const extractor = new CodeStructureExtractor(db, getProvider())
  const result    = extractor.approveSuggestion(id)
  scheduleRealignment(db, root, win, getProvider)
  return result
})

ipcMain.handle('iss:rejectSuggestion', (_e, { id }: { id: number }) => {
  new CodeStructureExtractor(db, getProvider()).rejectSuggestion(id)
  return true
})

ipcMain.handle('iss:approveAllSuggestions', async () => {
  const approved = new CodeStructureExtractor(db, getProvider()).approveAll()
  if (approved > 0) scheduleRealignment(db, root, win, getProvider)
  return { approved }
})

// ── Alignment mode query ───────────────────────────────────────────────────
ipcMain.handle('iss:getAlignmentMode', async () => {
  const aligner = new EmbeddingAligner(db, getProvider())
  const avail   = await (aligner as unknown as { checkEmbeddingEndpoint(): Promise<boolean> })
                    .checkEmbeddingEndpoint()
  return avail ? 'embedding' : 'bm25_fallback'
})

// ── Feature count (used by gate check) ────────────────────────────────────
ipcMain.handle('iss:getFeatureCount', () => ({
  count: (db.prepare<[], { n: number }>(
    `SELECT COUNT(*) as n FROM graph_nodes WHERE kind IN ('FEATURE','EPIC','USER_STORY')`
  ).get()!).n
}))

// Helper: debounced C4 re-alignment trigger
function scheduleRealignment(
  db: Database.Database, root: string,
  win: BrowserWindow, getProvider: () => ILLMProvider
) {
  // Fire-and-forget with 2s debounce so rapid creates don't trigger many alignments
  clearTimeout(realignTimer)
  realignTimer = setTimeout(async () => {
    const passC = new PassCOrchestrator(db, root, win, getProvider)
    await passC.runAlignment()
  }, 2_000)
}
let realignTimer: NodeJS.Timeout | undefined
```

---

## 21. Renderer — Stores & UI Panels

### 21.1 `store/iss.store.ts`

```typescript
// packages/renderer/src/store/iss.store.ts
import { create } from 'zustand'
import { immer  } from 'zustand/middleware/immer'
import type {
  FeatureSuggestion, SDLCMode, ISSPassProgress,
  AlignmentMode, FeatureSummary
} from '@shared/index'

type ISSState = {
  sdlcMode:           SDLCMode
  alignmentMode:      AlignmentMode
  features:           FeatureSummary[]
  selectedFeatureId:  number | null
  passProgress:       ISSPassProgress | null
  passRunning:        boolean
  suggestions:        FeatureSuggestion[]
  needsFeatures:      boolean           // true → show "add features" prompt
  coChangeWarning:    { editedFile: string; partners: { filePath: string; weight: number }[] } | null

  // Actions
  setSdlcMode:          (m: SDLCMode) => void
  setAlignmentMode:     (m: AlignmentMode) => void
  setFeatures:          (f: FeatureSummary[]) => void
  setSelectedFeature:   (id: number | null) => void
  setPassProgress:      (p: ISSPassProgress | null) => void
  setPassRunning:       (v: boolean) => void
  setSuggestions:       (s: FeatureSuggestion[]) => void
  setNeedsFeatures:     (v: boolean) => void
  setCoChangeWarning:   (w: ISSState['coChangeWarning']) => void
}

export const useISSStore = create<ISSState>()(
  immer((set) => ({
    sdlcMode:          'auto',
    alignmentMode:     'unavailable',
    features:          [],
    selectedFeatureId: null,
    passProgress:      null,
    passRunning:       false,
    suggestions:       [],
    needsFeatures:     false,
    coChangeWarning:   null,

    setSdlcMode:        (m) => set(s => { s.sdlcMode = m }),
    setAlignmentMode:   (m) => set(s => { s.alignmentMode = m }),
    setFeatures:        (f) => set(s => { s.features = f }),
    setSelectedFeature: (id) => set(s => { s.selectedFeatureId = id }),
    setPassProgress:    (p) => set(s => { s.passProgress = p }),
    setPassRunning:     (v) => set(s => { s.passRunning = v }),
    setSuggestions:     (ss) => set(s => { s.suggestions = ss }),
    setNeedsFeatures:   (v) => set(s => { s.needsFeatures = v }),
    setCoChangeWarning: (w) => set(s => { s.coChangeWarning = w }),
  }))
)
```

### 21.2 `FeaturePanel` — Rewritten with Empty State & Fallback Chain UI

```
┌────────────────────────────────────────────────────────────────────────┐
│  Features              SDLC Mode: [ Auto ▾ ]     Alignment: ● BM25 ⚠  │
│  ─────────────────────────────────────────────────────────────────     │
│                                                                        │
│  ┌─ ACTION REQUIRED ─────────────────────────────────────────────────┐ │
│  │  ⚠ No features found yet. The ISS intent layer is empty.          │ │
│  │  To enable full PO capabilities, add features using one of:       │ │
│  │                                                                   │ │
│  │  [ 📄 Parse .feature files ]   [ 🐙 Import from GitHub ]         │ │
│  │  [ 📚 Mine from docs ]         [ 🔍 Auto-discover from code ]     │ │
│  │  [ ✏️  Add manually ]          [ 📥 Bulk import (CSV/JSON/text) ] │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  — OR — (after features exist) ────────────────────────────────────── │
│                                                                        │
│  [ Search features________________ ]   Source: [All ▾]                │
│                                                                        │
│  ◉ Payment Processing    [██████████] 100%  FEATURE  gherkin          │
│  ◉ OTP Login             [█████░░░░░]  50%  FEATURE  manual    [edit] │
│    ⚠ edge source: bm25_fallback (low confidence)                      │
│  ○ Recurring Billing     [███░░░░░░░]  30%  FEATURE  issue            │
│                                                                        │
│  [ + Add Feature ]  [ ↥ Import ]  [ 🔍 Auto-discover ]               │
└────────────────────────────────────────────────────────────────────────┘
```

**Empty state logic**: when `needsFeatures === true` in the store (pushed from main
when `ISS_NEEDS_FEATURES` event fires), the panel replaces the feature list with
the "ACTION REQUIRED" block. This cannot be dismissed — it disappears only when at
least one FEATURE node exists.

**Alignment badge**: shows `● Embedding` (green) or `● BM25 ⚠` (amber) based on
`alignmentMode` from the store. Amber badge is tappable and opens a tooltip:
"Embedding endpoint is unavailable. IMPLEMENTS edges were created using BM25 text
matching at 50% confidence. Configure an embedding endpoint in Settings for higher
accuracy."

**Manual/code_structure edge warning**: features with `bm25_fallback` IMPLEMENTS
edges show a subtle amber warning under their completion bar.

### 21.3 `ManualFeatureModal.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│  Add Feature                                                  ✕  │
│  ─────────────────────────────────────────────────────────────   │
│  Feature name *                                                   │
│  [ Payment Processing_________________________________ ]          │
│                                                                   │
│  Description *  (used for automatic code alignment)              │
│  [ Users can pay for orders using credit card, Apple Pay,___ ]   │
│  [ or bank transfer. Includes charge, refund, and receipt.___ ]  │
│  [_____________________________________________________ ]        │
│                                                                   │
│  SDLC Phase                External Reference (optional)         │
│  [ Requirements ▾ ]        [ JIRA-1234 / GitHub #45 / URL ]     │
│                                                                   │
│  ℹ A detailed description helps the system automatically find   │
│    the code that implements this feature (C4 alignment).         │
│    Minimum 10 characters.                                         │
│                                                                   │
│                              [ Cancel ]  [ Add Feature ]         │
└──────────────────────────────────────────────────────────────────┘
```

On submit → calls `window.electronAPI.invoke('iss:featureCreate', input)` →
main creates node → debounced C4 re-alignment fires in background →
`iss:passProgress` events update a subtle "Aligning…" indicator in the panel header.

### 21.4 `ImportFeaturesDialog.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│  Import Features                                              ✕  │
│  ─────────────────────────────────────────────────────────────   │
│  Format:  ● Plain text   ○ CSV   ○ JSON   ○ YAML                │
│                                                                   │
│  Plain text format:                                               │
│  Feature Name — Description                                       │
│  One feature per line. Lines starting with # are ignored.        │
│  Separator: — (em-dash), – (en-dash), --, or :                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Payment Processing — Users can pay using credit card or  │    │
│  │   bank transfer                                          │    │
│  │ OTP Login — Users can log in using a one-time password   │    │
│  │   sent to their mobile                                   │    │
│  │ # This line is a comment — ignored                       │    │
│  │ Recurring Billing — Monthly subscription billing with    │    │
│  │   automatic renewal and payment retry logic              │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  Preview (3 items):                                               │
│  ✅ Payment Processing — valid                                    │
│  ✅ OTP Login — valid                                             │
│  ✅ Recurring Billing — valid                                     │
│                                                                   │
│  Source label:  [ Manual import — July 2026         ]            │
│                                                                   │
│                    [ Cancel ]  [ Import 3 Features ] ←  enabled  │
└──────────────────────────────────────────────────────────────────┘
```

Preview calls `iss:featureImportPreview` on every keystroke (debounced 300ms) so
the user sees validation in real time. "Import" button is disabled until at least
one valid item exists. After import, panel closes and `FeaturePanel` refreshes.

### 21.5 `FeatureSuggestionsPanel.tsx`

Shown as a collapsible section in the FeaturePanel when `suggestions.length > 0`.

```
┌──────────────────────────────────────────────────────────────────┐
│  ▼ Auto-Discovered Suggestions (4 pending review)               │
│  Source: code structure analysis  Confidence: ~50%              │
│  ─────────────────────────────────────────────────────────────  │
│                                                                   │
│  □ Payment Processing                         [ ✓ Approve ] [ ✗ ]│
│    Users can make payments using credit card or other methods    │
│                                                                   │
│  □ User Authentication                        [ ✓ Approve ] [ ✗ ]│
│    Login, logout, and session management functionality           │
│                                                                   │
│  □ Order Management                           [ ✓ Approve ] [ ✗ ]│
│    Creating, tracking, and fulfilling customer orders            │
│                                                                   │
│  □ Notification Service                       [ ✓ Approve ] [ ✗ ]│
│    Email and push notification delivery to users                 │
│                                                                   │
│             [ ✓ Approve All (4) ]  [ ✗ Reject All ]             │
│                                                                   │
│  Note: Approved suggestions become FEATURE nodes and are        │
│  automatically aligned to implementing code (C4 alignment).     │
└──────────────────────────────────────────────────────────────────┘
```

Approve individual → `iss:approveSuggestion` → node created → C4 fires.
Approve All → `iss:approveAllSuggestions` → all approved → C4 fires once.
Reject individual → `iss:rejectSuggestion` → hidden from list.

---

## 22. RIAF Agent Integration

Two additive changes to the existing RIAF agent (no deletions):

**1. ISS context block in the system prompt** (in `contextAssembler.ts`):
```typescript
// Added to buildRiafSystemPrompt():
const featureCount = db.prepare('SELECT COUNT(*) as n FROM graph_nodes WHERE kind="FEATURE"').get()
const traceCount   = db.prepare('SELECT COUNT(*) as n FROM feature_traces').get()
const alignMode    = await aligner.checkEmbeddingEndpoint() ? 'embedding' : 'bm25_fallback'

if (featureCount.n > 0) {
  systemPrompt += `\n## ISS Graph\n- Features: ${featureCount.n}\n`
  systemPrompt += `- Traces: ${traceCount.n}\n`
  systemPrompt += `- Alignment: ${alignMode}\n`
  systemPrompt += router.getModePromptBlock(sdlcMode)
}
```

**2. ISS tools registered via plugin** (in `issIpcHandlers.ts`):
```typescript
// Called once at startup — ISS tools available in all RIAF agent runs
for (const tool of buildISSTools()) {
  registerToolPlugin({
    tool,
    execute: (input, db, root) =>
      executeISSTool({ id: '', name: tool.name, input }, db, root, getProvider())
  })
}
```

---

## 23. Build Order & Milestones

| Milestone | What to build | Gate |
|---|---|---|
| **M-ISS-0** | Schema V2 migration (new tables + indexes) | `SELECT * FROM feature_suggestions` works in SQLite browser |
| **M-ISS-1** | Pass A: SymbolPromoter + SemanticBootstrapper | `graph_nodes` has CLASS + DOMAIN_SERVICE + MODULE nodes after indexing |
| **M-ISS-2** | Pass A: CallGraphBuilder + TestLinker + InterfaceLinker | `graph_edges` has CALLS + TESTS + IMPLEMENTS_INTERFACE edges |
| **M-ISS-3** | SDLC Classifier + PageRank | Every `graph_nodes` row has non-null `sdlc_phase`; `importance_score` > 0 on service nodes |
| **M-ISS-4** | Pass B: CommitMiner + JaccardNormalizer + CoChangeMaterializer | CO_CHANGES_WITH edges exist; known co-changing pairs have weight > 0.5 |
| **M-ISS-5** | FeatureTracesMaterializer + ISS IPC (queries only) | `iss:getGraphNodes` returns data in renderer |
| **M-ISS-6** | **ManualFeatureIngester + FeatureImportParser** | Create a feature via IPC; it appears in `graph_nodes`; update + delete + audit work |
| **M-ISS-7** | ManualFeatureModal + ImportFeaturesDialog UI | Full create/import flow in renderer; validation shows in real time |
| **M-ISS-8** | EmbeddingAligner C4 — embedding mode | IMPLEMENTS edges with confidence ≥ 0.75 after creating features + configuring endpoint |
| **M-ISS-9** | EmbeddingAligner C4 — BM25 fallback mode | IMPLEMENTS edges with confidence 0.50 even when embedding endpoint is missing |
| **M-ISS-10** | CodeStructureExtractor C3.5 + FeatureSuggestionsPanel | `iss:discoverFeatures` creates `feature_suggestions`; approve promotes to graph_nodes |
| **M-ISS-11** | PassC C1 (Gherkin) + C2 (GitHub) + C3 (DocMiner) | Each ingestion source creates FEATURE nodes; fallback chain fires in correct order |
| **M-ISS-12** | PassCOrchestrator with full fallback chain + ISS_NEEDS_FEATURES event | "0 features" banner shown when all automatic sources fail; dismissed when user adds one |
| **M-ISS-13** | FIS Engine + SDLC Router | `iss:impactAnalysis` returns ranked results; phase changes produce different orderings |
| **M-ISS-14** | 6 PO Tools registered as RIAF agent plugins | All 6 tools callable via agent; `trace_feature_to_code` shows phase-grouped output |
| **M-ISS-15** | FeaturePanel + POWorkbenchPanel + ImpactPanel | End-to-end PO flow in UI |
| **M-ISS-16** | Approval gate hook | Warning banner appears in UI when editing a co-changing file |
| **M-ISS-17** | RIAF agent integration (ISS context block + mode prompt) | Agent run in Requirements Mode shows ISS feature context in system prompt |

---

## 24. Complete File Manifest

```
packages/main/src/iss/
├── issOrchestrator.ts
├── issIpcHandlers.ts
├── issTools.ts
├── sdlcClassifier.ts
├── pageRank.ts
├── fisEngine.ts
├── sdlcRouter.ts
├── featureTracesMaterializer.ts
├── approvalGateHook.ts
│
├── passA/
│   ├── passAOrchestrator.ts
│   ├── symbolPromoter.ts
│   ├── semanticBootstrapper.ts
│   ├── callGraphBuilder.ts
│   ├── testLinker.ts
│   └── interfaceLinker.ts
│
├── passB/
│   ├── passBOrchestrator.ts
│   ├── commitMiner.ts
│   ├── jaccardNormalizer.ts
│   └── coChangeMaterializer.ts
│
└── passC/
    ├── passCOrchestrator.ts        ← owns fallback chain logic
    ├── gherkinParser.ts            ← C1
    ├── githubIssueIngester.ts      ← C2
    ├── docMiner.ts                 ← C3
    ├── codeStructureExtractor.ts   ← C3.5 NEW
    ├── manualFeatureIngester.ts    ← NEW (create/update/delete/bulk)
    ├── featureImportParser.ts      ← NEW (text/CSV/JSON/YAML)
    └── embeddingAligner.ts         ← C4 (dual-mode: embed + BM25 fallback)

packages/shared/src/
├── ipc.channels.ts                 ← extended
└── db.types.ts                     ← extended

packages/renderer/src/
├── store/iss.store.ts
└── panels/iss/
    ├── ISSGraphPanel/index.tsx
    ├── FeaturePanel/
    │   ├── index.tsx               ← rewritten with empty-state
    │   ├── ManualFeatureModal.tsx  ← NEW
    │   ├── ImportFeaturesDialog.tsx ← NEW
    │   └── FeatureSuggestionsPanel.tsx ← NEW
    ├── POWorkbenchPanel/index.tsx
    └── ImpactPanel/index.tsx

packages/main/src/db/
├── schema.ts                       ← SCHEMA_V2 appended
└── migrations.ts                   ← version 2 added
```

**Total new files: 27** (25 backend + 2 new UI components + 1 new panel)
**Modified RIAF files: 6** (all additive — zero deletions)

---

## Summary of the Manual Feature Injection Architecture

The key guarantee: **C4 always runs when the user wants it to**.

The system achieves this through a layered strategy. The four external sources (Gherkin,
GitHub, doc mining, code-structure auto-discovery) are tried in sequence. If all fail or
produce nothing, the UI makes manual entry unmissable — a prominent "ACTION REQUIRED"
banner replaces the feature list and cannot be dismissed until at least one feature exists.
C4 itself is protected by an explicit gate check that aborts with a clear message if the
pre-condition is not met.

C4 then runs in one of two modes: embedding cosine (confidence 0.75–1.0, source `'llm'`)
when the embedding endpoint is available, or BM25 label matching (confidence 0.50, source
`'bm25_fallback'`) when it is not. Both modes produce IMPLEMENTS edges. The UI surfaces
the mode via an alignment badge and flags individual features whose edges were built via
the BM25 fallback, so users know which traces to trust fully and which to review.

Every manual action is audit-logged in `manual_feature_audit`. The `ManualFeatureIngester`
validates labels (min 3 chars) and descriptions (min 10 chars — enforced because a
meaningful description is what C4 aligns against). The `FeatureImportParser` supports
four formats (text, CSV, JSON, YAML) with a live preview that catches duplicates and
validation errors before any data is written. The `CodeStructureExtractor` (C3.5) uses
only the graph data from Pass A — no external source required — and outputs suggestions
to a review table rather than directly to `graph_nodes`, so the user retains control
over what enters the intent layer.
