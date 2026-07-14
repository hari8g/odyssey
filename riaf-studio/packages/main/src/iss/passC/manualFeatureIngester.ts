// packages/main/src/iss/passC/manualFeatureIngester.ts
import type Database from 'better-sqlite3'
import type { FeatureCreateInput, FeatureUpdateInput } from '@shared/index'

type FeatureNodeRow = {
  id: number
  label: string
  description: string | null
  sdlc_phase: string
  source_ref: string | null
  source_type: string
}

export class ManualFeatureIngester {
  private readonly insertNode: Database.Statement
  private readonly updateNode: Database.Statement
  private readonly insertAudit: Database.Statement
  private readonly getNode: Database.Statement<[number], FeatureNodeRow>

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
    this.getNode = db.prepare(
      'SELECT id, label, description, sdlc_phase, source_ref, source_type FROM graph_nodes WHERE id = ?',
    )
  }

  create(input: FeatureCreateInput): { id: number; label: string } {
    this.validate(input.label, input.description)

    const result = this.insertNode.run(
      input.label.trim(),
      input.description.trim(),
      input.sourceRef ?? null,
      input.sdlcPhase ?? 'requirements',
    )
    const id = Number(result.lastInsertRowid)
    this.insertAudit.run(
      id,
      'create',
      input.label,
      JSON.stringify({ description: input.description, sdlcPhase: input.sdlcPhase }),
    )
    return { id, label: input.label }
  }

  update(input: FeatureUpdateInput): boolean {
    const existing = this.getNode.get(input.id)
    if (!existing) throw new Error(`Feature node ${input.id} not found`)
    if (existing.source_type !== 'manual') {
      throw new Error(
        `Cannot update node ${input.id}: it was created by '${existing.source_type}', not manually. ` +
          `Only manually created features can be edited here.`,
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
    this.insertAudit.run(
      input.id,
      'update',
      existing.label,
      JSON.stringify({ before: existing, after: input }),
    )
    return true
  }

  delete(id: number): boolean {
    const node = this.getNode.get(id)
    if (!node) throw new Error(`Feature node ${id} not found`)
    this.insertAudit.run(null, 'delete', node.label, JSON.stringify({ deletedId: id, label: node.label }))
    this.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(id)
    return true
  }

  bulkCreate(
    items: FeatureCreateInput[],
    sourceName: string,
  ): { created: number; duplicates: number; errors: string[] } {
    let created = 0
    let duplicates = 0
    const errors: string[] = []

    const findDup = this.db.prepare<[string], { id: number }>(
      `SELECT id FROM graph_nodes WHERE LOWER(label) = LOWER(?) AND kind = 'FEATURE'`,
    )

    const batch = this.db.transaction(() => {
      for (const item of items) {
        try {
          this.validate(item.label, item.description)

          const existing = findDup.get(item.label.trim())
          if (existing) {
            duplicates++
            continue
          }

          const result = this.insertNode.run(
            item.label.trim(),
            item.description.trim(),
            item.sourceRef ?? null,
            item.sdlcPhase ?? 'requirements',
          )
          const id = Number(result.lastInsertRowid)
          this.insertAudit.run(id, 'bulk_import', item.label, JSON.stringify({ source: sourceName }))
          created++
        } catch (err) {
          errors.push(`"${item.label}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    })
    batch()
    return { created, duplicates, errors }
  }

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
          'A meaningful description is needed for C4 alignment to work correctly.',
      )
    }
  }
}
