// packages/main/src/iss/passC/githubIssueIngester.ts
import type Database from 'better-sqlite3'

const EPIC_LABELS = new Set(['epic', 'initiative', 'theme'])
const FEATURE_LABELS = new Set(['feature', 'enhancement', 'feat'])
const STORY_LABELS = new Set(['user-story', 'story', 'task'])

export class GitHubIssueIngester {
  private readonly insert: Database.Statement
  private readonly edge: Database.Statement
  private readonly getRef: Database.Statement<[string], { id: number }>

  constructor(
    private readonly db: Database.Database,
    private readonly token: string,
    private readonly owner: string,
    private readonly repo: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref,
         sdlc_phase, sdlc_confidence, importance_score, created_at)
      VALUES (?, ?, ?, 'issue', ?, 'requirements', 0.95, 0.0, unixepoch() * 1000)
    `)
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, ?, 1.0, 0.90, 'issue', ?, unixepoch() * 1000)
    `)
    this.getRef = db.prepare<[string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE source_ref = ? LIMIT 1',
    )
  }

  async ingest(
    progress: (pct: number, detail: string) => void,
  ): Promise<{ epics: number; features: number; stories: number }> {
    let epics = 0
    let features = 0
    let stories = 0
    const all: {
      number: number
      title: string
      body: string | null
      labels: { name: string }[]
    }[] = []
    let page = 1

    while (true) {
      const resp = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/issues?state=all&per_page=100&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github.v3+json',
          },
          signal: AbortSignal.timeout(30_000),
        },
      )
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`)
      const batch = (await resp.json()) as typeof all
      if (batch.length === 0) break
      all.push(...batch)
      progress(Math.min(90, Math.round((all.length / 300) * 90)), `Fetched ${all.length} issues…`)
      page++
      if (batch.length < 100) break
    }

    const batchInsert = this.db.transaction(() => {
      for (const issue of all) {
        const kind = this.classify(issue.labels)
        const ref = `gh:${this.owner}/${this.repo}#${issue.number}`
        if (!this.getRef.get(ref)) {
          this.insert.run(kind, issue.title, (issue.body ?? '').slice(0, 1000), ref)
        }
        if (kind === 'EPIC') epics++
        else if (kind === 'FEATURE') features++
        else stories++
      }
      for (const issue of all) {
        const ref = `gh:${this.owner}/${this.repo}#${issue.number}`
        const child = this.getRef.get(ref)
        if (!child) continue
        for (const parentRef of this.parentRefs(issue.body ?? '')) {
          const parent = this.getRef.get(parentRef)
          if (parent)
            this.edge.run(
              child.id,
              parent.id,
              'PRECEDED_BY',
              JSON.stringify({ child: ref, parent: parentRef }),
            )
        }
      }
    })
    batchInsert()
    return { epics, features, stories }
  }

  private classify(labels: { name: string }[]): 'EPIC' | 'FEATURE' | 'USER_STORY' {
    const set = new Set(labels.map((l) => l.name.toLowerCase()))
    if ([...set].some((l) => EPIC_LABELS.has(l))) return 'EPIC'
    if ([...set].some((l) => FEATURE_LABELS.has(l))) return 'FEATURE'
    if ([...set].some((l) => STORY_LABELS.has(l))) return 'USER_STORY'
    return 'USER_STORY'
  }

  private parentRefs(body: string): string[] {
    const refs: string[] = []
    for (const p of [/part of #(\d+)/gi, /parent #(\d+)/gi, /epic #(\d+)/gi]) {
      p.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = p.exec(body)) !== null) refs.push(`gh:${this.owner}/${this.repo}#${m[1]}`)
    }
    return refs
  }
}
