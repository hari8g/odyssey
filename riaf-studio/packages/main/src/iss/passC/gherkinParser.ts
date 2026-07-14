// packages/main/src/iss/passC/gherkinParser.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'

export class GherkinParser {
  private readonly insert: Database.Statement
  private readonly edge: Database.Statement
  private readonly get: Database.Statement<[string, string], { id: number }>

  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {
    this.insert = db.prepare(`
      INSERT INTO graph_nodes
        (kind, label, description, source_type, source_ref, sdlc_phase,
         sdlc_confidence, file_path, importance_score, created_at)
      VALUES (?, ?, ?, 'gherkin', ?, 'requirements', 0.99, ?, 0.0, unixepoch() * 1000)
    `)
    this.edge = db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_node_id, to_node_id, kind, weight, confidence, source, created_at)
      VALUES (?, ?, ?, 1.0, 1.0, 'gherkin', unixepoch() * 1000)
    `)
    this.get = db.prepare<[string, string], { id: number }>(
      'SELECT id FROM graph_nodes WHERE kind = ? AND label = ? LIMIT 1',
    )
  }

  parse(): { features: number; stories: number; criteria: number } {
    let features = 0
    let stories = 0
    let criteria = 0
    const files = this.db
      .prepare<[], { file_path: string }>(
        `SELECT file_path FROM file_metadata WHERE file_path LIKE '%.feature'`,
      )
      .all()

    const batch = this.db.transaction(() => {
      for (const { file_path } of files) {
        const abs = path.join(this.root, file_path)
        if (!fs.existsSync(abs)) continue
        const lines = fs.readFileSync(abs, 'utf8').split('\n')
        let currentFeatureId: number | null = null
        let currentStoryId: number | null = null
        let afterThen = false

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!.trim()
          if (line.startsWith('Feature:')) {
            const label = line.slice(8).trim()
            if (!this.get.get('FEATURE', label)) {
              this.insert.run(
                'FEATURE',
                label,
                `Gherkin feature: ${label}`,
                `gherkin:${file_path}`,
                file_path,
              )
            }
            currentFeatureId = this.get.get('FEATURE', label)?.id ?? null
            features++
          } else if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
            const label = line.replace(/Scenario(?: Outline)?:/, '').trim()
            const ref = `gherkin:${file_path}:${i + 1}`
            if (!this.get.get('USER_STORY', label)) {
              this.insert.run(
                'USER_STORY',
                label,
                `Gherkin scenario: ${label}`,
                ref,
                file_path,
              )
            }
            currentStoryId = this.get.get('USER_STORY', label)?.id ?? null
            if (currentFeatureId && currentStoryId)
              this.edge.run(currentFeatureId, currentStoryId, 'SPECIFIES')
            afterThen = false
            stories++
          } else if (line.startsWith('Then ')) {
            afterThen = true
            const label = line.slice(5).trim()
            if (!this.get.get('ACCEPTANCE_CRITERION', label)) {
              this.insert.run(
                'ACCEPTANCE_CRITERION',
                label,
                `Then: ${label}`,
                `gherkin:${file_path}:${i + 1}`,
                file_path,
              )
            }
            const ac = this.get.get('ACCEPTANCE_CRITERION', label)
            if (ac && currentStoryId) this.edge.run(currentStoryId, ac.id, 'SPECIFIES')
            criteria++
          } else if (afterThen && line.startsWith('And ')) {
            const label = line.slice(4).trim()
            if (!this.get.get('ACCEPTANCE_CRITERION', label)) {
              this.insert.run(
                'ACCEPTANCE_CRITERION',
                label,
                `And (Then): ${label}`,
                `gherkin:${file_path}:${i + 1}`,
                file_path,
              )
            }
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
