// packages/main/src/cycle/cycleIpcHandlers.ts
import { ipcMain, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { IPC } from '@shared/index'
import type { ILLMProvider } from '../llm/llmProvider.interface'
import { CycleOrchestrator } from './cycleOrchestrator'
import { DemoSimulator } from './demoSimulator'

type Accessors = {
  getDb: () => Database.Database | null
  getWin: () => BrowserWindow | null
  getProvider: () => ILLMProvider
}

let cycleOrch: CycleOrchestrator | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let handlersRegistered = false

export function getCycleOrchestrator(): CycleOrchestrator | null {
  return cycleOrch
}

export function ensureCycleOrchestrator(
  db: Database.Database,
  win: BrowserWindow,
  getProvider: () => ILLMProvider,
): CycleOrchestrator {
  if (!cycleOrch) {
    cycleOrch = new CycleOrchestrator(db, win, getProvider)
  }
  return cycleOrch
}

/** Soft-reset orchestrator when workspace closes (DB handle invalidates). */
export function resetCycleOrchestrator(): void {
  cycleOrch = null
}

export function registerCycleIpcHandlers(accessors: Accessors): void {
  if (handlersRegistered) return
  handlersRegistered = true

  const requireOrch = (): CycleOrchestrator => {
    const db = accessors.getDb()
    const win = accessors.getWin()
    if (!db || !win) throw new Error('No workspace open')
    return ensureCycleOrchestrator(db, win, accessors.getProvider)
  }

  ipcMain.handle(IPC.CYCLE_START, (_e, input: { label: string; mode: 'live' | 'demo'; painPointIds?: number[] }) => {
    try {
      const orch = requireOrch()
      const runId = orch.startCycle(input)
      return { ok: true, runId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CYCLE_LIST, () => {
    const db = accessors.getDb()
    if (!db) return []
    return db
      .prepare(`SELECT * FROM cycle_runs ORDER BY updated_at DESC LIMIT 20`)
      .all()
  })

  ipcMain.handle(IPC.CYCLE_GET, (_e, { runId }: { runId: number }) => {
    try {
      return requireOrch().getRun(runId) ?? null
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CYCLE_TIMELINE, (_e, { runId }: { runId: number }) => {
    try {
      return requireOrch().getTimeline(runId)
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.CYCLE_ADVANCE, async (_e, { runId }: { runId: number }) => {
    try {
      await requireOrch().advance(runId)
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CYCLE_ABORT, (_e, { runId }: { runId: number }) => {
    const db = accessors.getDb()
    if (!db) return { error: 'No workspace open' }
    db.prepare(`UPDATE cycle_runs SET status='aborted', updated_at=unixepoch()*1000 WHERE id=?`).run(
      runId,
    )
    const orch = cycleOrch
    if (orch) {
      const run = orch.getRun(runId)
      accessors.getWin()?.webContents.send(IPC.CYCLE_UPDATE, run)
    }
    return { ok: true }
  })

  ipcMain.handle(
    IPC.CYCLE_PORTFOLIO_GATE,
    async (
      _e,
      {
        runId,
        input,
      }: {
        runId: number
        input: {
          decision: 'admit' | 'defer' | 'reject'
          approvedByRole: string
          rationale: string
          featureNodeId?: number
        }
      },
    ) => {
      try {
        await requireOrch().approvePortfolioGate(runId, input)
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    IPC.CYCLE_SIGN_RELEASE,
    async (
      _e,
      { runId, role, rationale }: { runId: number; role: string; rationale: string },
    ) => {
      try {
        await requireOrch().signReleaseGate(runId, role, rationale)
        return { ok: true }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.CYCLE_SIMULATE_SIGNALS, (_e, { runId }: { runId: number }) => {
    try {
      const db = accessors.getDb()
      if (!db) throw new Error('No workspace open')
      const n = new DemoSimulator(db).simulateSignals(runId)
      void requireOrch().advance(runId)
      return { ok: true, count: n }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.CYCLE_SIMULATE_CI, async (_e, { runId }: { runId: number }) => {
    try {
      const db = accessors.getDb()
      if (!db) throw new Error('No workspace open')
      const result = new DemoSimulator(db).simulateCI(runId)
      await requireOrch().advance(runId)
      return { ok: true, ...result }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.CYCLE_SIMULATE_KPI,
    (_e, { runId, drift }: { runId: number; drift: number }) => {
      try {
        const db = accessors.getDb()
        if (!db) throw new Error('No workspace open')
        const n = new DemoSimulator(db).simulateKpi(runId, drift ?? 0.9)
        void requireOrch().advance(runId)
        return { ok: true, count: n }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
}

/** Call after workspace DB is ready — resume open runs + start WAIT-stage tick. */
export function startCycleTickLoop(accessors: Accessors): void {
  const db = accessors.getDb()
  const win = accessors.getWin()
  if (!db || !win) return

  const orch = ensureCycleOrchestrator(db, win, accessors.getProvider)
  orch.resumeAll()

  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(() => {
    try {
      const d = accessors.getDb()
      const w = accessors.getWin()
      if (!d || !w || w.isDestroyed()) return
      ensureCycleOrchestrator(d, w, accessors.getProvider).handleTick()
    } catch (err) {
      console.error('[CycleRunner] tick error:', err)
    }
  }, 30_000)
}

export function stopCycleTickLoop(): void {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  resetCycleOrchestrator()
}

/** Also advance waiting cycles when AEP tick is invoked manually. */
export function cycleHandleAepTick(): void {
  cycleOrch?.handleTick()
}
