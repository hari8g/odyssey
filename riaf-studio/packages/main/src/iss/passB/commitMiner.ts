// packages/main/src/iss/passB/commitMiner.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type Database from 'better-sqlite3'

const exec = promisify(execFile)
const MAX_FILES_PER_COMMIT = 50

const FEATURE_REFS = [
  { pattern: /#(\d+)/g, group: 1 },
  { pattern: /closes?\s+#(\d+)/gi, group: 1 },
  { pattern: /fixes?\s+#(\d+)/gi, group: 1 },
  { pattern: /implements?\s+#(\d+)/gi, group: 1 },
  { pattern: /JIRA-(\d+)/gi, group: 1 },
  { pattern: /feat(?:ure)?\s*:\s*([^(\n]{4,60})/gi, group: 1 },
]

export class CommitMiner {
  private readonly upsertPair: Database.Statement
  private readonly upsertCount: Database.Statement
  private readonly findFeature: Database.Statement<[string], { id: number }>
  private readonly createFeature: Database.Statement
  private readonly insertTrace: Database.Statement
  private readonly getMeta: Database.Statement<[], { last_commit_hash: string | null }>
  private readonly updateMeta: Database.Statement
  private readonly findFileNode: Database.Statement<[string], { id: number }>

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {
    this.upsertPair = db.prepare(`
      INSERT INTO co_change_pairs(file_a, file_b, co_count) VALUES (?, ?, 1)
      ON CONFLICT(file_a, file_b) DO UPDATE SET co_count = co_count + 1
    `)
    this.upsertCount = db.prepare(`
      INSERT INTO file_change_counts(file_path, change_count) VALUES (?, 1)
      ON CONFLICT(file_path) DO UPDATE SET change_count = change_count + 1
    `)
    this.findFeature = db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE kind = 'FEATURE' AND source_ref = ? LIMIT 1`,
    )
    this.createFeature = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref, importance_score, created_at)
      VALUES ('FEATURE', ?, ?, 'git', ?, 0.0, unixepoch() * 1000)
    `)
    this.insertTrace = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, metadata_json, created_at)
      VALUES (?, ?, 'TRACES_TO', 1.0, 0.80, 'git_log', ?, unixepoch() * 1000)
    `)
    this.getMeta = db.prepare('SELECT last_commit_hash FROM iss_mining_meta WHERE id = 1')
    this.updateMeta = db.prepare(`
      UPDATE iss_mining_meta
      SET last_commit_hash = ?, last_mined_at = unixepoch() * 1000,
          commits_processed = commits_processed + ?, pairs_found = pairs_found + ?
      WHERE id = 1
    `)
    this.findFileNode = db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE file_path = ? AND kind IN ('FUNCTION','CLASS','MODULE') LIMIT 1`,
    )
  }

  async mine(
    progress: (pct: number, detail: string) => void,
  ): Promise<{ commits: number; pairs: number; traces: number }> {
    let commits = 0
    let pairs = 0
    let traces = 0
    const meta = this.getMeta.get()
    const sinceArg = meta?.last_commit_hash ? [`${meta.last_commit_hash}..HEAD`] : []

    let raw: string
    try {
      const { stdout } = await exec(
        'git',
        [
          'log',
          '--no-merges',
          '--pretty=format:COMMIT_START%H%x09%s%x09%b',
          '--name-only',
          '--diff-filter=ACMR',
          ...sinceArg,
        ],
        { cwd: this.root, timeout: 60_000 },
      )
      raw = stdout
    } catch {
      progress(100, 'Git mining skipped (not a git repo or git not found)')
      return { commits: 0, pairs: 0, traces: 0 }
    }

    if (!raw.trim()) {
      progress(100, 'No new commits to mine')
      return { commits: 0, pairs: 0, traces: 0 }
    }

    const blocks = raw.split('COMMIT_START').filter(Boolean)
    const total = blocks.length
    let lastHash = ''

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!
      const nlIdx = block.indexOf('\n')
      const header = block.slice(0, nlIdx === -1 ? undefined : nlIdx).split('\t')
      const hash = header[0]?.trim() ?? ''
      const subject = header[1]?.trim() ?? ''
      const body = header[2]?.trim() ?? ''
      const files =
        nlIdx === -1
          ? []
          : block
              .slice(nlIdx + 1)
              .trim()
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)

      if (!hash) continue
      if (i === 0) lastHash = hash
      if (files.length > MAX_FILES_PER_COMMIT) continue
      commits++

      const refs = this.extractRefs(subject + ' ' + body)

      if (refs.length > 0) {
        const fileNodeIds: number[] = files
          .map((f) => this.findFileNode.get(f)?.id ?? 0)
          .filter(Boolean)

        if (fileNodeIds.length > 0) {
          const traceBatch = this.db.transaction(() => {
            for (const ref of refs) {
              if (!this.findFeature.get(ref.ref)) {
                this.createFeature.run(
                  ref.label,
                  `Feature mined from git. Ref: ${ref.ref}`,
                  ref.ref,
                )
              }
              const fn = this.findFeature.get(ref.ref)
              if (!fn) continue
              for (const nid of fileNodeIds) {
                this.insertTrace.run(fn.id, nid, JSON.stringify({ commit: hash, subject }))
                traces++
              }
            }
          })
          traceBatch()
        }
      }

      if (files.length >= 2) {
        const pairBatch = this.db.transaction(() => {
          for (let a = 0; a < files.length; a++) {
            this.upsertCount.run(files[a])
            for (let b = a + 1; b < files.length; b++) {
              const [fa, fb] =
                files[a]! < files[b]! ? [files[a], files[b]] : [files[b], files[a]]
              this.upsertPair.run(fa, fb)
              pairs++
            }
          }
        })
        pairBatch()
      }

      if (i % 50 === 0) {
        progress(Math.round((i / total) * 100), `${i}/${total} commits · ${traces} traces`)
      }
    }

    if (lastHash) this.updateMeta.run(lastHash, commits, pairs)
    return { commits, pairs, traces }
  }

  private extractRefs(text: string): { ref: string; label: string }[] {
    const found: { ref: string; label: string }[] = []
    const seen = new Set<string>()
    for (const { pattern, group } of FEATURE_REFS) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(text)) !== null) {
        const ref = m[group]?.trim()
        if (!ref || seen.has(ref)) continue
        seen.add(ref)
        found.push({ ref, label: /^\d+$/.test(ref) ? `Issue #${ref}` : ref })
      }
    }
    return found
  }
}
