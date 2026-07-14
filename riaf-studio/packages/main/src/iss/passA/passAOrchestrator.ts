// packages/main/src/iss/passA/passAOrchestrator.ts
import type Database from 'better-sqlite3'
import type { ISSPassProgress } from '@shared/index'
import { SymbolPromoter } from './symbolPromoter'
import { SemanticBootstrapper } from './semanticBootstrapper'
import { CallGraphBuilder } from './callGraphBuilder'
import { TestLinker } from './testLinker'
import { InterfaceLinker } from './interfaceLinker'

export class PassAOrchestrator {
  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
  ) {}

  async run(push: (p: ISSPassProgress) => void): Promise<void> {
    push({
      pass: 'A',
      stage: 'symbol_promotion',
      pct: 0,
      detail: 'Promoting symbols to graph nodes…',
    })
    const promoted = new SymbolPromoter(this.db).promote()
    push({
      pass: 'A',
      stage: 'symbol_promotion',
      pct: 100,
      detail: `${promoted} structural nodes created`,
    })

    push({
      pass: 'A',
      stage: 'semantic_bootstrap',
      pct: 0,
      detail: 'Deriving semantic layer…',
    })
    const { services, modules, extDeps } = new SemanticBootstrapper(this.db, this.root).bootstrap()
    push({
      pass: 'A',
      stage: 'semantic_bootstrap',
      pct: 100,
      detail: `${services} domain services · ${modules} modules · ${extDeps} ext deps`,
    })

    push({ pass: 'A', stage: 'call_graph', pct: 0, detail: 'Building call graph…' })
    const callEdges = new CallGraphBuilder(this.db).build((pct, detail) =>
      push({ pass: 'A', stage: 'call_graph', pct, detail }),
    )
    push({
      pass: 'A',
      stage: 'call_graph',
      pct: 100,
      detail: `${callEdges} CALLS edges created`,
    })

    push({ pass: 'A', stage: 'test_linkage', pct: 0, detail: 'Linking tests…' })
    const { testNodes, testEdges } = new TestLinker(this.db, this.root).link()
    push({
      pass: 'A',
      stage: 'test_linkage',
      pct: 100,
      detail: `${testNodes} test nodes · ${testEdges} edges`,
    })

    push({
      pass: 'A',
      stage: 'interface_edges',
      pct: 0,
      detail: 'Extracting interface edges…',
    })
    const ifaceEdges = new InterfaceLinker(this.db, this.root).link()
    push({
      pass: 'A',
      stage: 'interface_edges',
      pct: 100,
      detail: `${ifaceEdges} IMPLEMENTS_INTERFACE/INHERITS edges`,
    })
  }
}
