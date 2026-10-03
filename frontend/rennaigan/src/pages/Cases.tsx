import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CaretDown, CaretLeft, CaretRight, MagnifyingGlass } from '@phosphor-icons/react'
import { api } from '@/services/api'
import { useQuery } from '@/hooks/useQuery'
import { usePageReveal } from '@/animations/usePageReveal'
import { revealIn, useGSAP } from '@/lib/motion'
import { fmtDate } from '@/lib/format'
import { EmptyState, ErrorState, ForensicLoader, GlassButton, GlassInput, GlassPanel, GlassTabs } from '@/components/glass'
import { CoverageBar, MediaGlyph, StatusBadge } from '@/components/forensic/meta'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { CaseStatus, Investigation } from '@/types'

type Filter = 'all' | Exclude<CaseStatus, 'processing'>
type Sort = 'newest' | 'oldest' | 'confidence' | 'coverage'
const PER_PAGE = 9
const SORTS: Record<Sort, { label: string; fn: (a: Investigation, b: Investigation) => number }> = {
  newest: { label: 'Newest first', fn: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  oldest: { label: 'Oldest first', fn: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  confidence: { label: 'Highest confidence', fn: (a, b) => b.confidence - a.confidence },
  coverage: { label: 'Lowest evidence coverage', fn: (a, b) => a.coverage - b.coverage },
}

function CaseCard({ c }: { c: Investigation }) {
  return (
    <li data-case>
      <Link to={`/analysis/${c.id}`} data-level="2" className="glass glass-hover flex h-full flex-col p-5" aria-label={`Open case ${c.id}, ${c.media}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <MediaGlyph type={c.mediaType} />
            <div className="min-w-0">
              <p className="t-mono text-accent-2">{c.id}</p>
              <p className="truncate text-sm font-[520] text-fg">{c.media}</p>
            </div>
          </div>
          <StatusBadge status={c.status} />
        </div>
        <p className="mt-4 line-clamp-2 min-h-[2.6em] text-[0.8125rem] leading-snug text-fg-2">{c.finding}</p>
        <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-[0.8125rem]">
          <div><dt className="t-label">Confidence</dt><dd className="t-mono mt-1 text-fg">{c.confidence}%</dd></div>
          <div><dt className="t-label">Coverage</dt><dd className="mt-1"><CoverageBar value={c.coverage} /></dd></div>
          <div><dt className="t-label">Created</dt><dd className="mt-1 text-fg-2">{fmtDate(c.createdAt)}</dd></div>
          <div className="min-w-0"><dt className="t-label">Analyst</dt><dd className="mt-1 truncate text-fg-2">{c.analyst}</dd></div>
        </dl>
      </Link>
    </li>
  )
}

export default function Cases() {
  const scope = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLUListElement>(null)
  const sortId = useId()
  const { data, loading, error, retry } = useQuery(api.investigations, [])
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  usePageReveal(scope, [])

  const all = data ?? []
  const count = (f: Filter) => all.filter((c) => f === 'all' || c.status === f).length
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((c) => (filter === 'all' || c.status === filter) && (!q || `${c.id} ${c.media} ${c.finding} ${c.analyst}`.toLowerCase().includes(q)))
      .sort(SORTS[sort].fn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, sort, query])

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)
  useEffect(() => { setPage(1) }, [filter, sort, query])

  useGSAP(() => {
    const cards = grid.current?.querySelectorAll('[data-case]')
    if (cards?.length) revealIn(cards, { duration: 0.4, stagger: 0.03 })
  }, { dependencies: [filter, sort, query, current, loading], scope: grid })

  return (
    <div ref={scope}>
      <PageHeader title="Cases" description="Manage investigations by status. Open a case to continue the analysis where it stopped." />
      <div data-reveal className="mb-5 flex flex-wrap items-center gap-3">
        <GlassTabs label="Filter by status" value={filter} onChange={setFilter} items={[
          { id: 'all', label: 'All', count: count('all') }, { id: 'active', label: 'Active', count: count('active') }, { id: 'review', label: 'Review', count: count('review') },
          { id: 'verified', label: 'Verified', count: count('verified') }, { id: 'inconclusive', label: 'Inconclusive', count: count('inconclusive') }, { id: 'archived', label: 'Archived', count: count('archived') },
        ]} />
        <div className="ml-auto flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <GlassInput label="Search cases" hideLabel type="search" placeholder="Search cases" value={query} onChange={(e) => setQuery(e.target.value)}
            leading={<MagnifyingGlass size={15} weight="light" />} className="min-w-0 flex-1 sm:w-60 sm:flex-none" />
          <div className="relative">
            <label htmlFor={sortId} className="sr-only">Sort cases</label>
            <select id={sortId} className="field w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(Object.keys(SORTS) as Sort[]).map((s) => <option key={s} value={s}>{SORTS[s].label}</option>)}
            </select>
            <CaretDown size={13} weight="light" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
          </div>
        </div>
      </div>

      {loading ? <ForensicLoader label="Loading cases" /> : error ? (
        <GlassPanel><ErrorState title="Cases unavailable" body="The case list could not be loaded." cause="The data service did not respond." onRetry={retry} /></GlassPanel>
      ) : visible.length === 0 ? (
        <GlassPanel level={1}>
          {filter === 'review' && !query
            ? <EmptyState title="No review cases" body="All current investigations have been reviewed." />
            : <EmptyState title="No evidence found" body="No case matches this search and filter." action={<GlassButton onClick={() => { setQuery(''); setFilter('all') }}>Modify search</GlassButton>} />}
        </GlassPanel>
      ) : (
        <>
          <ul ref={grid} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => <CaseCard key={c.id} c={c} />)}
          </ul>
          <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4">
            <p className="t-meta" aria-live="polite">Showing {(current - 1) * PER_PAGE + 1} to {Math.min(current * PER_PAGE, filtered.length)} of {filtered.length}</p>
            <div className="flex items-center gap-2">
              <GlassButton size="sm" iconOnly aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)} icon={<CaretLeft size={14} weight="light" />} />
              <span className="t-mono px-1 text-fg-2">{current} / {pages}</span>
              <GlassButton size="sm" iconOnly aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)} icon={<CaretRight size={14} weight="light" />} />
            </div>
          </nav>
        </>
      )}
    </div>
  )
}
