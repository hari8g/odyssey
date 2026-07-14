import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import type { GraphNode, GraphEdge, GraphNodeKind } from '@shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const eAPI = window.electronAPI as any

type NodeKindStats = {
  kind: GraphNodeKind
  count: number
  nodes: GraphNode[]
}

type EdgeKindStats = {
  kind: string
  count: number
}

const KIND_COLOR: Record<string, string> = {
  EPIC: '#7c6aff',
  FEATURE: '#10b981',
  USER_STORY: '#3b82f6',
  ACCEPTANCE_CRITERION: '#06b6d4',
  API_CONTRACT: '#f97316',
  DOMAIN_SERVICE: '#8b5cf6',
  MODULE: '#f59e0b',
  DATA_FLOW: '#ec4899',
  EXTERNAL_DEPENDENCY: '#6b7280',
  CLASS: '#84cc16',
  FUNCTION: '#14b8a6',
  INTERFACE: '#a78bfa',
  TYPE: '#fb923c',
  ENUM: '#fbbf24',
  TEST_SUITE: '#34d399',
  TEST_CASE: '#6ee7b7',
  MIGRATION: '#94a3b8',
  CONFIG: '#9ca3af',
  DEPLOYMENT_UNIT: '#f87171',
}

function groupByKind(nodes: GraphNode[]): NodeKindStats[] {
  const map = new Map<GraphNodeKind, GraphNode[]>()
  for (const n of nodes) {
    const arr = map.get(n.kind) ?? []
    arr.push(n)
    map.set(n.kind, arr)
  }
  return Array.from(map.entries())
    .map(([kind, ns]) => ({ kind, count: ns.length, nodes: ns }))
    .sort((a, b) => b.count - a.count)
}

function groupEdgesByKind(edges: GraphEdge[]): EdgeKindStats[] {
  const map = new Map<string, number>()
  for (const e of edges) {
    map.set(e.kind, (map.get(e.kind) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
}

export function ISSGraphPanel() {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'nodes' | 'edges'>('nodes')
  const [expandedKind, setExpandedKind] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ns, es] = await Promise.all([
        eAPI.getISSGraphNodes() as Promise<GraphNode[]>,
        eAPI.getISSGraphEdges() as Promise<GraphEdge[]>,
      ])
      setNodes(Array.isArray(ns) ? ns : [])
      setEdges(Array.isArray(es) ? es : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const nodeGroups = groupByKind(nodes)
  const edgeGroups = groupEdgesByKind(edges)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0">
        <button
          onClick={() => setTab('nodes')}
          className={clsx(
            'px-2.5 py-0.5 text-xs font-mono rounded border transition-colors',
            tab === 'nodes'
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-surface-3 border-border text-gray-500 hover:text-gray-200',
          )}
        >
          Nodes ({nodes.length})
        </button>
        <button
          onClick={() => setTab('edges')}
          className={clsx(
            'px-2.5 py-0.5 text-xs font-mono rounded border transition-colors',
            tab === 'edges'
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-surface-3 border-border text-gray-500 hover:text-gray-200',
          )}
        >
          Edges ({edges.length})
        </button>
        <button
          onClick={() => void load()}
          className="ml-auto text-xs px-2 py-0.5 rounded font-mono bg-surface-3 border border-border text-gray-500 hover:text-gray-200 transition-colors"
        >
          ↺ Reload
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-gray-600 text-xs font-mono">
            Loading…
          </div>
        ) : error ? (
          <div className="text-xs text-danger font-mono px-1">{error}</div>
        ) : tab === 'nodes' ? (
          nodeGroups.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-gray-600 text-xs font-mono">
              No graph nodes — run indexing and ISS passes.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {nodeGroups.map(({ kind, count, nodes: kindNodes }) => (
                <div key={kind}>
                  <button
                    onClick={() => setExpandedKind(expandedKind === kind ? null : kind)}
                    className="flex items-center gap-2 w-full py-1 hover:bg-surface-3 rounded px-1 transition-colors group"
                  >
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ background: KIND_COLOR[kind] ?? '#4b5563' }}
                    />
                    <span className="flex-1 text-xs font-mono text-gray-300 text-left">{kind}</span>
                    <span className="text-xs font-mono text-gray-600">{count}</span>
                    <span className="text-xs text-gray-700 group-hover:text-gray-500 transition-colors">
                      {expandedKind === kind ? '▲' : '▼'}
                    </span>
                  </button>
                  {expandedKind === kind && (
                    <div className="ml-4 flex flex-col gap-0.5 mt-0.5 mb-1">
                      {kindNodes.slice(0, 50).map((n) => (
                        <div
                          key={n.id}
                          className="flex items-start gap-2 py-0.5 px-1 rounded hover:bg-surface-3 transition-colors"
                        >
                          <span className="text-xs font-mono text-gray-300 truncate flex-1">
                            {n.label}
                          </span>
                          {n.sdlcPhase && (
                            <span className="text-xs font-mono text-gray-600 shrink-0">
                              {n.sdlcPhase}
                            </span>
                          )}
                          {n.importanceScore > 0 && (
                            <span className="text-xs font-mono text-gray-700 shrink-0">
                              {n.importanceScore.toFixed(2)}
                            </span>
                          )}
                        </div>
                      ))}
                      {kindNodes.length > 50 && (
                        <span className="text-xs text-gray-600 font-mono px-1">
                          …and {kindNodes.length - 50} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : edgeGroups.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-gray-600 text-xs font-mono">
            No edges yet.
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {edgeGroups.map(({ kind, count }) => (
              <div key={kind} className="flex items-center gap-2 py-1 px-1">
                <span className="flex-1 text-xs font-mono text-gray-400">{kind}</span>
                <div className="h-1 w-24 bg-surface-3 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent/50 rounded-full"
                    style={{
                      width: `${Math.min(100, (count / (edgeGroups[0]?.count ?? 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-600 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
