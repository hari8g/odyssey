// packages/main/src/llm/llmProvider.interface.ts

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type LLMMessage = {
  role: 'user' | 'assistant'
  content: string | LLMContentBlock[]
}

export type LLMToolInputSchema = {
  type: 'object'
  properties: Record<string, { type: string; description?: string; enum?: string[] }>
  required?: string[]
}

export type LLMTool = {
  name: string
  description: string
  input_schema: LLMToolInputSchema
}

export type LLMRequest = {
  model: string
  system?: string
  messages: LLMMessage[]
  tools?: LLMTool[]
  max_tokens?: number
  temperature?: number
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; partial_json: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_stop'; stop_reason: string }
  | { type: 'error'; message: string }

export type ToolCallResult = {
  tool_use_id: string
  name: string
  input: Record<string, unknown>
  result: string
}

export interface ILLMProvider {
  /**
   * Non-streaming: resolve the full assistant message with all tool calls.
   */
  complete(req: LLMRequest): Promise<LLMMessage>

  /**
   * Streaming: yield StreamEvents as they arrive from the provider.
   */
  stream(req: LLMRequest): AsyncGenerator<StreamEvent>
}
