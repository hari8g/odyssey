import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Check, Settings2, Compass } from 'lucide-react'
import { clsx } from 'clsx'
import { AepOnboarding } from './AepOnboarding'
import {
  BACKGROUND_THEMES,
  DEFAULT_BACKGROUND_THEME,
  applyBackgroundTheme,
  type BackgroundThemeId,
} from '@/theme/backgroundThemes'

type Provider = 'anthropic' | 'openai' | 'ollama' | 'lmstudio' | 'openai-compat'

type SettingsValues = {
  llmProvider: Provider
  anthropicApiKey: string
  openaiApiKey: string
  ollamaBaseUrl: string
  lmstudioBaseUrl: string
  openaiCompatBaseUrl: string
  openaiCompatApiKey: string
  defaultModel: string
  embeddingBaseUrl: string
  embeddingApiKey: string
  embeddingModel: string
  embeddingsEnabled: boolean
  riafMaxFiles: number
  riafIncludeTests: boolean
  issEnabled: boolean
  issPassBEnabled: boolean
  githubToken: string
  githubRepoOwner: string
  githubRepoName: string
  theme: 'dark' | 'light' | 'system'
  backgroundTheme: BackgroundThemeId
}

const DEFAULTS: SettingsValues = {
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
  theme: 'dark',
  backgroundTheme: DEFAULT_BACKGROUND_THEME,
}

function Field({
  label,
  saved,
  children,
}: {
  label: string
  saved?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-500">{label}</label>
        {saved && <Check size={10} className="text-accent-2" />}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 border-b border-border pb-1">
        {title}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

const INPUT =
  'bg-surface-3 border border-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors w-full'

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'openai-compat', label: 'OpenAI-compat' },
]

type SettingsTab = 'config' | 'aep-guide'

