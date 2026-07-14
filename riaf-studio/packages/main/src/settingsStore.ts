// packages/main/src/settingsStore.ts
import Store from 'electron-store'
import type { FISWeights, SDLCMode } from '@shared/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppSettings = {
  /** Which LLM backend to use for RIAF generation. */
  llmProvider: 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'openai-compat'

  // Provider credentials / endpoints
  anthropicApiKey: string
  openaiApiKey: string
  ollamaBaseUrl: string
  lmstudioBaseUrl: string
  openaiCompatBaseUrl: string
  openaiCompatApiKey: string

  /** Default model name forwarded to the active provider. */
  defaultModel: string

  // Embedding service (OpenAI-compat /v1/embeddings endpoint)
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  embeddingsEnabled: boolean

  // RIAF generation defaults
  riafMaxFiles: number
  riafIncludeTests: boolean

  // ISS Graph
  issEnabled: boolean
  issPassBEnabled: boolean
  githubToken: string
  githubRepoOwner: string
  githubRepoName: string
  defaultSdlcMode: SDLCMode
  fisWeightsRequirements: FISWeights | null
  fisWeightsDesign: FISWeights | null
  fisWeightsImpl: FISWeights | null
  fisWeightsTesting: FISWeights | null

  // App state
  recentWorkspaces: string[]
  theme: 'dark' | 'light' | 'system'
  /** Named background palette id (default | slate | navy | charcoal | forest | wine). */
  backgroundTheme: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: AppSettings = {
  llmProvider: 'anthropic',
  anthropicApiKey: '',
  openaiApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  lmstudioBaseUrl: 'http://localhost:1234',
  openaiCompatBaseUrl: '',
  openaiCompatApiKey: '',
  defaultModel: 'claude-sonnet-4-6',
  embeddingBaseUrl: 'https://api.openai.com',
  embeddingApiKey: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingsEnabled: false,
  riafMaxFiles: 150,
  riafIncludeTests: false,
  issEnabled: true,
  issPassBEnabled: true,
  githubToken: '',
  githubRepoOwner: '',
  githubRepoName: '',
  defaultSdlcMode: 'auto',
  fisWeightsRequirements: null,
  fisWeightsDesign: null,
  fisWeightsImpl: null,
  fisWeightsTesting: null,
  recentWorkspaces: [],
  theme: 'dark',
  backgroundTheme: 'default',
}

// ─── Singleton store ──────────────────────────────────────────────────────────

// Lazy-initialized so the Electron app is ready before we access userData paths.
// electron-store v10 is ESM-only; cast the result to preserve generic typing
// without relying on generic constructor syntax that breaks with some TS/bundler
// combinations.
let _store: Store<AppSettings> | null = null

export function getStore(): Store<AppSettings> {
  if (!_store) {
    _store = new Store({ defaults: DEFAULTS }) as Store<AppSettings>
  }
  return _store
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return getStore().get(key) as AppSettings[K]
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  getStore().set(key, value)
}

/**
 * Prepends dir to recentWorkspaces, deduplicates, and caps at 10 entries.
 */
export function addRecentWorkspace(dir: string): void {
  const store = getStore()
  const current = store.get('recentWorkspaces') as string[]
  const updated = [dir, ...current.filter((w) => w !== dir)].slice(0, 10)
  store.set('recentWorkspaces', updated)
}

export function removeRecentWorkspace(dir: string): string[] {
  const store = getStore()
  const updated = (store.get('recentWorkspaces') as string[]).filter((w) => w !== dir)
  store.set('recentWorkspaces', updated)
  return updated
}

export function clearRecentWorkspaces(): void {
  getStore().set('recentWorkspaces', [])
}
