import { useEffect, useState, type ReactNode } from 'react'
import { WarningOctagon } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { GlassButton } from './primitives'

const STAGES = ['Ingesting media', 'Extracting frames', 'Analyzing signals', 'Correlating evidence', 'Building forensic graph']

/** The Rennaigan loading state: named forensic stages over a moving trace. */
export function ForensicLoader({ label, className, compact }: { label?: string; className?: string; compact?: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (label) return
    const t = setInterval(() => setI((n) => (n + 1) % STAGES.length), 900)
    return () => clearInterval(t)
  }, [label])
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center justify-center gap-4', compact ? 'py-8' : 'min-h-[42vh]', className)}>
      <div className="relative h-px w-44 overflow-hidden bg-white/10">
        <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" style={{ animation: 'trace 1.4s cubic-bezier(0.4,0,0.2,1) infinite' }} />
      </div>
      <p className="t-label text-fg-2">{label ?? STAGES[i]}</p>
    </div>
  )
}

interface EmptyProps { title: string; body: string; action?: ReactNode; icon?: ReactNode; className?: string }
export function EmptyState({ title, body, action, icon, className }: EmptyProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-14 text-center', className)}>
      {icon && <div className="mb-1 flex size-12 items-center justify-center rounded-[14px] border border-line bg-white/[0.03] text-fg-3">{icon}</div>}
      <h3 className="t-label text-fg">{title}</h3>
      <p className="t-meta max-w-[38ch] text-[0.875rem]">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

interface ErrorProps { title?: string; body: string; cause?: string; onRetry?: () => void; details?: string; className?: string; secondary?: ReactNode }
export function ErrorState({ title = 'Analysis interrupted', body, cause, onRetry, details, className, secondary }: ErrorProps) {
  const [open, setOpen] = useState(false)
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <div className="mb-1 flex size-12 items-center justify-center rounded-[14px] border border-danger/30 bg-danger/10 text-danger">
        <WarningOctagon size={22} weight="light" />
      </div>
      <h3 className="t-label text-fg">{title}</h3>
      <p className="max-w-[44ch] text-[0.875rem] text-fg-2">{body}</p>
      {cause && <p className="t-meta"><span className="text-fg-2">Possible cause:</span> {cause}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {onRetry && <GlassButton variant="primary" onClick={onRetry}>Retry</GlassButton>}
        {details && <GlassButton onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide details' : 'View details'}</GlassButton>}
        {secondary}
      </div>
      {open && details && <pre className="glass-inner t-mono mt-3 max-w-full overflow-x-auto whitespace-pre-wrap p-3 text-left text-xs text-fg-2">{details}</pre>}
    </div>
  )
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skeleton size-9 shrink-0" />
          <div className="skeleton h-3.5 flex-1" style={{ maxWidth: `${72 - i * 7}%` }} />
          <div className="skeleton h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}
