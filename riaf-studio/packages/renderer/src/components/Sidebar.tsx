import type { LucideIcon } from 'lucide-react'
import {
  FolderOpen,
  Database,
  Network,
  Search,
  Code2,
  Zap,
  Settings,
  GitBranch,
  ListChecks,
  Crosshair,
  Wrench,
  BookOpen,
  MessageSquare,
  TrendingUp,
  Package,
  BarChart2,
  Layers,
} from 'lucide-react'
import { clsx } from 'clsx'

export type PanelId =
  | 'workspace'
  | 'indexing'
  | 'ucg'
  | 'iss'
  | 'features'
  | 'po'
  | 'impact'
  | 'search'
  | 'symbols'
  | 'riaf'
  | 'settings'
  // AEP panels
  | 'domain'
  | 'valueStream'
  | 'signals'
  | 'businessValue'
  | 'consolidation'
  | 'outcomes'

type NavItem = {
  id: PanelId
  label: string
  Icon: LucideIcon
  dividerBefore?: boolean
}

const TOP_ITEMS: NavItem[] = [
  { id: 'workspace', label: 'Workspace', Icon: FolderOpen },
  { id: 'indexing', label: 'Indexing', Icon: Database },
  { id: 'ucg', label: 'UCG Graph', Icon: Network },
  { id: 'iss', label: 'ISS Graph', Icon: GitBranch },
  { id: 'features', label: 'Features', Icon: ListChecks },
  { id: 'po', label: 'PO Workbench', Icon: Wrench },
  { id: 'impact', label: 'Impact', Icon: Crosshair },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'symbols', label: 'Symbols', Icon: Code2 },
  { id: 'riaf', label: 'RIAF', Icon: Zap },
  // AEP section
  { id: 'domain', label: 'Domain', Icon: BookOpen, dividerBefore: true },
  { id: 'valueStream', label: 'Value Stream', Icon: Layers },
  { id: 'signals', label: 'Customer Signals', Icon: MessageSquare },
  { id: 'businessValue', label: 'Business Value', Icon: TrendingUp },
  { id: 'consolidation', label: 'Consolidation', Icon: Package },
  { id: 'outcomes', label: 'Outcomes', Icon: BarChart2 },
]
const BOTTOM_ITEMS: NavItem[] = [{ id: 'settings', label: 'Settings', Icon: Settings }]

type Props = {
  active: PanelId
  hasWorkspace: boolean
  onChange: (id: PanelId) => void
}

export function Sidebar({ active, hasWorkspace, onChange }: Props) {
  const renderItem = (item: NavItem) => {
    const isWorkspaceOrSettings = item.id === 'workspace' || item.id === 'settings'
    const disabled = !hasWorkspace && !isWorkspaceOrSettings

    return (
      <div key={item.id}>
        {item.dividerBefore && (
          <div className="w-6 h-px bg-border/60 my-1 mx-auto" />
        )}
        <button
          title={item.label}
          disabled={disabled}
          onClick={() => !disabled && onChange(item.id)}
          className={clsx(
            'flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
            active === item.id
              ? 'bg-accent/20 text-accent'
              : disabled
                ? 'text-gray-700 cursor-not-allowed'
                : 'text-gray-500 hover:text-gray-200 hover:bg-surface-3',
          )}
        >
          <item.Icon size={17} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center w-12 bg-surface border-r border-border py-2 gap-1 shrink-0">
      <div className="flex flex-col gap-1 flex-1">{TOP_ITEMS.map(renderItem)}</div>
      <div className="flex flex-col gap-1">{BOTTOM_ITEMS.map(renderItem)}</div>
    </div>
  )
}
