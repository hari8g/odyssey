import { useCallback, useEffect, useState } from 'react'
import ReactFlow, {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  MarkerType,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import { clsx } from 'clsx'
import type { UCGFileNode, UCGGraphData } from '@shared'

const ARCH_LAYER_COLORS: Record<string, string> = {
  entry: '#7c6aff',
  service: '#10b981',
  util: '#f59e0b',
  config: '#6b7280',
  test: '#3b82f6',
  ui: '#ec4899',
  api: '#f97316',
  unknown: '#4b5563',
}

function getLayerColor(layer: string): string {
  return ARCH_LAYER_COLORS[layer.toLowerCase()] ?? ARCH_LAYER_COLORS['unknown']!
}

const NODE_W = 180
const NODE_H = 40

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 80 })
  for (const node of nodes) g.setNode(node.id, { width: NODE_W, height: NODE_H })
  for (const edge of edges) g.setEdge(edge.source, edge.target)
  dagre.layout(g)
  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } }
    }),
    edges,
  }
}

type NodeData = {
  label: string
  fullPath: string
  archLayer: string
  importCount: number
  importedByCount: number
}

function ucgToFlow(
  gd: UCGGraphData,
  layerFilter: string | null,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const filtered = layerFilter
    ? gd.nodes.filter((n) => n.archLayer.toLowerCase() === layerFilter)
    : gd.nodes

  const nodeIds = new Set(filtered.map((n) => String(n.id)))

  const nodes: Node<NodeData>[] = filtered.map((n) => ({
    id: String(n.id),
    data: {
      label: n.filePath.split('/').pop() ?? n.filePath,
      fullPath: n.filePath,
      archLayer: n.archLayer,
      importCount: n.importCount,
      importedByCount: n.importedByCount,
    },
    position: { x: 0, y: 0 },
    style: {
      background: '#1c1c23',
      border: `1px solid ${getLayerColor(n.archLayer)}`,
      borderRadius: 4,
      color: '#e5e7eb',
      fontSize: 11,
      fontFamily: 'JetBrains Mono, monospace',
      padding: '5px 10px',
      width: NODE_W,
    },
  }))

  const pathToId = new Map(gd.nodes.map((n) => [n.filePath, String(n.id)]))

  const edges: Edge[] = gd.edges
    .filter((e) => {
      if (!e.resolvedFile) return false
      const from = pathToId.get(e.fromFile)
      const to = pathToId.get(e.resolvedFile)
      return from !== undefined && to !== undefined && nodeIds.has(from) && nodeIds.has(to)
    })
    .map((e) => {
      const from = pathToId.get(e.fromFile) ?? ''
      const to = pathToId.get(e.resolvedFile ?? '') ?? ''
      return {
        id: String(e.id),
        source: from,
        target: to,
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#3a3a48' },
        style: { stroke: '#2a2a35', strokeWidth: 1 },
      }
    })
    .filter((e) => e.source && e.target)

  return { nodes, edges }
}

const ARCH_LAYERS = ['entry', 'service', 'util', 'config', 'test', 'ui', 'api']

function GraphInner() {
  const [graphData, setGraphData] = useState<UCGGraphData | null>(null)
  const [layerFilter, setLayerFilter] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<UCGFileNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  const loadGraph = useCallback(
    async (filter: string | null) => {
      setLoading(true)
      try {
        const raw = await window.electronAPI.getUCGGraph()
        if ('error' in raw) return
        setGraphData(raw)
        const { nodes: rn, edges: re } = ucgToFlow(raw, filter)
        if (rn.length === 0) {
          setNodes([])
          setEdges([])
          return
        }
        try {
          const { nodes: ln, edges: le } = layoutGraph(rn as Node[], re)
          setNodes(ln as Node<NodeData>[])
          setEdges(le)
        } catch {
          const grid = rn.map((n, i) => ({
            ...n,
            position: { x: (i % 8) * (NODE_W + 20), y: Math.floor(i / 8) * (NODE_H + 20) },
          }))
          setNodes(grid)
          setEdges(re)
        }
      } finally {
        setLoading(false)
      }
    },
    [setNodes, setEdges],
  )

  useEffect(() => {
    loadGraph(layerFilter)
  }, [layerFilter, loadGraph])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<NodeData>) => {
      if (!graphData) return
      const found = graphData.nodes.find((n) => String(n.id) === node.id)
      setSelectedNode(found ?? null)
    },
    [graphData],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <span className="text-xs text-gray-600">Layer:</span>
        <button
          onClick={() => setLayerFilter(null)}
          className={clsx(
            'text-xs px-2 py-0.5 rounded font-mono transition-colors',
            layerFilter === null ? 'bg-accent text-white' : 'bg-surface-3 text-gray-400 hover:text-gray-200',
          )}
        >
          all
        </button>
        {ARCH_LAYERS.map((layer) => (
          <button
            key={layer}
            onClick={() => setLayerFilter(layer === layerFilter ? null : layer)}
            className="text-xs px-2 py-0.5 rounded font-mono transition-colors"
            style={
              layerFilter === layer
                ? { background: getLayerColor(layer), color: '#fff' }
                : { background: '#1c1c23', color: '#9ca3af' }
            }
          >
            {layer}
          </button>
        ))}
        <button
          onClick={() => loadGraph(layerFilter)}
          className="ml-auto text-xs px-2 py-0.5 rounded font-mono bg-surface-3 text-gray-500 hover:text-gray-200 transition-colors"
        >
          ↺ Reload
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
              Loading graph…
            </div>
          ) : nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs font-mono">
              No graph data — run indexing first.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              fitView
              minZoom={0.05}
              maxZoom={2}
              style={{ background: '#0d0d0f' }}
            >
              <Background color="#2a2a35" gap={16} variant={BackgroundVariant.Dots} />
              <Controls
                style={{ background: '#141418', border: '1px solid #2a2a35', borderRadius: 4 }}
              />
              <MiniMap
                style={{ background: '#141418', border: '1px solid #2a2a35', borderRadius: 4 }}
                nodeColor={(n: Node<NodeData>) => getLayerColor(n.data?.archLayer ?? 'unknown')}
              />
            </ReactFlow>
          )}
        </div>

        {selectedNode && (
          <div className="w-56 border-l border-border bg-surface-2 p-3 overflow-y-auto shrink-0 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-300 font-mono">Detail</span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-xs text-gray-600 hover:text-gray-400 font-mono"
              >
                ×
              </button>
            </div>
            <p className="text-xs font-mono text-gray-300 break-all">{selectedNode.filePath}</p>
            <div className="flex flex-wrap gap-1.5">
              <span
                className="px-1.5 py-0.5 rounded text-white text-xs font-mono"
                style={{ background: getLayerColor(selectedNode.archLayer) }}
              >
                {selectedNode.archLayer}
              </span>
              {selectedNode.isEntryPoint && (
                <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent text-xs font-mono">
                  entry
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              <span className="text-gray-600">language</span>
              <span className="font-mono text-gray-300">{selectedNode.language}</span>
              <span className="text-gray-600">imports</span>
              <span className="font-mono text-gray-300">{selectedNode.importCount}</span>
              <span className="text-gray-600">imported by</span>
              <span className="font-mono text-gray-300">{selectedNode.importedByCount}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function UCGGraphPanel() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  )
}
