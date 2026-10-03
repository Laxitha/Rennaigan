import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import { GlassTable, type Column } from '@/components/glass'
import { fmtDate, fmtTime } from '@/lib/format'
import type { Investigation } from '@/types'
import { CoverageBar, MediaGlyph, StatusBadge } from './meta'

export function InvestigationTable({ rows, caption, empty }: { rows: Investigation[]; caption: string; empty?: ReactNode }) {
  const navigate = useNavigate()
  const columns = useMemo<Column<Investigation>[]>(() => [
    {
      id: 'media', header: 'Media', width: 'minmax(0,1.5fr)',
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <MediaGlyph type={r.mediaType} />
          <div className="min-w-0">
            <p className="truncate text-sm font-[520] text-fg">{r.media}</p>
            <p className="t-meta truncate">{r.format}</p>
          </div>
        </div>
      ),
    },
    { id: 'id', header: 'Investigation', width: '128px', from: 'md', cell: (r) => <span className="t-mono text-fg-2">{r.id}</span> },
    {
      id: 'time', header: 'Opened', width: '120px', from: 'xl',
      cell: (r) => <div><p className="text-[0.8125rem] text-fg-2">{fmtDate(r.createdAt)}</p><p className="t-mono text-[0.6875rem] text-fg-3">{fmtTime(r.createdAt)}</p></div>,
    },
    { id: 'finding', header: 'Primary finding', width: 'minmax(0,1.6fr)', from: 'lg', cell: (r) => <p className="truncate text-[0.8125rem] text-fg-2">{r.finding}</p> },
    { id: 'coverage', header: 'Evidence coverage', width: '132px', from: 'sm', cell: (r) => <CoverageBar value={r.coverage} /> },
    { id: 'status', header: 'Status', width: '136px', cell: (r) => <StatusBadge status={r.status} /> },
    { id: 'action', header: '', width: '28px', align: 'right', from: 'sm', cell: () => <ArrowRight size={16} weight="light" className="text-fg-3" aria-hidden /> },
  ], [])
  return (
    <GlassTable
      caption={caption} columns={columns} rows={rows} rowKey={(r) => r.id} empty={empty}
      rowLabel={(r) => `Open investigation ${r.id}, ${r.media}`} onRowClick={(r) => navigate(`/analysis/${r.id}`)}
    />
  )
}
