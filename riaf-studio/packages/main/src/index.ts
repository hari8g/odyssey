// packages/main/src/index.ts
import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, closeDb } from './db/db'
import { addRecentWorkspace, getSetting } from './settingsStore'
import { IndexingPipeline } from './indexer/indexingPipeline'
import { FileWatcher } from './indexer/fileWatcher'
import { RiafController } from './riaf/riafController'
import { EmbeddingService } from './indexer/embeddingService'
import { IPC } from '@shared/index'
import { registerIpcHandlers } from './ipcHandlers'
import { wireISS } from './iss/issOrchestrator'
import { resetIssIpcState } from './iss/issIpcHandlers'
import { wireDomain } from './domain/domainOrchestrator'
import { createLLMProvider } from './llm/createProvider'
import type Database from 'better-sqlite3'

// ─── Module-level state ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let openWorkspaceRoot: string | null = null
let openDb: Database.Database | null = null
let pipeline: IndexingPipeline | null = null
let watcher: FileWatcher | null = null
let riafController: RiafController | null = null

import { bumpWorkspaceSession } from './workspaceSession'

export function getOpenWorkspaceRoot(): string | null {
  return openWorkspaceRoot
}

export function getOpenDb(): Database.Database | null {
  return openDb
}

export function getPipeline(): IndexingPipeline | null {
  return pipeline
}

export function getWatcher(): FileWatcher | null {
  return watcher
}

export function getRiafController(): RiafController | null {
  return riafController
}

/** Starts the file watcher for live incremental re-indexing. */
export function startWatcher(): void {
  watcher?.start()
}

// ─── Workspace lifecycle ──────────────────────────────────────────────────────

export type OpenWorkspaceOptions = {
  /** Delete `.riaf/` and rebuild the index from scratch. */
  replaceIndex?: boolean
}

function wipeWorkspaceIndex(workspaceRoot: string): void {
  const riafDir = path.join(workspaceRoot, '.riaf')
  if (!fs.existsSync(riafDir)) return
  for (const entry of fs.readdirSync(riafDir)) {
    fs.rmSync(path.join(riafDir, entry), { recursive: true, force: true })
  }
}

async function teardownWorkspace(): Promise<void> {
  getRiafController()?.abort()
  await watcher?.stop()
  watcher = null
  pipeline?.abort()
  pipeline = null
  riafController = null
  openWorkspaceRoot = null
  openDb = null
  resetIssIpcState()
  closeDb()
}

export async function openWorkspace(
  dir: string,
  options: OpenWorkspaceOptions = {},
): Promise<void> {
  await teardownWorkspace()

  if (options.replaceIndex) {
    wipeWorkspaceIndex(dir)
  }

  openWorkspaceRoot = dir

  const win = mainWindow
  if (!win) throw new Error('Main window is not available')

  const db = initDb(dir)
  openDb = db
  addRecentWorkspace(dir)

  pipeline = new IndexingPipeline(db, dir)
  watcher = new FileWatcher(db, dir)
  riafController = new RiafController(db, dir, win)

  const sessionId = bumpWorkspaceSession()

  if (!win.isDestroyed()) {
    win.webContents.send(IPC.WORKSPACE_CHANGED, { root: dir, sessionId })
    win.webContents.send(IPC.INDEXER_PROGRESS, {
      stage: 'scan',
      phase: 'running',
      pct: 0,
      detail: 'Starting index…',
    })
  }

  pipeline.run().catch((err) => {
    console.error('[openWorkspace] indexing failed:', err)
  })
}

// ─── Window creation ──────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#0d0d0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.riaf-studio')

  app.on('browser-window-created', (_e, win) => {
    optimizer.watchWindowShortcuts(win)
  })

  // Configure EmbeddingService singleton from stored settings
  if (getSetting('embeddingsEnabled') && getSetting('embeddingApiKey')) {
    EmbeddingService.instance.configure({
      apiKey: getSetting('embeddingApiKey'),
      baseUrl: getSetting('embeddingBaseUrl'),
      model: getSetting('embeddingModel'),
    })
  }

  createWindow()
  registerIpcHandlers()

  wireISS({
    getDb: getOpenDb,
    getRoot: getOpenWorkspaceRoot,
    getWin: () => mainWindow,
    getProvider: () => createLLMProvider(),
  })

  wireDomain({
    getDb: getOpenDb,
    getRoot: getOpenWorkspaceRoot,
    getWin: () => mainWindow,
    getProvider: () => createLLMProvider(),
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  watcher?.stop().catch(console.error)
  pipeline?.abort()
  closeDb()
})
