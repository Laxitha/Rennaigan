import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus, ScanSmiley } from '@phosphor-icons/react'
import { api } from '@/services/api'
import { absUrl, useBackendUrl } from '@/services/backend'
import { useQuery } from '@/hooks/useQuery'
import { usePageReveal } from '@/animations/usePageReveal'
import { greeting, shortHash, tc } from '@/lib/format'
import { EmptyState, ErrorState, ForensicLoader, GlassBadge, GlassButton, GlassInspector, GlassMetric, GlassPanel, GlassProgress } from '@/components/glass'
import { InvestigationTable } from '@/components/forensic/InvestigationTable'
import { MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { RadialSignal } from '@/components/forensic/RadialSignal'
import { LevelBadge, StatusBadge, VerdictBadge } from '@/components/forensic/meta'
import type { CaseFull } from '@/types'

const MODALITIES = ['visual', 'audio', 'lipsync', 'metadata', 'temporal'] as const
const MODALITY_LABEL: Record<string, string> = {
  visual: 'Visual artifacts',
  audio: 'Audio spectrum',
  lipsync: 'Lip-sync alignment',
  metadata: 'Metadata provenance',
  temporal: 'Temporal coherence',
}

export default function Overview() {
  const scope = useRef<HTMLDivElement>(null)
  const backendUrl = useBackendUrl()
  const { data, loading, error, retry } = useQuery(api.overview, [])
  usePageReveal(scope, [data])

  const active = data?.active ?? null
  const counts = data?.counts ?? { active: 0, processing: 0, review: 0, verified: 0 }
  const recent = data?.recent ?? []

  const rawCase = active?.rawCase as CaseFull | undefined
  const mediaUrl = absUrl(backendUrl, rawCase?.file?.media_url)
  const heatmapArtifact = rawCase?.artifacts?.find((a: any) => a.available && (a.name.includes('heatmap') || a.name.includes('spectrogram') || a.name.includes('keyframe')))
  const heatmapUrl = absUrl(backendUrl, heatmapArtifact?.url)

  const firstFinding = rawCase?.findings?.[0]
  const focusRegion = useMemo(() => {
    if (!firstFinding?.region || firstFinding.region.length !== 4) return null
    const [rx, ry, rw, rh] = firstFinding.region
    const isPixel = rx > 1 || ry > 1 || rw > 1 || rh > 1
    const mw = rawCase?.media?.width || 640
    const mh = rawCase?.media?.height || 360
    return {
      x: isPixel ? rx / mw : rx,
      y: isPixel ? ry / mh : ry,
      w: isPixel ? rw / mw : rw,
      h: isPixel ? rh / mh : rh,
    }
  }, [firstFinding, rawCase])

  if (loading) return <ForensicLoader />
  if (error || !data) return <GlassPanel><ErrorState title="Overview unavailable" body="The command center could not load your investigations." cause="The data service did not respond." onRetry={retry} /></GlassPanel>

  return (
    <div ref={scope}>
      <header data-reveal className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="t-title">{greeting()}, Analyst</h1>
          <p className="t-body mt-2 text-[0.9375rem]">
            {active
              ? `Case #${active.id} is active. ${counts.review} cases require review.`
              : 'ML Forensic Gateway is active. Ready to ingest and evaluate media.'}
          </p>
        </div>
        <GlassButton variant="primary" to="/analyze" icon={<Plus size={16} weight="light" />}>Start investigation</GlassButton>
      </header>

      {/* Metrics */}
      <section data-reveal aria-label="Workload" className="mb-10 grid grid-cols-2 gap-x-8 gap-y-8 border-y border-line py-7 lg:grid-cols-4">
        <GlassMetric label="Active cases" value={counts.active} hint="Processed by gateway" />
        <GlassMetric label="Processing" value={counts.processing} hint="Detector pipelines" />
        <GlassMetric label="Requires review" value={counts.review} hint="Anomalies flagged" tone={counts.review > 0 ? 'warn' : 'ok'} />
        <GlassMetric label="Verified cases" value={counts.verified} hint="Analyst decisions sealed" />
      </section>

      {active ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <GlassPanel data-reveal level={4} as="section" aria-labelledby="active-title" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
              <h2 id="active-title" className="t-label text-fg">Active forensic investigation</h2>
              <StatusBadge status={active.status} />
            </div>
            <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <Link to={`/analysis/${active.id}`} className="group relative block self-start overflow-hidden rounded-[14px] border border-line-2 bg-black/40" aria-label={`Open analysis for ${active.media}`}>
                <MediaFrame
                  time={0}
                  heat={0.9}
                  mediaUrl={mediaUrl}
                  mediaType={active.mediaType}
                  heatmapUrl={heatmapUrl}
                  className="transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.03]"
                />
                {focusRegion && <RegionBox region={focusRegion} active />}
                <span className="t-mono absolute bottom-2 left-2 rounded-[6px] bg-bg/75 px-1.5 py-0.5 text-[0.6875rem] text-fg-2">
                  {active.id}
                </span>
              </Link>
              <div className="flex min-w-0 flex-col">
                <p className="t-mono text-accent-2">{active.id}</p>
                <p className="mt-1 truncate text-xl font-[540] tracking-[-0.02em]">{active.media}</p>
                {active.rawCase?.verdict && <VerdictBadge verdict={active.rawCase.verdict} className="mt-3 self-start" />}
                <p className="mt-2 text-sm text-fg-2">{active.finding}</p>
                <GlassInspector dense className="mt-5" rows={[
                  { label: 'File format', value: active.format },
                  { label: 'Duration', value: tc(active.duration ?? 0), mono: true },
                  { label: 'Integrity', value: <span className="capitalize">{active.integrity}</span> },
                  { label: 'SHA-256', value: shortHash(active.sha256), mono: true, copy: active.sha256 },
                ]} />
                <div className="mt-5 flex items-center justify-between gap-3">
                  <span className="text-[0.8125rem] text-fg-2">Manipulation indicators</span>
                  <LevelBadge level={active.indicators} />
                </div>
                <GlassProgress className="mt-4" label="Evidence confidence" valueLabel={`${active.confidence}%`} value={active.confidence} />
                <p className="t-meta mt-2">Calibrated confidence score across {active.coverage}% module evidence coverage.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <GlassButton variant="primary" to={`/analysis/${active.id}`} trailing={<ArrowRight size={15} weight="light" />}>Open analysis</GlassButton>
                  <GlassButton to={`/reports/${active.id}`}>View report</GlassButton>
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel data-reveal as="section" aria-labelledby="signals-title" pad="lg">
            <div className="flex items-center justify-between gap-3">
              <h2 id="signals-title" className="t-label text-fg">Forensic signals</h2>
              <GlassBadge tone="neutral">{active.id}</GlassBadge>
            </div>
            <p className="t-meta mt-2">Peak anomaly strength per modality, 0 to 100.</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
              {MODALITIES.map((m) => (
                <RadialSignal
                  key={m}
                  label={MODALITY_LABEL[m]}
                  value={active.signals[m]}
                  detail={`${active.signals[m]}% calibrated`}
                />
              ))}
            </div>
          </GlassPanel>
        </div>
      ) : (
        <GlassPanel data-reveal level={2} className="py-12">
          <EmptyState
            title="No active investigations"
            body="Upload an image, video, or audio recording to run real-time forensic detection and generate tamper-evident audit trails."
            action={
              <GlassButton variant="primary" to="/analyze" icon={<ScanSmiley size={16} weight="light" />}>
                Submit media for evaluation
              </GlassButton>
            }
          />
        </GlassPanel>
      )}

      {recent.length > 0 && (
        <section data-reveal aria-labelledby="recent-title" className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="recent-title" className="t-section">Recent investigations</h2>
            <GlassButton variant="quiet" size="sm" to="/cases" trailing={<ArrowRight size={14} weight="light" />}>View all</GlassButton>
          </div>
          <GlassPanel level={1}>
            <InvestigationTable rows={recent} caption="Recent investigations" />
          </GlassPanel>
        </section>
      )}
    </div>
  )
}
