// packages/main/src/riaf/riafController.ts

import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { RiafConfig, RiafRunState } from '@shared/index'
import { IPC } from '@shared/index'
import { getSetting } from '../settingsStore'
import { createLLMProvider } from '../llm/createProvider'
import { buildRiafSystemPrompt, buildSnapshotFromDb } from '../llm/contextAssembler'
import { buildRiafUserMessage } from './riafPrompts'
import { runAgentLoop } from '../llm/toolRunner'
import { getWorkspaceSessionId } from '../workspaceSession'

// ---------------------------------------------------------------------------
// RiafController
// ---------------------------------------------------------------------------

export class RiafController {
  private state: RiafRunState = { status: 'idle' }
  private abortController: AbortController | null = null
  private db: Database.Database
  private workspaceRoot: string
  private win: BrowserWindow | null

  constructor(db: Database.Database, workspaceRoot: string, win: BrowserWindow | null) {
    this.db = db
    this.workspaceRoot = workspaceRoot
    this.win = win
  }

  getState(): RiafRunState {
    return this.state
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  private setState(state: RiafRunState): void {
    this.state = state
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.RIAF_STATE_CHANGE, state)
    }
  }

  async start(config: RiafConfig): Promise<void> {
    if (this.state.status === 'running') {
      throw new Error('RIAF agent is already running')
    }

    const sessionAtStart = getWorkspaceSessionId()
    const startedAt = Date.now()
    const outputPath = path.join(this.workspaceRoot, config.outputFileName)

    this.setState({ status: 'running', startedAt, outputPath })

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    try {
      const providerName = (getSetting('llmProvider') as string | undefined) ?? 'anthropic'
      const provider = createLLMProvider(providerName)

      const snapshot = buildSnapshotFromDb(this.db)
      const systemPrompt = buildRiafSystemPrompt(snapshot, this.db)

      const repoTitle = path.basename(this.workspaceRoot)

      const userMessage = buildRiafUserMessage(
        repoTitle,
        config.outputFileName,
        config.maxFiles,
        config.includeTests,
      )

      if (signal.aborted || sessionAtStart !== getWorkspaceSessionId()) {
        this.setState({ status: 'idle' })
        return
      }

      const finalDocument = await runAgentLoop(
        provider,
        {
          model: config.model,
          system: systemPrompt,
          messages: [userMessage],
          max_tokens: 8192,
          temperature: 0,
        },
        this.db,
        this.workspaceRoot,
        this.win,
      )

      if (signal.aborted || sessionAtStart !== getWorkspaceSessionId()) {
        this.setState({ status: 'idle' })
        return
      }

      const doc = finalDocument.trim()
      if (!doc || doc.length < 200 || !doc.includes('## 1.')) {
        throw new Error(
          'RIAF produced an incomplete document. Try running again — the agent may have stopped before writing all 12 sections.',
        )
      }

      fs.writeFileSync(outputPath, doc, 'utf8')

      const durationMs = Date.now() - startedAt
      this.setState({ status: 'done', startedAt, outputPath, durationMs })
    } catch (err) {
      if (signal.aborted) {
        this.setState({ status: 'idle' })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ status: 'error', startedAt, message })
    } finally {
      this.abortController = null
    }
  }
}
