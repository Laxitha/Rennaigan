import { useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { api } from '@/services/api'
import { useQuery } from '@/hooks/useQuery'
import { usePageReveal } from '@/animations/usePageReveal'
import { EmptyState, ErrorState, GlassButton, GlassInput, GlassPanel, GlassTabs, SkeletonRows } from '@/components/glass'
import { InvestigationTable } from '@/components/forensic/InvestigationTable'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { MediaType } from '@/types'

type Filter = 'all' | MediaType

export default function Investigations() {
  const scope = useRef<HTMLDivElement>(null)
  const { data, loading, error, retry } = useQuery(api.investigations, [])
  const [query, setQuery] = useState('')
  const [type, setType] = useState<Filter>('all')
  usePageReveal(scope, [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data ?? []).filter((r) => (type === 'all' || r.mediaType === type) && (!q || `${r.id} ${r.media} ${r.finding} ${r.analyst}`.toLowerCase().includes(q)))
  }, [data, query, type])

  const count = (t: Filter) => (data ?? []).filter((r) => t === 'all' || r.mediaType === t).length

  return (
    <div ref={scope}>
      <PageHeader
        title="Investigations" description="Every piece of media submitted for forensic analysis, newest first."
        actions={<GlassButton variant="primary" to="/analyze" icon={<Plus size={16} weight="light" />}>Start investigation</GlassButton>}
      />
      <div data-reveal className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <GlassTabs label="Filter by media type" value={type} onChange={setType} items={[
          { id: 'all', label: 'All', count: count('all') }, { id: 'video', label: 'Video', count: count('video') }, { id: 'audio', label: 'Audio', count: count('audio') },
          { id: 'image', label: 'Image', count: count('image') }, { id: 'screenshot', label: 'Screenshot', count: count('screenshot') },
        ]} />
        <GlassInput label="Search investigations" hideLabel placeholder="ID, file name, finding or analyst" value={query} onChange={(e) => setQuery(e.target.value)}
          leading={<MagnifyingGlass size={15} weight="light" />} className="w-full sm:w-72" type="search" />
      </div>
      <GlassPanel data-reveal level={1}>
        {loading ? <SkeletonRows rows={8} /> : error ? (
          <ErrorState title="Investigations unavailable" body="The list could not be loaded." cause="The data service did not respond." onRetry={retry} />
        ) : (
          <InvestigationTable rows={rows} caption="All investigations" empty={
            (data?.length ?? 0) === 0
              ? <EmptyState title="No investigations" body="Your forensic workspace is ready." action={<GlassButton variant="primary" to="/analyze">Start investigation</GlassButton>} />
              : <EmptyState title="No evidence found" body="No investigation matches this search and filter." action={<GlassButton onClick={() => { setQuery(''); setType('all') }}>Modify search</GlassButton>} />
          } />
        )}
      </GlassPanel>
      {!loading && !error && <p className="t-meta mt-3" aria-live="polite">{rows.length} of {data?.length ?? 0} investigations</p>}
    </div>
  )
}
