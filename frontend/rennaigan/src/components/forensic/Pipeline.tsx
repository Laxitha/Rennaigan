import { Check } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'

export type StepState = 'pending' | 'active' | 'done' | 'failed'
export interface PipelineStep { id: string; label: string; state: StepState; note?: string }

/**
 * Processing pipeline as connected nodes. Horizontal from md up, vertical below.
 * The active connector carries a moving trace; finished connectors hold the accent.
 */
export function Pipeline({ steps, className }: { steps: PipelineStep[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col md:flex-row', className)} aria-label="Processing pipeline">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={s.id} aria-current={s.state === 'active' ? 'step' : undefined}
            className="relative flex flex-1 items-start gap-4 pb-6 last:pb-0 md:flex-col md:items-center md:gap-3 md:pb-0 md:text-center">
            {!last && (
              <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-28px)] w-px overflow-hidden bg-white/10 md:left-[calc(50%+18px)] md:top-[13px] md:h-px md:w-[calc(100%-36px)]">
                <span className={cn('absolute inset-0 origin-top bg-accent transition-transform duration-700 ease-[var(--ease-out-expo)] md:origin-left',
                  s.state === 'done' ? 'scale-100' : 'scale-y-0 md:scale-x-0 md:scale-y-100')} />
                {s.state === 'active' && (
                  <span className="absolute inset-y-0 left-0 hidden w-1/3 bg-gradient-to-r from-transparent via-accent-2 to-transparent md:block" style={{ animation: 'trace 1.1s linear infinite' }} />
                )}
              </span>
            )}
            <span className={cn('relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] transition-[background-color,border-color,box-shadow,color] duration-500',
              s.state === 'done' && 'border-accent bg-accent/25 text-fg',
              s.state === 'active' && 'border-accent-2 bg-accent/15 text-fg shadow-[0_0_0_5px_rgb(255_77_148/0.12)]',
              s.state === 'pending' && 'border-line-2 bg-bg-2 text-fg-3',
              s.state === 'failed' && 'border-danger bg-danger/15 text-danger')}>
              {s.state === 'done' ? <Check size={13} weight="bold" /> : <span className="t-mono">{i + 1}</span>}
            </span>
            <span className="min-w-0 md:px-1">
              <span className={cn('t-label block transition-colors duration-300', s.state === 'pending' ? 'text-fg-3' : 'text-fg')}>{s.label}</span>
              {s.note && <span className="t-mono mt-1 block text-[0.6875rem] text-fg-3">{s.note}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
