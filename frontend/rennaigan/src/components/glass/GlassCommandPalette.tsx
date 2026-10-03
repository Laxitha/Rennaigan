import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import { GlassModal } from './overlays'

export interface Command { id: string; label: string; group: string; hint?: string; keywords?: string; icon?: ReactNode; run: () => void }

interface PaletteProps { open: boolean; onClose: () => void; commands: Command[] }

export function GlassCommandPalette({ open, onClose, commands }: PaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQuery(''); setActive(0) } }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    const terms = q.split(/\s+/)
    return commands.filter((c) => {
      const hay = `${c.label} ${c.group} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [query, commands])

  useEffect(() => { setActive(0) }, [query])

  // Results arrive progressively: a short stagger each time the result set changes.
  useGSAP(() => {
    if (!open || !list.current) return
    fromToSafe(list.current.querySelectorAll('[data-cmd]'), { autoAlpha: 0, y: dist(6) },
      { autoAlpha: 1, y: 0, duration: d(0.22), ease: EASE.out, stagger: 0.018, overwrite: true })
  }, [open, results])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (c: Command | undefined) => { if (!c) return; onClose(); c.run() }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]) }
  }

  let lastGroup = ''
  return (
    <GlassModal open={open} onClose={onClose} title="Command palette" width={600} bare>
      <div className="flex items-center gap-3 border-b border-line px-5">
        <MagnifyingGlass size={18} weight="light" className="shrink-0 text-fg-3" />
        <input
          data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder="Search commands, cases and evidence" aria-label="Search commands, cases and evidence"
          role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-fg outline-none placeholder:text-fg-3"
        />
        <span className="kbd">Esc</span>
      </div>
      <div ref={list} id="cmd-list" role="listbox" aria-label="Commands" className="max-h-[min(52vh,420px)] overflow-y-auto p-2">
        {results.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="t-label text-fg">No evidence found</p>
            <p className="t-meta mt-2">No matching command or evidence for "{query}". Try an investigation ID or a file name.</p>
          </div>
        )}
        {results.map((c, i) => {
          const header = c.group !== lastGroup
          lastGroup = c.group
          return (
            <div key={c.id}>
              {header && <p className="t-label px-3 pb-1.5 pt-3">{c.group}</p>}
              <button
                type="button" id={`cmd-${c.id}`} data-cmd data-index={i} role="option" aria-selected={i === active} tabIndex={-1}
                onMouseMove={() => setActive(i)} onClick={() => run(c)}
                className={cn('flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors', i === active ? 'bg-accent/[0.13] text-fg' : 'text-fg-2')}
              >
                <span className={cn('shrink-0', i === active ? 'text-accent-2' : 'text-fg-3')}>{c.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[0.875rem]">{c.label}</span>
                {c.hint && <span className="t-mono shrink-0 text-xs text-fg-3">{c.hint}</span>}
              </button>
            </div>
          )
        })}
      </div>
      <footer className="flex items-center gap-4 border-t border-line px-5 py-3 text-xs text-fg-3">
        <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> Navigate</span>
        <span className="flex items-center gap-1.5"><span className="kbd">Enter</span> Open</span>
      </footer>
    </GlassModal>
  )
}
