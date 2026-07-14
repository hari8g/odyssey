// packages/main/src/iss/issOrchestrator.ts
import type Database from 'better-sqlite3'
import type { BrowserWindow } from 'electron'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { registerPostIndexHook } from '../indexer/indexingPipeline'
import { PassAOrchestrator } from './passA/passAOrchestrator'
import { PassBOrchestrator } from './passB/passBOrchestrator'
import { PassCOrchestrator } from './passC/passCOrchestrator'
import { SDLCClassifier } from './sdlcClassifier'
import { PageRankEngine } from './pageRank'
import { FeatureTracesMaterializer } from './featureTracesMaterializer'
import { registerIssIpcHandlers } from './issIpcHandlers'
import { ApprovalGateHook } from './approvalGateHook'
import { getSetting } from '../settingsStore'
import { IPC } from '@shared/index'

type WorkspaceAccessors = {
  getDb: () => Database.Database | null
  getRoot: () => string | null
  getWin: () => BrowserWindow | null
  getProvider: () => ILLMProvider
}

let wired = false
let approvalGate: ApprovalGateHook | null = null

export class ISSOrchestrator {
  constructor(private readonly accessors: WorkspaceAccessors) {}

  register(): void {
    if (wired) return
    wired = true

    registerPostIndexHook(async (db, root) => {
      if (!getSetting('issEnabled')) return
      const win = this.accessors.getWin()
      if (!win || win.isDestroyed()) return
      await this.runPassA(db, root, win)
      if (getSetting('issPassBEnabled')) await this.runPassB(db, root, win)
      await this.runPassC(db, root, win)
    })

    registerIssIpcHandlers(this.accessors)

    approvalGate = new ApprovalGateHook(
      () => this.accessors.getDb(),
      () => this.accessors.getWin(),
    )
    approvalGate.register()
  }

  private async runPassA(
    db: Database.Database,
    root: string,
    win: BrowserWindow,
  ): Promise<void> {
    const push = (p: import('@shared/index').ISSPassProgress) =>
      win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
    try {
      await new PassAOrchestrator(db, root).run(push)
      await new SDLCClassifier(db, root, this.accessors.getProvider()).classifyAll(push)
      new PageRankEngine(db).compute()
      new FeatureTracesMaterializer(db).materialize()
      win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'A' })
    } catch (err) {
      win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'A',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async runPassB(db: Database.Database, root: string, win: BrowserWindow): Promise<void> {
    const push = (p: import('@shared/index').ISSPassProgress) =>
      win.webContents.send(IPC.ISS_PASS_PROGRESS, p)
    try {
      await new PassBOrchestrator(db, root).run(push)
      win.webContents.send(IPC.ISS_PASS_COMPLETE, { pass: 'B' })
    } catch (err) {
      win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'B',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async runPassC(
    db: Database.Database,
    root: string,
    win: BrowserWindow,
  ): Promise<void> {
    try {
      await new PassCOrchestrator(db, root, win, this.accessors.getProvider).runAll()
    } catch (err) {
      win.webContents.send(IPC.ISS_PASS_ERROR, {
        pass: 'C',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** Create and register the ISS orchestrator once at app startup. */
export function wireISS(accessors: WorkspaceAccessors): ISSOrchestrator {
  const orch = new ISSOrchestrator(accessors)
  orch.register()
  return orch
}

/** Check co-change partners for a file being edited (used by file watcher / IPC). */
export function checkCoChangeWarning(filePath: string): {
  hasWarning: boolean
  partners: { filePath: string; weight: number }[]
} {
  return approvalGate?.getWarning(filePath) ?? { hasWarning: false, partners: [] }
}
