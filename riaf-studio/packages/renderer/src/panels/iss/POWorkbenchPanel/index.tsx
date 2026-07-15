import { useState } from 'react'
import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

type Tool = {
  id: string
  label: string
  placeholder: string
  description: string
  call: (input: string) => Promise<unknown>
}

const TOOLS: Tool[] = [
  {
    id: 'trace',
    label: 'Find the code',
    placeholder: 'Feature ID or label…',
    description: 'trace_feature_to_code',
    call: (input) => eAPI.traceFeature(isNaN(Number(input)) ? input : Number(input)),
  },
  {
    id: 'impact',
    label: 'What else changes?',
    placeholder: 'File path or query…',
    description: 'impact_analysis',
    call: (input) => eAPI.impactAnalysis({ query: input }),
  },
  {
    id: 'status',
    label: 'How complete is this?',
    placeholder: 'Feature ID or label…',
    description: 'feature_completion_status',
    call: (input) => eAPI.featureStatus(isNaN(Number(input)) ? input : Number(input)),
  },
  {
    id: 'similar',
    label: 'Are there duplicates?',
    placeholder: 'Feature ID or label…',
    description: 'find_similar_features',
    call: (input) => eAPI.findSimilarFeatures(isNaN(Number(input)) ? input : Number(input)),
  },
  {
    id: 'criteria',
    label: 'Write acceptance tests',
    placeholder: 'Feature ID or description…',
    description: 'generate_acceptance_criteria',
    call: (input) => eAPI.genCriteria(isNaN(Number(input)) ? input : Number(input)),
  },
  {
    id: 'architecture',
    label: 'Architecture suggestions',
    placeholder: 'Feature ID or description…',
    description: 'suggest_architecture',
    call: (input) =>
      eAPI.suggestArchitecture?.(isNaN(Number(input)) ? input : Number(input)) ??
      eAPI.suggestArch?.(isNaN(Number(input)) ? input : Number(input)),
  },
]

const INPUT =
  'bg-surface-3 border border-border rounded px-2 py-1.5 text-xs font-mono text-gray-200 outline-none focus:border-accent transition-colors flex-1'

function resultToString(result: unknown): string {
  if (typeof result === 'string') return result
  if (result == null) return '(no result)'
  if (typeof result === 'object' && 'error' in (result as object)) {
    return `Error: ${(result as { error: string }).error}`
  }
  if (typeof result === 'object' && 'data' in (result as object)) {
    const d = (result as { data: unknown }).data
    return typeof d === 'string' ? d : JSON.stringify(d, null, 2)
  }
  return JSON.stringify(result, null, 2)
}

export function POWorkbenchPanel() {
  const [activeTool, setActiveTool] = useState<string>(TOOLS[0]!.id)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const tool = TOOLS.find((t) => t.id === activeTool)!

  const handleRun = async () => {
    const input = inputs[activeTool] ?? ''
    if (!input.trim()) return
    setLoading((prev) => ({ ...prev, [activeTool]: true }))
    setResults((prev) => ({ ...prev, [activeTool]: '' }))
    try {
      const result = await tool.call(input.trim())
      setResults((prev) => ({ ...prev, [activeTool]: resultToString(result) }))
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [activeTool]: `Error: ${e instanceof Error ? e.message : String(e)}`,
      }))
    } finally {
      setLoading((prev) => ({ ...prev, [activeTool]: false }))
    }
  }

  const isLoading = !!loading[activeTool]
  const result = results[activeTool] ?? ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tool tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.description}
            onClick={() => setActiveTool(t.id)}
            className={clsx(
              'px-2.5 py-0.5 text-xs font-mono rounded border transition-colors',
              activeTool === t.id
                ? 'bg-accent/20 border-accent text-accent'
                : 'bg-surface-3 border-border text-gray-500 hover:text-gray-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tool description */}
      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <p className="text-xs text-gray-600 font-mono">{tool.description}</p>
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <input
          value={inputs[activeTool] ?? ''}
          onChange={(e) => setInputs((prev) => ({ ...prev, [activeTool]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRun()
          }}
          placeholder={tool.placeholder}
          className={INPUT}
        />
        <button
          onClick={() => void handleRun()}
          disabled={isLoading || !(inputs[activeTool] ?? '').trim()}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors shrink-0',
            isLoading || !(inputs[activeTool] ?? '').trim()
              ? 'bg-surface-3 border-border text-gray-600'
              : 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20',
          )}
        >
          {isLoading ? <Loader2 size={11} className="animate-spin" /> : 'Run'}
        </button>
      </div>

      {/* Result */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center gap-1.5 text-gray-600 text-xs font-mono">
            <Loader2 size={11} className="animate-spin" />
            Running…
          </div>
        ) : result ? (
          <pre
            className={clsx(
              'text-xs font-mono whitespace-pre-wrap break-words leading-relaxed',
              result.startsWith('Error:') ? 'text-danger' : 'text-gray-300',
            )}
          >
            {result}
          </pre>
        ) : (
          <div className="text-xs text-gray-700 font-mono">
            Enter a value and press Run.
          </div>
        )}
      </div>
    </div>
  )
}
