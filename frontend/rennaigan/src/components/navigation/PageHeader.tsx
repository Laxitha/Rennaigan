import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'

export interface Crumb { label: string; to?: string }

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-fg-3">
        {items.map((c, i) => (
          <li key={c.label} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={11} weight="light" aria-hidden />}
            {c.to ? <Link to={c.to} className="transition-colors hover:text-fg">{c.label}</Link> : <span aria-current="page" className="text-fg-2">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

interface HeaderProps { title: string; description?: string; crumbs?: Crumb[]; actions?: ReactNode; meta?: ReactNode; className?: string }

/** One header pattern for every console page: breadcrumbs, title, one line of context, actions on the right. */
export function PageHeader({ title, description, crumbs, actions, meta, className }: HeaderProps) {
  return (
    <header data-reveal className={cn('mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5', className)}>
      <div className="min-w-0">
        {crumbs && <Breadcrumbs items={crumbs} className="mb-3" />}
        <h1 className="t-title">{title}</h1>
        {description && <p className="t-body mt-2 text-[0.9375rem]">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
