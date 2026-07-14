// packages/main/src/llm/toolRunner.ts

import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import type { ILLMProvider, LLMMessage, LLMRequest, LLMContentBlock } from './llmProvider.interface'
import { executeTool, getAllTools, buildRiafTools } from '../riaf/riafTools'
import type { RiafStreamChunk } from '@shared/index'
import { IPC } from '@shared/index'

const MAX_ITERATIONS = 40

function sendChunk(win: BrowserWindow | null, chunk: RiafStreamChunk): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.RIAF_STREAM_CHUNK, chunk)
  }
}

function extractText(message: LLMMessage): string {
  if (typeof message.content === 'string') return message.content
  return (Array.isArray(message.content) ? message.content : [])
    .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/**
 * Collect full accumulated assistant message from stream events.
 * Returns the assistant LLMMessage to append to conversation.
 */
async function streamIteration(
  provider: ILLMProvider,
  req: LLMRequest,
  win: BrowserWindow | null,
): Promise<{
  message: LLMMessage
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stopReason: string
}> {
  const blocks: LLMContentBlock[] = []
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
  let stopReason = 'end_turn'

  for await (const event of provider.stream(req)) {
    if (event.type === 'text_delta') {
      const last = blocks[blocks.length - 1]
      if (last?.type === 'text') {
        ;(last as { type: 'text'; text: string }).text += event.delta
      } else {
        blocks.push({ type: 'text', text: event.delta })
      }
      sendChunk(win, { type: 'text', content: event.delta })
    } else if (event.type === 'tool_use_start') {
      blocks.push({ type: 'tool_use', id: event.id, name: event.name, input: {} })
      sendChunk(win, { type: 'tool_use_start', content: '', toolName: event.name })
    } else if (event.type === 'tool_use_end') {
      const block = blocks.find(
        (b): b is Extract<LLMContentBlock, { type: 'tool_use' }> =>
          b.type === 'tool_use' && b.id === event.id,
      )
      if (block) block.input = event.input
      toolCalls.push({ id: event.id, name: event.name, input: event.input })
    } else if (event.type === 'message_stop') {
      stopReason = event.stop_reason
    } else if (event.type === 'error') {
      sendChunk(win, { type: 'error', content: event.message })
      throw new Error(event.message)
    }
  }

  return {
    message: { role: 'assistant', content: blocks },
    toolCalls,
    stopReason,
  }
}

async function requestFinalDocument(
  provider: ILLMProvider,
  baseReq: LLMRequest,
  messages: LLMMessage[],
  win: BrowserWindow | null,
): Promise<string> {
  const synthesisMessages: LLMMessage[] = [
    ...messages,
    {
      role: 'user',
      content:
        'You have finished investigating. Output the complete 12-section markdown repository context document now. ' +
        'Do not call any tools. Start with `# ` followed by the repository name, then section `## 1. What This Repository Does`.',
    },
  ]

  const { message } = await streamIteration(
    provider,
    { ...baseReq, tools: undefined, messages: synthesisMessages },
    win,
  )

  return extractText(message).trim()
}

export async function runAgentLoop(
  provider: ILLMProvider,
  req: LLMRequest,
  db: Database.Database,
  workspaceRoot: string,
  win: BrowserWindow | null,
): Promise<string> {
  const tools = (() => {
    try {
      return getAllTools()
    } catch {
      return buildRiafTools()
    }
  })()

  const activeReq: LLMRequest = { ...req, tools }
  const messages: LLMMessage[] = [...req.messages]

  let finalText = ''

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const iterReq: LLMRequest = { ...activeReq, messages }

    const { message, toolCalls } = await streamIteration(provider, iterReq, win)
    messages.push(message)

    const iterationText = extractText(message).trim()
    if (iterationText) finalText = iterationText

    // Only stop when the model is done calling tools for this turn.
    if (toolCalls.length === 0) break

    const resultBlocks: LLMContentBlock[] = []
    for (const tc of toolCalls) {
      sendChunk(win, {
        type: 'tool_use_start',
        content: JSON.stringify(tc.input),
        toolName: tc.name,
      })

      let result: string
      try {
        result = await executeTool(
          { id: tc.id, name: tc.name, input: tc.input },
          db,
          workspaceRoot,
        )
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`
      }

      sendChunk(win, { type: 'tool_result', content: result, toolName: tc.name })
      resultBlocks.push({ type: 'tool_result', tool_use_id: tc.id, content: result })
    }

    messages.push({ role: 'user', content: resultBlocks })
  }

  if (!finalText || !finalText.includes('## 1.')) {
    const synthesized = await requestFinalDocument(provider, activeReq, messages, win)
    if (synthesized) finalText = synthesized
  }

  sendChunk(win, { type: 'done', content: '' })

  if (!finalText.trim()) {
    throw new Error(
      'RIAF agent finished without producing a document. Try running again or use a model with a larger context window.',
    )
  }

  return finalText
}
