// packages/main/src/llm/anthropicProvider.ts

import Anthropic from '@anthropic-ai/sdk'
import type {
  ILLMProvider,
  LLMMessage,
  LLMRequest,
  LLMContentBlock,
  StreamEvent,
} from './llmProvider.interface'

type AnthropicContentBlockParam =
  | Anthropic.TextBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam

function toAnthropicMessages(
  messages: LLMMessage[],
): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content } as Anthropic.MessageParam
    }
    const blocks: AnthropicContentBlockParam[] = m.content.map((b) => {
      if (b.type === 'text') {
        return { type: 'text', text: b.text } satisfies Anthropic.TextBlockParam
      }
      if (b.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: b.id,
          name: b.name,
          input: b.input,
        } satisfies Anthropic.ToolUseBlockParam
      }
      // tool_result
      return {
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: b.content,
      } satisfies Anthropic.ToolResultBlockParam
    })
    return { role: m.role, content: blocks } as Anthropic.MessageParam
  })
}

function toAnthropicTools(tools: LLMRequest['tools']): Anthropic.Tool[] {
  if (!tools) return []
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool['input_schema'],
  }))
}

export class AnthropicProvider implements ILLMProvider {
  private client: Anthropic

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY })
  }

  async complete(req: LLMRequest): Promise<LLMMessage> {
    const response = await this.client.messages.create({
      model: req.model,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: toAnthropicTools(req.tools),
      max_tokens: req.max_tokens ?? 8192,
      temperature: req.temperature ?? 0,
    })

    const blocks: LLMContentBlock[] = response.content.map((b) => {
      if (b.type === 'text') return { type: 'text', text: b.text }
      return {
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      }
    })

    return { role: 'assistant', content: blocks }
  }

  async *stream(req: LLMRequest): AsyncGenerator<StreamEvent> {
    const stream = this.client.messages.stream({
      model: req.model,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: toAnthropicTools(req.tools),
      max_tokens: req.max_tokens ?? 8192,
      temperature: req.temperature ?? 0,
    })

    let currentToolId = ''
    let currentToolName = ''
    let partialJson = ''

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id
          currentToolName = event.content_block.name
          partialJson = ''
          yield { type: 'tool_use_start', id: currentToolId, name: currentToolName }
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text_delta', delta: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          partialJson += event.delta.partial_json
          yield { type: 'tool_use_delta', partial_json: event.delta.partial_json }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(partialJson) as Record<string, unknown>
          } catch {
            // empty or partial — treat as empty
          }
          yield { type: 'tool_use_end', id: currentToolId, name: currentToolName, input }
          currentToolId = ''
          currentToolName = ''
          partialJson = ''
        }
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          yield { type: 'message_stop', stop_reason: event.delta.stop_reason }
        }
      }
    }
  }
}
