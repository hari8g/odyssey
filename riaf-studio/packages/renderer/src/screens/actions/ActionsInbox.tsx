import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/design/primitives'
import { useUXStore } from '@/store/ux/ux.store'

export function ActionsInbox() {
  const navigate = useNavigate()
  const { actions, refreshActions } = useUXStore()

  useEffect(() => {
    void refreshActions()
  }, [refreshActions])

  const VERB_MAP: Record<string, string> = {
    SIGN: 'text-warn',
    DECIDE: 'text-decide',
    FIX: 'text-danger',
    REVIEW: 'text-info',
    START: 'text-ok',
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-line flex-shrink-0">
        <p className="text-[15px] font-[600] text-ink-1">My actions</p>
        <p className="text-[12px] text-ink-3 mt-0.5">
          {actions.length} item{actions.length === 1 ? '' : 's'} need attention
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {actions.length === 0 ? (
          <EmptyState
            verb="DECIDE"
            title="No actions right now"
            body="When decisions or fixes are needed, they appear here."
          />
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {actions.map((item) => (
              <div key={item.id} className="flex items-center gap-4 py-4">
                <span
                  className={`text-[12px] font-[700] w-14 flex-shrink-0 ${VERB_MAP[item.verb] ?? 'text-ink-3'}`}
                >
                  {item.verb}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-[500] text-ink-1">{item.title}</p>
                  <p className="text-[12px] text-ink-3 mt-0.5">{item.sub}</p>
                </div>
                <span className="text-[11px] text-ink-3 flex-shrink-0">{item.age}</span>
                <button
                  type="button"
                  onClick={() => navigate(item.route)}
                  className="text-[12px] text-accent hover:text-accent-hover font-[500] flex-shrink-0 whitespace-nowrap"
                >
                  {item.actionLabel} →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
