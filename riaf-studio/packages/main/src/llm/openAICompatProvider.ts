// packages/main/src/llm/openAICompatProvider.ts
//
// OpenAI-compatible provider using raw fetch + SSE.
// Works with OpenAI, Ollama, LM Studio, vLLM, Together AI, etc.

import type {
  ILLMProvider,
  LLMMessage,
  LLMRequest,
  LLMContentBlock,
  LLMTool,
  StreamEvent,
} from './llmProvider.interface'

type OpenAIFunction = {
  name: string
  description: string
  parameters: LLMTool['input_schema']
}

type OpenAITool = {
  type: 'function'
  function: OpenAIFunction
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

function toOpenAIMessages(messages: LLMMessage[], system?: string): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  if (system) {
    result.push({ role: 'system', content: system })
  }

  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({ role: m.role as OpenAIMessage['role'], content: m.content })
      continue
    }

    // structured blocks — split into assistant message + tool result messages
    const assistantBlocks = m.content.filter((b) => b.type !== 'tool_result')
    const toolResults = m.content.filter(
      (b): b is Extract<LLMContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
    )

    if (assistantBlocks.length > 0) {
      const textContent = assistantBlocks
        .filter((b): b is Extract<LLMContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const toolCalls = assistantBlocks
        .filter(
          (b): b is Extract<LLMContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        )
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }))

      result.push({
        role: 'assistant',
        content: textContent || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }

    for (const tr of toolResults) {
      result.push({
        role: 'tool',
        content: tr.content,
        tool_call_id: tr.tool_use_id,
      })
    }
  }

  return result
}

function toOpenAITools(tools?: LLMTool[]): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6)
          if (data !== '[DONE]') yield data
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export class OpenAICompatProvider implements ILLMProvider {
  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string = 'https://api.openai.com', apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? ''
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
    return headers
  }

  async complete(req: LLMRequest): Promise<LLMMessage> {
    const body = {
      model: req.model,
      messages: toOpenAIMessages(req.messages, req.system),
      tools: toOpenAITools(req.tools),
      max_tokens: req.max_tokens ?? 8192,
      temperature: req.temperature ?? 0,
      stream: false,
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
      }>
    }

    const msg = data.choices[0]?.message
    if (!msg) throw new Error('Empty response from OpenAI-compat API')

    const blocks: LLMContentBlock[] = []
    if (msg.content) blocks.push({ type: 'text', text: msg.content })
    for (const tc of msg.tool_calls ?? []) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        /* ignore */
      }
      blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }

    return { role: 'assistant', content: blocks }
  }

  async *stream(req: LLMRequest): AsyncGenerator<StreamEvent> {
    const body = {
      model: req.model,
      messages: toOpenAIMessages(req.messages, req.system),
      tools: toOpenAITools(req.tools),
      max_tokens: req.max_tokens ?? 8192,
      temperature: req.temperature ?? 0,
      stream: true,
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      yield { type: 'error', message: `OpenAI API error ${res.status}: ${text}` }
      return
    }

    if (!res.body) {
      yield { type: 'error', message: 'No response body from OpenAI-compat API' }
      return
    }

    // per-index tool_call accumulator
    const toolCallAccum: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {}

    for await (const raw of parseSSE(res.body)) {
      let chunk: {
        choices: Array<{
          delta: {
            content?: string | null
            tool_calls?: Array<{
              index: number
              id?: string
              function?: { name?: string; arguments?: string }
            }>
          }
          finish_reason?: string | null
        }>
      }

      try {
        chunk = JSON.parse(raw)
      } catch {
        continue
      }

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (typeof delta.content === 'string' && delta.content) {
        yield { type: 'text_delta', delta: delta.content }
      }

      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index
        if (!toolCallAccum[idx]) {
          toolCallAccum[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
          yield { type: 'tool_use_start', id: toolCallAccum[idx].id, name: toolCallAccum[idx].name }
        }
        const argChunk = tc.function?.arguments ?? ''
        toolCallAccum[idx].arguments += argChunk
        if (argChunk) yield { type: 'tool_use_delta', partial_json: argChunk }
        if (tc.id) toolCallAccum[idx].id = tc.id
        if (tc.function?.name) toolCallAccum[idx].name = tc.function.name
      }

      const finishReason = chunk.choices[0]?.finish_reason
      if (finishReason) {
        // flush any accumulated tool calls
        for (const [, acc] of Object.entries(toolCallAccum)) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(acc.arguments) as Record<string, unknown>
          } catch {
            /* ignore */
          }
          yield { type: 'tool_use_end', id: acc.id, name: acc.name, input }
        }
        yield { type: 'message_stop', stop_reason: finishReason }
      }
    }
  }
}
