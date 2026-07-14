import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// GraphAnalyzer
// ---------------------------------------------------------------------------

type EdgeRow = {
  from_file: string
  resolved_file: string | null
  is_external: number
}

type NodeRow = {
  file_path: string
  import_count: number
  imported_by_count: number
}

export class GraphAnalyzer {
  private readonly db: Database.Database

  constructor(db: Database.Database) {
    this.db = db
  }

  analyze(): void {
    const edges = this.db
      .prepare<[], EdgeRow>('SELECT from_file, resolved_file, is_external FROM ucg_import_edges')
      .all()

    // -----------------------------------------------------------------------
    // 1. Build adjacency lists for internal edges
    // -----------------------------------------------------------------------
    const adjacency = new Map<string, string[]>()
    const fanIn = new Map<string, number>()  // imported_by_count
    const fanOut = new Map<string, number>() // import_count

    for (const edge of edges) {
      if (!adjacency.has(edge.from_file)) adjacency.set(edge.from_file, [])
      if (edge.is_external === 0 && edge.resolved_file) {
        adjacency.get(edge.from_file)!.push(edge.resolved_file)
        fanIn.set(edge.resolved_file, (fanIn.get(edge.resolved_file) ?? 0) + 1)
      }
      fanOut.set(edge.from_file, (fanOut.get(edge.from_file) ?? 0) + 1)
    }

    // Ensure all destination nodes are in the adjacency map too
    for (const edge of edges) {
      if (edge.resolved_file && !adjacency.has(edge.resolved_file)) {
        adjacency.set(edge.resolved_file, [])
      }
    }

    // -----------------------------------------------------------------------
    // 2. Update import_count / imported_by_count on ucg_file_nodes
    // -----------------------------------------------------------------------
    const updateCounts = this.db.prepare(`
      UPDATE ucg_file_nodes
      SET import_count      = ?,
          imported_by_count = ?
      WHERE file_path = ?
    `)

    const allNodes = this.db
      .prepare<[], NodeRow>('SELECT file_path, import_count, imported_by_count FROM ucg_file_nodes')
      .all()

    const updateAll = this.db.transaction(() => {
      for (const n of allNodes) {
        updateCounts.run(
          fanOut.get(n.file_path) ?? 0,
          fanIn.get(n.file_path) ?? 0,
          n.file_path,
        )
      }
    })
    updateAll()

    // -----------------------------------------------------------------------
    // 3. Tarjan SCC (iterative) — detect cycles
    // -----------------------------------------------------------------------
    const cycles = tarjanIterativeSCC(adjacency)

    // -----------------------------------------------------------------------
    // 4. Hot files — top 20 by fan-in
    // -----------------------------------------------------------------------
    const hotFiles = [...fanIn.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([file]) => file)

    // -----------------------------------------------------------------------
    // 5. External deps — count per package name
    // -----------------------------------------------------------------------
    type ExtRow = { to_module: string }
    const externalEdges = this.db
      .prepare<[], ExtRow>(
        'SELECT to_module FROM ucg_import_edges WHERE is_external = 1',
      )
      .all()

    const externalDeps: Record<string, number> = {}
    for (const { to_module } of externalEdges) {
      const pkg = packageName(to_module)
      externalDeps[pkg] = (externalDeps[pkg] ?? 0) + 1
    }

    // -----------------------------------------------------------------------
    // 6. Aggregate totals
    // -----------------------------------------------------------------------
    type CountRow = { n: number }
    const totalNodes =
      (this.db.prepare<[], CountRow>('SELECT COUNT(*) AS n FROM ucg_file_nodes').get()?.n) ?? 0
    const totalEdges =
      (this.db.prepare<[], CountRow>('SELECT COUNT(*) AS n FROM ucg_import_edges').get()?.n) ?? 0
    const entryCount =
      (this.db
        .prepare<[], CountRow>('SELECT COUNT(*) AS n FROM ucg_file_nodes WHERE is_entry_point = 1')
        .get()?.n) ?? 0

    // -----------------------------------------------------------------------
    // 7. Upsert singleton metrics row
    // -----------------------------------------------------------------------
    this.db
      .prepare(`
        INSERT INTO ucg_graph_metrics
          (id, total_nodes, total_edges, entry_count, cycle_count, cycles_json, hot_files_json, external_deps_json, computed_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          total_nodes        = excluded.total_nodes,
          total_edges        = excluded.total_edges,
          entry_count        = excluded.entry_count,
          cycle_count        = excluded.cycle_count,
          cycles_json        = excluded.cycles_json,
          hot_files_json     = excluded.hot_files_json,
          external_deps_json = excluded.external_deps_json,
          computed_at        = excluded.computed_at
      `)
      .run(
        totalNodes,
        totalEdges,
        entryCount,
        cycles.length,
        JSON.stringify(cycles),
        JSON.stringify(hotFiles),
        JSON.stringify(externalDeps),
        Date.now(),
      )
  }
}

