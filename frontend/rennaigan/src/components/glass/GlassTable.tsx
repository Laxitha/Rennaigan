import { useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from 'react'
import { cn } from '@/lib/cn'

export interface Column<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  /** CSS grid track, e.g. "minmax(0,2fr)" or "120px". */
  width: string
  align?: 'left' | 'right'
  /** Hide below this breakpoint to keep rows readable on small screens. */
  from?: 'sm' | 'md' | 'lg' | 'xl'
}

const FROM = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden' } as const

interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  caption: string
  empty?: ReactNode
}

/**
 * Table and list hybrid. Uses ARIA table roles over CSS grid so columns can
 * drop out responsively without horizontal scrolling.
 */
export function GlassTable<T>({ columns, rows, rowKey, onRowClick, rowLabel, caption, empty }: TableProps<T>) {
  // Hidden columns are display:none, so each breakpoint gets its own grid template of the visible tracks.
  const tiers = ['base', 'sm', 'md', 'lg', 'xl'] as const
  const vars = Object.fromEntries(
    tiers.map((tier, ti) => [
      `--cols-${tier}`,
      columns.filter((c) => !c.from || tiers.indexOf(c.from) <= ti).map((c) => c.width).join(' '),
    ]),
  )
  const onKey = (e: KeyboardEvent<HTMLDivElement>, row: T) => {
    if (!onRowClick) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) }
    if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus() }
    if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus() }
  }
  return (
    <div role="table" aria-label={caption} className="w-full" style={vars}>
      <div role="rowgroup">
        <div role="row" className="glass-table-row border-b border-line px-5 py-2.5">
          {columns.map((c) => (
            <span key={c.id} role="columnheader" className={cn('t-label', c.align === 'right' && 'text-right', c.from && FROM[c.from])}>{c.header}</span>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.length === 0 && empty}
        {rows.map((row) => (
          <div
            key={rowKey(row)} role="row" tabIndex={onRowClick ? 0 : undefined} aria-label={rowLabel?.(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={(e) => onKey(e, row)}
            className={cn('glass-table-row row-hover border-b border-line/60 px-5 py-3.5 last:border-b-0', onRowClick && 'cursor-pointer')}
          >
            {columns.map((c) => (
              <div key={c.id} role="cell" className={cn('min-w-0', c.align === 'right' && 'flex justify-end text-right', c.from && FROM[c.from])}>{c.cell(row)}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------ Virtual list ------------------------------ */

interface VirtualProps<T> { items: T[]; rowHeight: number; height: number; render: (item: T, index: number) => ReactNode; label: string; className?: string }

/** Fixed-height windowing for long evidence and frame lists. Renders only visible rows plus overscan. */
export function VirtualList<T>({ items, rowHeight, height, render, label, className }: VirtualProps<T>) {
  const [top, setTop] = useState(0)
  const raf = useRef(0)
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => setTop(y))
  }
  const overscan = 6
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan)
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan)
  return (
    <div role="list" aria-label={label} tabIndex={0} onScroll={onScroll} className={cn('overflow-y-auto', className)} style={{ height }}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * rowHeight}px)` }}>
          {items.slice(first, last).map((item, i) => (
            <div key={first + i} role="listitem" style={{ height: rowHeight }}>{render(item, first + i)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}
