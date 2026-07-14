// packages/main/src/aep/upstream/passE/orgPackLoader.ts
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { parse as parseYaml } from 'yaml'
import type { OrgPackManifest } from '@shared/index'
import { upsertNode, insertEdge } from '../../graphWrite'

export interface OrgPackLoadResult {
  packId: number
  orgUnitIds: number[]
  objectiveIds: number[]
  investmentIds: number[]
  roleIds: number[]
  edgeCount: number
}

export class OrgPackLoader {
  constructor(private readonly db: Database.Database) {}

  load(filePath: string): OrgPackLoadResult {
    const raw = fs.readFileSync(filePath, 'utf8')
    const manifest = parseYaml(raw) as OrgPackManifest
    if (!manifest?.name) throw new Error(`Invalid org pack: missing name in ${filePath}`)

    return this.db.transaction((): OrgPackLoadResult => {
      // upsert org_packs row
      const existing = this.db
        .prepare<[string], { id: number }>('SELECT id FROM org_packs WHERE name = ?')
        .get(manifest.name)
      let packId: number
      if (existing) {
        packId = existing.id
        this.db
          .prepare('UPDATE org_packs SET version = ?, file_path = ?, loaded_at = unixepoch() * 1000 WHERE id = ?')
          .run(manifest.version ?? '1.0', path.resolve(filePath), packId)
      } else {
        packId = this.db
          .prepare(
            `INSERT INTO org_packs (name, version, file_path, loaded_at)
             VALUES (?, ?, ?, unixepoch() * 1000)`,
          )
          .run(manifest.name, manifest.version ?? '1.0', path.resolve(filePath))
          .lastInsertRowid as number
      }

      const orgUnitIds: number[] = []
      const objectiveIds: number[] = []
      const investmentIds: number[] = []
      const roleIds: number[] = []
      let edgeCount = 0

      // name → nodeId maps for cross-reference
      const unitMap = new Map<string, number>()
      const objMap = new Map<string, number>()

      for (const unit of manifest.orgUnits ?? []) {
        const id = upsertNode(this.db, {
          kind: 'ORG_UNIT',
          label: unit.name,
          description: unit.concern_kpis?.length
            ? `KPIs: ${unit.concern_kpis.join(', ')}`
            : null,
          source_type: 'org_pack',
          source_ref: manifest.name,
        })
        unitMap.set(unit.name, id)
        orgUnitIds.push(id)
      }

      for (const obj of manifest.objectives ?? []) {
        const id = upsertNode(this.db, {
          kind: 'BUSINESS_OBJECTIVE',
          label: obj.label,
          description: `Owner: ${obj.owner} | Horizon: ${obj.horizon}`,
          source_type: 'org_pack',
          source_ref: manifest.name,
        })
        objMap.set(obj.id, id)
        objectiveIds.push(id)

        const ownerUnitId = unitMap.get(obj.owner)
        if (ownerUnitId !== undefined) {
          insertEdge(this.db, id, ownerUnitId, 'OWNED_BY')
          edgeCount++
        }

        for (const kpiName of obj.kpis ?? []) {
          const kpiId = upsertNode(this.db, {
            kind: 'KPI',
            label: kpiName,
            source_type: 'org_pack',
            source_ref: manifest.name,
          })
          insertEdge(this.db, id, kpiId, 'MEASURED_BY')
          edgeCount++
        }
      }

      for (const inv of manifest.investments ?? []) {
        const id = upsertNode(this.db, {
          kind: 'INVESTMENT',
          label: inv.label,
          description: `Budget: ${inv.budget} ${inv.currency} | Horizon: ${inv.horizon} | Owner: ${inv.owner}`,
          source_type: 'org_pack',
          source_ref: manifest.name,
        })
        investmentIds.push(id)

        // investments are OWNED_BY the matching objective owner's unit
        const ownerUnitId = unitMap.get(inv.owner)
        if (ownerUnitId !== undefined) {
          insertEdge(this.db, id, ownerUnitId, 'OWNED_BY')
          edgeCount++
        }
      }

      for (const role of manifest.roles ?? []) {
        const id = upsertNode(this.db, {
          kind: 'STAKEHOLDER_ROLE',
          label: role.name,
          description: `Org unit: ${role.org_unit}`,
          source_type: 'org_pack',
          source_ref: manifest.name,
        })
        roleIds.push(id)

        const unitId = unitMap.get(role.org_unit)
        if (unitId !== undefined) {
          insertEdge(this.db, id, unitId, 'BELONGS_TO')
          edgeCount++
        }
      }

      return { packId, orgUnitIds, objectiveIds, investmentIds, roleIds, edgeCount }
    })()
  }

  loadDirectory(dir: string): OrgPackLoadResult[] {
    if (!fs.existsSync(dir)) return []
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => path.join(dir, f))
    return files.map((f) => this.load(f))
  }
}
