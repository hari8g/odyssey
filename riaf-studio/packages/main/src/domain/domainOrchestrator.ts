// packages/main/src/domain/domainOrchestrator.ts
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import type { AEPPassProgress } from '@shared/index'
import { IPC } from '@shared/index'
import { registerPostIndexHook } from '../indexer/indexingPipeline'
import { discover, load } from './domainPackLoader'
import { runPassD } from './passD/passDOrchestrator'
import { runDomainEnrichment } from './domainEnrichment'

type WorkspaceAccessors = {
  getDb: () => Database.Database | null
  getRoot: () => string | null
  getWin: () => BrowserWindow | null
  getProvider: () => ILLMProvider
}

let wired = false

/**
 * Register the domain orchestrator once at app startup.
 *
 * Registers a post-index hook that re-runs domain enrichment (ABOUT edges)
 * whenever a workspace re-index completes, but ONLY if domain packs have
 * already been loaded (domain_packs table is non-empty).
 *
 * Full Pass D (loading packs) is triggered manually via loadAndRunPassD(),
 * which will be called by IPC handlers registered in a separate agent.
 */
export function wireDomain(accessors: WorkspaceAccessors): void {
  if (wired) return
  wired = true

  registerPostIndexHook(async (db, _root) => {
    const registeredCount =
      db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM domain_packs').get()?.c ?? 0

    if (registeredCount === 0) return

    try {
      const edgesAdded = await runDomainEnrichment(db)
      if (edgesAdded === 0) return

      const win = accessors.getWin()
      if (win && !win.isDestroyed()) {
        const progress: AEPPassProgress = {
          pass: 'D',
          stage: 'enrichment',
          pct: 100,
          detail: `Re-enriched: +${edgesAdded} ABOUT edges`,
        }
        win.webContents.send(IPC.AEP_PASS_PROGRESS, progress)
      }
    } catch (err) {
      console.error('[DomainOrchestrator] post-index enrichment error:', err)
    }
  })
}

/**
 * Discover domain packs from standard locations, run Pass D, and register
 * each pack in the domain_packs table.
 *
 * Standard locations searched (in order):
 *   1. <workspaceRoot>/.riaf/domain_packs/
 *   2. Any additional dirs supplied in extraPackDirs
 *
 * Called manually (via IPC or CLI) — not automatically on every index.
 */
export async function loadAndRunPassD(
  db: Database.Database,
  root: string,
  win: BrowserWindow | null,
  extraPackDirs: string[] = [],
): Promise<{ packsLoaded: number; nodes: number; edges: number }> {
  const push = (p: AEPPassProgress): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.AEP_PASS_PROGRESS, p)
  }

  push({ pass: 'D', stage: 'discover', pct: 0, detail: 'Discovering domain packs…' })

  const packDirs = [path.join(root, '.riaf', 'domain_packs'), ...extraPackDirs]

  const packFiles: string[] = []
  for (const dir of packDirs) {
    packFiles.push(...discover(dir))
  }

  if (packFiles.length === 0) {
    push({ pass: 'D', stage: 'no_packs', pct: 100, detail: 'No domain packs found' })
    return { packsLoaded: 0, nodes: 0, edges: 0 }
  }

  push({ pass: 'D', stage: 'load', pct: 5, detail: `Loading ${packFiles.length} pack(s)…` })

  const packs = []
  const now = Date.now()
  const upsertPack = db.prepare(`
    INSERT OR REPLACE INTO domain_packs (name, version, file_path, loaded_at, node_count)
    VALUES (?, ?, ?, ?, 0)
  `)

  for (const filePath of packFiles) {
    try {
      const manifest = load(filePath)
      packs.push(manifest)
      upsertPack.run(manifest.name, manifest.version, filePath, now)
    } catch (err) {
      console.warn('[DomainOrchestrator] Skipping invalid pack:', filePath, err)
    }
  }

  if (packs.length === 0) {
    push({ pass: 'D', stage: 'no_valid_packs', pct: 100, detail: 'No valid packs loaded' })
    return { packsLoaded: 0, nodes: 0, edges: 0 }
  }

  push({ pass: 'D', stage: 'index', pct: 10, detail: `Indexing ${packs.length} pack(s)…` })
  const { nodes, edges } = await runPassD(db, packs, push)

  // Update node_count for each pack (approximate: total new nodes / packs)
  const perPack = packs.length > 0 ? Math.round(nodes / packs.length) : 0
  for (const pack of packs) {
    db.prepare('UPDATE domain_packs SET node_count = ? WHERE name = ?').run(perPack, pack.name)
  }

  push({ pass: 'D', stage: 'enrichment', pct: 90, detail: 'Running domain enrichment…' })
  const enrichEdges = await runDomainEnrichment(db)

  const totalEdges = edges + enrichEdges
  push({
    pass: 'D',
    stage: 'complete',
    pct: 100,
    detail: `Pass D complete — ${nodes} nodes, ${totalEdges} edges from ${packs.length} pack(s)`,
  })

  return { packsLoaded: packs.length, nodes, edges: totalEdges }
}
