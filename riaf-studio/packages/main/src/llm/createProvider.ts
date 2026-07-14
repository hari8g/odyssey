// packages/main/src/llm/createProvider.ts
import { getSetting } from '../settingsStore'
import type { ILLMProvider } from './llmProvider.interface'
import { AnthropicProvider } from './anthropicProvider'
import { OpenAICompatProvider } from './openAICompatProvider'

/** Build an LLM provider from current settings. */
export function createLLMProvider(providerName?: string): ILLMProvider {
  const name = providerName ?? ((getSetting('llmProvider') as string | undefined) ?? 'anthropic')
  switch (name) {
    case 'openai':
      return new OpenAICompatProvider(
        'https://api.openai.com',
        getSetting('openaiApiKey') as string | undefined,
      )
    case 'ollama':
      return new OpenAICompatProvider(
        (getSetting('ollamaBaseUrl') as string | undefined) ?? 'http://localhost:11434',
      )
    case 'lmstudio':
      return new OpenAICompatProvider(
        (getSetting('lmstudioBaseUrl') as string | undefined) ?? 'http://localhost:1234',
      )
    case 'openai-compat': {
      const baseUrl = (getSetting('openaiCompatBaseUrl') as string | undefined) ?? ''
      const apiKey = (getSetting('openaiCompatApiKey') as string | undefined) ?? ''
      return new OpenAICompatProvider(baseUrl, apiKey)
    }
    case 'anthropic':
    default:
      return new AnthropicProvider(getSetting('anthropicApiKey') as string | undefined)
  }
}
