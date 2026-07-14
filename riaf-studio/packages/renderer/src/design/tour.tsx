/**
 * First-run tour — 5 skippable stops. Replay from Settings later.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/design/primitives'

const STOPS: { title: string; body: string }[] = [
  {
    title: 'The Journey Bar',
    body: 'Six verbs track value from customer voice to lesson learned. Counts update live.',
  },
  {
    title: 'Journey Canvas',
    body: 'Open Journey to see initiatives moving left to right across Listen → Learn.',
  },
  {
    title: 'Feature Story',
    body: 'Click any card for the full narrative timeline — evidence at every step.',
  },
  {
    title: 'My Actions',
    body: 'When something needs a human decision, it lands here with a deep link.',
  },
  {
    title: 'Role selector',
    body: 'Pick your lens. Home and Actions adapt; nothing is locked away.',
  },
]

const TOUR_KEY = 'riaf.journey.tour.done'

export function FirstRunTour({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_KEY)) setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])

  function finish() {
    try {
      localStorage.setItem(TOUR_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  if (!open) return <>{children}</>

  const stop = STOPS[idx]!
  return (
    <>
      {children}
      <div className="fixed inset-0 z-[70] flex items-end justify-center p-6 pointer-events-none">
        <div className="pointer-events-auto bg-surface-2 border border-line shadow-pop rounded-[12px] p-5 max-w-md w-full">
          <p className="text-[11px] text-ink-3 uppercase tracking-wide mb-1">
            Tour {idx + 1}/{STOPS.length}
          </p>
          <p className="text-[15px] font-[600] text-ink-1">{stop.title}</p>
          <p className="text-[13px] text-ink-2 mt-2">{stop.body}</p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="ghost" onClick={finish}>
              Skip
            </Button>
            {idx < STOPS.length - 1 ? (
              <Button onClick={() => setIdx((i) => i + 1)}>Next</Button>
            ) : (
              <Button onClick={finish}>Done</Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export function resetTourFlag(): void {
  try {
    localStorage.removeItem(TOUR_KEY)
  } catch {
    /* ignore */
  }
}