export function SettingsPanel() {
  const [tab, setTab] = useState<SettingsTab>('aep-guide')
  const [settings, setSettings] = useState<SettingsValues>(DEFAULTS)
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.electronAPI.getSettings().then((vals) => {
      if (vals && typeof vals === 'object') {
        const partial = vals as Partial<SettingsValues>
        setSettings((s) => ({ ...s, ...partial }))
        if (partial.backgroundTheme) {
          applyBackgroundTheme(partial.backgroundTheme)
        }
      }
    })
  }, [])

  const save = useCallback(async (key: keyof SettingsValues, value: unknown) => {
    await window.electronAPI.setSettings(key, value)
    if (key === 'backgroundTheme') {
      applyBackgroundTheme(value as string)
    }
    setSavedKeys((prev) => new Set(prev).add(key))
    setTimeout(
      () =>
        setSavedKeys((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        }),
      1500,
    )
  }, [])

  const upd = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  return (
    <div className="flex flex-col h-full overflow-hidden min-w-0">
      <div className="flex items-center gap-1 px-3 sm:px-4 pt-3 pb-2 border-b border-border shrink-0 overflow-x-auto">
        <button
          onClick={() => setTab('aep-guide')}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
            tab === 'aep-guide'
              ? 'bg-accent/15 text-accent'
              : 'text-gray-500 hover:text-gray-200 hover:bg-surface-3',
          )}
        >
          <Compass size={12} />
          AEP Guide
        </button>
        <button
          onClick={() => setTab('config')}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
            tab === 'config'
              ? 'bg-accent/15 text-accent'
              : 'text-gray-500 hover:text-gray-200 hover:bg-surface-3',
          )}
        >
          <Settings2 size={12} />
          Configuration
        </button>
      </div>

      {tab === 'aep-guide' ? (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 min-w-0">
          <AepOnboarding />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 min-w-0">
      <Section title="Appearance">
        <Field label="Background colour" saved={savedKeys.has('backgroundTheme')}>
          <div className="flex flex-wrap gap-2">
            {BACKGROUND_THEMES.map((t) => {
              const selected = settings.backgroundTheme === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.label}
                  onClick={() => {
                    upd('backgroundTheme', t.id)
                    void save('backgroundTheme', t.id)
                  }}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 p-1.5 rounded-lg border transition-colors',
                    selected
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface-3/40 hover:border-gray-500',
                  )}
                >
                  <span
                    className="block w-10 h-10 rounded-md border border-border/80 shadow-inner"
                    style={{ backgroundColor: t.swatch }}
                  />
                  <span
                    className={clsx(
                      'text-[10px] font-mono',
                      selected ? 'text-accent' : 'text-gray-500',
                    )}
                  >
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>
      </Section>

      <Section title="Journey UI">
        <Field label="First-run tour">
          <button
            type="button"
            onClick={() => {
              void import('@/design/tour').then(({ resetTourFlag }) => {
                resetTourFlag()
                window.location.hash = '#/'
                window.location.reload()
              })
            }}
            className="px-3 py-1.5 text-xs rounded border border-border bg-surface-3 text-gray-300 hover:text-white"
          >
            Replay Journey tour
          </button>
        </Field>
      </Section>

      <Section title="LLM Provider">
        <div className="flex flex-wrap gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                upd('llmProvider', p.id)
                save('llmProvider', p.id)
              }}
              className={clsx(
                'px-3 py-1 text-xs font-mono rounded border transition-colors',
                settings.llmProvider === p.id
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-surface-3 border-border text-gray-500 hover:text-gray-200',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {settings.llmProvider === 'anthropic' && (
          <Field label="Anthropic API Key" saved={savedKeys.has('anthropicApiKey')}>
            <input
              type="password"
              value={settings.anthropicApiKey}
              onChange={(e) => upd('anthropicApiKey', e.target.value)}
              onBlur={() => save('anthropicApiKey', settings.anthropicApiKey)}
              className={INPUT}
              placeholder="sk-ant-…"
            />
          </Field>
        )}

        {settings.llmProvider === 'openai' && (
          <Field label="OpenAI API Key" saved={savedKeys.has('openaiApiKey')}>
            <input
              type="password"
              value={settings.openaiApiKey}
              onChange={(e) => upd('openaiApiKey', e.target.value)}
              onBlur={() => save('openaiApiKey', settings.openaiApiKey)}
              className={INPUT}
              placeholder="sk-…"
            />
          </Field>
        )}

        {settings.llmProvider === 'ollama' && (
          <Field label="Ollama Base URL" saved={savedKeys.has('ollamaBaseUrl')}>
            <input
              value={settings.ollamaBaseUrl}
              onChange={(e) => upd('ollamaBaseUrl', e.target.value)}
              onBlur={() => save('ollamaBaseUrl', settings.ollamaBaseUrl)}
              className={INPUT}
            />
          </Field>
        )}

        {settings.llmProvider === 'lmstudio' && (
          <Field label="LM Studio Base URL" saved={savedKeys.has('lmstudioBaseUrl')}>
            <input
              value={settings.lmstudioBaseUrl}
              onChange={(e) => upd('lmstudioBaseUrl', e.target.value)}
              onBlur={() => save('lmstudioBaseUrl', settings.lmstudioBaseUrl)}
              className={INPUT}
            />
          </Field>
        )}

        {settings.llmProvider === 'openai-compat' && (
          <>
            <Field label="Base URL" saved={savedKeys.has('openaiCompatBaseUrl')}>
              <input
                value={settings.openaiCompatBaseUrl}
                onChange={(e) => upd('openaiCompatBaseUrl', e.target.value)}
                onBlur={() => save('openaiCompatBaseUrl', settings.openaiCompatBaseUrl)}
                className={INPUT}
                placeholder="https://…"
              />
            </Field>
            <Field label="API Key" saved={savedKeys.has('openaiCompatApiKey')}>
              <input
                type="password"
                value={settings.openaiCompatApiKey}
                onChange={(e) => upd('openaiCompatApiKey', e.target.value)}
                onBlur={() => save('openaiCompatApiKey', settings.openaiCompatApiKey)}
                className={INPUT}
              />
            </Field>
          </>
        )}

        <Field label="Default Model" saved={savedKeys.has('defaultModel')}>
          <input
            value={settings.defaultModel}
            onChange={(e) => upd('defaultModel', e.target.value)}
            onBlur={() => save('defaultModel', settings.defaultModel)}
            className={INPUT}
          />
        </Field>
      </Section>

      <Section title="Embeddings">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="embeddingsEnabled"
            checked={settings.embeddingsEnabled}
            onChange={(e) => {
              upd('embeddingsEnabled', e.target.checked)
              save('embeddingsEnabled', e.target.checked)
            }}
            className="accent-accent"
          />
          <label htmlFor="embeddingsEnabled" className="text-xs text-gray-500 cursor-pointer">
            Enable hybrid search (requires embedding endpoint)
          </label>
        </div>

        {settings.embeddingsEnabled && (
          <>
            <Field label="Embedding Base URL" saved={savedKeys.has('embeddingBaseUrl')}>
              <input
                value={settings.embeddingBaseUrl}
                onChange={(e) => upd('embeddingBaseUrl', e.target.value)}
                onBlur={() => save('embeddingBaseUrl', settings.embeddingBaseUrl)}
                className={INPUT}
              />
            </Field>
            <Field label="Embedding API Key" saved={savedKeys.has('embeddingApiKey')}>
              <input
                type="password"
                value={settings.embeddingApiKey}
                onChange={(e) => upd('embeddingApiKey', e.target.value)}
                onBlur={() => save('embeddingApiKey', settings.embeddingApiKey)}
                className={INPUT}
                placeholder="sk-…"
              />
            </Field>
            <Field label="Embedding Model" saved={savedKeys.has('embeddingModel')}>
              <input
                value={settings.embeddingModel}
                onChange={(e) => upd('embeddingModel', e.target.value)}
                onBlur={() => save('embeddingModel', settings.embeddingModel)}
                className={INPUT}
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="RIAF Defaults">
        <Field label="Max files" saved={savedKeys.has('riafMaxFiles')}>
          <input
            type="number"
            value={settings.riafMaxFiles}
            onChange={(e) => upd('riafMaxFiles', Number(e.target.value))}
            onBlur={() => save('riafMaxFiles', settings.riafMaxFiles)}
            className={INPUT}
          />
        </Field>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="riafIncludeTests"
            checked={settings.riafIncludeTests}
            onChange={(e) => {
              upd('riafIncludeTests', e.target.checked)
              save('riafIncludeTests', e.target.checked)
            }}
            className="accent-accent"
          />
          <label htmlFor="riafIncludeTests" className="text-xs text-gray-500 cursor-pointer">
            Include test files
          </label>
        </div>
      </Section>

      <Section title="ISS Graph">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="issEnabled"
            checked={settings.issEnabled}
            onChange={(e) => {
              upd('issEnabled', e.target.checked)
              save('issEnabled', e.target.checked)
            }}
            className="accent-accent"
          />
          <label htmlFor="issEnabled" className="text-xs text-gray-500 cursor-pointer">
            Enable ISS after indexing
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="issPassBEnabled"
            checked={settings.issPassBEnabled}
            onChange={(e) => {
              upd('issPassBEnabled', e.target.checked)
              save('issPassBEnabled', e.target.checked)
            }}
            className="accent-accent"
          />
          <label htmlFor="issPassBEnabled" className="text-xs text-gray-500 cursor-pointer">
            Enable Pass B (git co-change mining)
          </label>
        </div>
        <Field label="GitHub Token" saved={savedKeys.has('githubToken')}>
          <input
            type="password"
            value={settings.githubToken}
            onChange={(e) => upd('githubToken', e.target.value)}
            onBlur={() => save('githubToken', settings.githubToken)}
            className={INPUT}
            placeholder="ghp_…"
          />
        </Field>
        <Field label="GitHub Owner" saved={savedKeys.has('githubRepoOwner')}>
          <input
            value={settings.githubRepoOwner}
            onChange={(e) => upd('githubRepoOwner', e.target.value)}
            onBlur={() => save('githubRepoOwner', settings.githubRepoOwner)}
            className={INPUT}
            placeholder="org-or-user"
          />
        </Field>
        <Field label="GitHub Repo" saved={savedKeys.has('githubRepoName')}>
          <input
            value={settings.githubRepoName}
            onChange={(e) => upd('githubRepoName', e.target.value)}
            onBlur={() => save('githubRepoName', settings.githubRepoName)}
            className={INPUT}
            placeholder="repo-name"
          />
        </Field>
      </Section>
        </div>
      )}
    </div>
  )
}