// ---------------------------------------------------------------------------
// Tarjan SCC — iterative implementation
// ---------------------------------------------------------------------------

function tarjanIterativeSCC(adjacency: Map<string, string[]>): string[][] {
  const index = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const sccStack: string[] = []
  let counter = 0
  const sccs: string[][] = []

  type Frame = {
    node: string
    neighborIdx: number
  }

  for (const startNode of adjacency.keys()) {
    if (index.has(startNode)) continue

    const callStack: Frame[] = []

    // Initialise the start node
    index.set(startNode, counter)
    lowlink.set(startNode, counter)
    counter++
    onStack.add(startNode)
    sccStack.push(startNode)
    callStack.push({ node: startNode, neighborIdx: 0 })

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!
      const { node } = frame
      const neighbors = adjacency.get(node) ?? []

      if (frame.neighborIdx < neighbors.length) {
        const neighbor = neighbors[frame.neighborIdx]!
        frame.neighborIdx++

        if (!index.has(neighbor)) {
          // Tree edge — DFS into neighbor
          index.set(neighbor, counter)
          lowlink.set(neighbor, counter)
          counter++
          onStack.add(neighbor)
          sccStack.push(neighbor)
          callStack.push({ node: neighbor, neighborIdx: 0 })
        } else if (onStack.has(neighbor)) {
          // Back/cross edge on the stack — update current node's lowlink
          // Use index[neighbor] (classical Tarjan) to stay correct
          lowlink.set(node, Math.min(lowlink.get(node)!, index.get(neighbor)!))
        }
      } else {
        // All neighbors processed — pop this frame
        callStack.pop()

        if (callStack.length > 0) {
          // Propagate lowlink to parent (return-from-recursion step)
          const parentFrame = callStack[callStack.length - 1]!
          const parent = parentFrame.node
          lowlink.set(parent, Math.min(lowlink.get(parent)!, lowlink.get(node)!))
        }

        // Check if this node is the root of an SCC
        if (lowlink.get(node) === index.get(node)) {
          const scc: string[] = []
          while (true) {
            const w = sccStack.pop()!
            onStack.delete(w)
            scc.push(w)
            if (w === node) break
          }

          // Only report cycles: SCCs with >1 node, or self-loops
          const hasSelfLoop =
            scc.length === 1 && (adjacency.get(scc[0]!) ?? []).includes(scc[0]!)
          if (scc.length > 1 || hasSelfLoop) {
            sccs.push(scc)
          }
        }
      }
    }
  }

  return sccs
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the npm/pip/etc. package name from a module specifier.
 * e.g. "@scope/pkg/sub" -> "@scope/pkg"
 *      "lodash/fp"       -> "lodash"
 *      "node:fs"         -> "node:fs"
 */
function packageName(module: string): string {
  if (module.startsWith('node:')) return module
  if (module.startsWith('@')) {
    // Scoped package: @scope/name
    const parts = module.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : module
  }
  return module.split('/')[0] ?? module
}
