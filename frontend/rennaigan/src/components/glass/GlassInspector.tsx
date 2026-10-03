import { useState, type ReactNode } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'

export interface InspectorRow { label: string; value: ReactNode; mono?: boolean; copy?: string }

/** Key and value listing for file facts, hashes and evidence references. */
export function GlassInspector({ rows, className, dense }: { rows: InspectorRow[]; className?: string; dense?: boolean }) {
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-6', dense ? 'gap-y-2' : 'gap-y-3', className)}>
      {rows.map((r) => (
        <div key={r.label} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <dt className="t-label whitespace-nowrap">{r.label}</dt>
          <dd className={cn('flex min-w-0 items-center justify-end gap-2 text-right text-[0.8125rem] text-fg', r.mono && 't-mono')}>
            <span className="min-w-0 truncate">{r.value}</span>
            {r.copy && <CopyButton text={r.copy} label={r.label} />}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text) } catch { /* clipboard blocked: still acknowledge the attempt */ }
    setDone(true)
    setTimeout(() => setDone(false), 1400)
  }
  return (
    <button type="button" onClick={copy} aria-label={done ? `${label} copied` : `Copy ${label}`} className="shrink-0 text-fg-3 transition-colors hover:text-fg">
      {done ? <Check size={14} weight="light" className="text-ok" /> : <Copy size={14} weight="light" />}
    </button>
  )
}
