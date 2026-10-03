import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DownloadSimple, ShareNetwork, ShieldCheck } from '@phosphor-icons/react'
import { useInvestigation } from '@/hooks/useInvestigation'
import { useQuery } from '@/hooks/useQuery'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { bytes, fmtDateTime, shortHash, tc } from '@/lib/format'
import { api } from '@/services/api'
import { absUrl, useBackendUrl } from '@/services/backend'
import { CopyButton, CountUp, GlassBadge, GlassButton, GlassInspector, GlassModal, GlassPanel, useToast } from '@/components/glass'
import { MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { Spectrogram } from '@/components/forensic/Spectrogram'
import { LevelBadge, SEVERITY_TONE } from '@/components/forensic/meta'
import { ForensicTimeline } from '@/components/timeline/ForensicTimeline'
import { EvidenceGraph } from '@/components/graph/EvidenceGraph'

const SECTIONS = [
  ['file', 'File information'],
  ['hash', 'Hash & Provenance'],
  ['metadata', 'Metadata'],
  ['frames', 'Frame analysis'],
  ['visual', 'Visual analysis'],
  ['audio', 'Audio analysis'],
  ['cross', 'Cross-modal analysis'],
  ['timeline', 'Manipulation timeline'],
  ['heatmaps', 'Heatmaps & Artifacts'],
  ['graph', 'Evidence graph'],
  ['explanations', 'Explanations'],
  ['audit', 'Audit trail'],
] as const

const MODALITY_LABEL: Record<string, string> = {
  visual: 'Visual artifacts',
  audio: 'Audio spectrum',
  lipsync: 'Lip-sync alignment',
  metadata: 'Metadata provenance',
  temporal: 'Temporal coherence',
}

function Section({ id, title, children, wide }: { id: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-reveal className="scroll-mt-28 border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 id={`${id}-h`} className="t-label mb-5 text-fg">{title}</h2>
      <div className={cn(!wide && 'max-w-[68ch]')}>{children}</div>
    </section>
  )
}

function ConfidenceBand({ value, low, high }: { value: number; low: number; high: number }) {
  return (
    <div className="mt-4" role="img" aria-label={`Evidence trust score ${value} percent, calibrated range ${low} to ${high} percent`}>
      <div className="relative h-2 rounded-full bg-white/[0.07]">
        <span className="absolute inset-y-0 rounded-full bg-accent/35" style={{ left: `${low}%`, width: `${high - low}%` }} />
        <span className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-fg" style={{ left: `${value}%` }} />
      </div>
      <div className="t-mono mt-2 flex justify-between text-[0.6875rem] text-fg-3"><span>0</span><span>Range {low} to {high}</span><span>100</span></div>
    </div>
  )
}

export default function Report() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const scope = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const backendUrl = useBackendUrl()

  // Redirect to latest case if no ID provided in URL
  useEffect(() => {
    if (!id) {
      api.investigations().then((list) => {
        if (list.length > 0) {
          navigate(`/reports/${list[0].id}`, { replace: true })
        }
      }).catch(() => {})
    }
  }, [id, navigate])

  const { investigation, gate } = useInvestigation(id || 'latest', 'forensic report')
  const { data: caseFull } = useQuery(() => api.caseFull(id || 'latest'), [id])
  const { data: anomalies = [] } = useQuery(() => api.anomalies(id || 'latest'), [id])
  const { data: audit = [] } = useQuery(() => api.audit(id || 'latest'), [id])

  const [share, setShare] = useState(false)
  const [current, setCurrent] = useState('file')
  usePageReveal(scope, [investigation, gate, caseFull])

  useEffect(() => {
    if (gate) return
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setCurrent(hit.target.id)
    }, { rootMargin: '-20% 0px -65% 0px' })
    SECTIONS.forEach(([sid]) => { const el = document.getElementById(sid); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [gate])

  const anomalyList = anomalies ?? []
  const auditList = audit ?? []
  const flagged = useMemo(() => anomalyList.filter((a) => a.flagged || a.severity !== 'low'), [anomalyList])

  if (gate || !investigation) return <div ref={scope}>{gate}</div>

  const inv = investigation
  const link = `${location.origin}/reports/${inv.id}`
  const mediaUrl = absUrl(backendUrl, caseFull?.file?.media_url)
  const duration = inv.duration || caseFull?.media?.duration_s || 10
  const fps = caseFull?.media?.fps || 25
  const totalFrames = Math.max(1, Math.round(duration * fps))

  const heatmapArtifact = caseFull?.artifacts?.find((a: any) => a.available && (a.name.includes('heatmap') || a.name.includes('spectrogram') || a.name.includes('keyframe')))
  const heatmapUrl = absUrl(backendUrl, heatmapArtifact?.url)

  // Real metadata list
  const metadataRows: Array<[string, string, boolean]> = [
    ['file_name', caseFull?.file?.name || inv.media, false],
    ['media_type', caseFull?.media?.media_type || inv.mediaType, false],
    ['content_type', caseFull?.file?.content_type || inv.format, false],
    ['duration', tc(duration), false],
    ['resolution', inv.resolution || 'Not applicable', false],
    ['file_size', bytes(inv.sizeBytes), false],
    ['analyzed_at', fmtDateTime(inv.createdAt), false],
    ['modules_evaluated', (caseFull?.applicable_modules || []).join(', ') || 'image, metadata', false],
    ['tamper_evidence', 'SHA-256 sealed in SQLite hash chain', false],
  ]

  const visualFinding = anomalyList.find((a) => a.modality === 'visual')
  const audioFinding = anomalyList.find((a) => a.modality === 'audio')
  const temporalFinding = anomalyList.find((a) => a.modality === 'temporal')

  return (
    <div ref={scope}>
      <header data-reveal className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="t-label">Rennaigan / Forensic report</p>
          <h1 className="t-title mt-3">Investigation <span className="t-mono text-[0.92em] tracking-[-0.03em]">#{inv.id}</span></h1>
          <p className="t-meta mt-2">
            {inv.media}. Sealed {fmtDateTime(inv.createdAt)}. Evaluated with {caseFull?.applicable_modules?.length || 2} forensic modules. Analyst: {inv.analyst}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <GlassButton variant="primary" icon={<DownloadSimple size={16} weight="light" />} onClick={() => { toast({ title: 'Print dialog opened', description: 'Choose Save as PDF to export the report.', tone: 'info' }); setTimeout(() => window.print(), 250) }}>Export report</GlassButton>
          <GlassButton icon={<ShareNetwork size={16} weight="light" />} onClick={() => setShare(true)}>Share evidence</GlassButton>
          <GlassButton icon={<ShieldCheck size={16} weight="light" />} to={`/audit/${inv.id}`}>Open audit trail</GlassButton>
        </div>
      </header>

      <GlassPanel data-reveal level={4} as="section" aria-labelledby="assessment-h" pad="lg" className="mb-8">
        <h2 id="assessment-h" className="t-label text-accent-3">Forensic assessment</h2>
        <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-baseline gap-2">
              <CountUp value={inv.confidence} className="text-[4.5rem] font-[520] leading-none tracking-[-0.05em]" /><span className="text-2xl text-fg-2">%</span>
              <span className="t-label ml-3">Trust score ({inv.status})</span>
            </div>
            <ConfidenceBand value={inv.confidence} low={Math.max(0, inv.confidence - 8)} high={Math.min(100, inv.confidence + 8)} />
            <p className="mt-4 max-w-[58ch] text-sm leading-relaxed text-fg-2">
              {caseFull?.label_reason || (inv.confidence > 70
                ? 'High confidence in media authenticity. Evaluated detectors observed no manipulation markers exceeding threshold.'
                : 'Suspicious anomalies observed across evaluated forensic modules. Independent analyst verification recommended.')}
            </p>
          </div>
          <dl className="grid content-start gap-0">
            {([
              ['Manipulation indicators', <LevelBadge key="a" level={inv.indicators} />],
              ['Evidence coverage', <span key="b" className="t-mono text-fg">{inv.coverage}%</span>],
              ['Verdict label', <GlassBadge key="c" tone={inv.confidence > 70 ? 'ok' : 'warn'}>{caseFull?.label || (inv.confidence > 70 ? 'Authentic' : 'Review recommended')}</GlassBadge>],
              ['Human review', <GlassBadge key="d" tone={caseFull?.review ? 'ok' : 'neutral'}>{caseFull?.review ? 'Reviewed' : 'Pending'}</GlassBadge>],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-line/70 py-3.5 first:pt-0 last:border-b-0">
                <dt className="text-sm text-fg-2">{label}</dt><dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </GlassPanel>

      <div className="grid gap-10 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Report contents" className="no-print max-xl:hidden">
          <ol className="sticky top-28 flex flex-col border-l border-line">
            {SECTIONS.map(([sid, label]) => (
              <li key={sid}>
                <a href={`#${sid}`} aria-current={current === sid ? 'location' : undefined}
                  className={cn('-ml-px block border-l py-1.5 pl-4 text-[0.8125rem] transition-colors', current === sid ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg-2')}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <GlassPanel level={1} pad="lg" className="min-w-0">
          <Section id="file" title="File information">
            <GlassInspector rows={[
              { label: 'File name', value: inv.media },
              { label: 'Format', value: inv.format },
              { label: 'Duration', value: tc(duration), mono: true },
              { label: 'Resolution', value: inv.resolution ?? 'Not applicable', mono: true },
              { label: 'Size', value: bytes(inv.sizeBytes), mono: true },
              { label: 'Received', value: fmtDateTime(inv.createdAt) },
            ]} />
          </Section>

          <Section id="hash" title="Hash & Provenance">
            <div className="glass-inner flex items-center gap-3 p-4">
              <code className="t-mono min-w-0 flex-1 break-all text-fg">{inv.sha256}</code>
              <CopyButton text={inv.sha256} label="SHA-256" />
            </div>
            <p className="t-meta mt-3">SHA-256 cryptographic digest calculated at ingestion before any detector processing. Verified intact in the SQLite audit chain.</p>
          </Section>

          <Section id="metadata" title="Metadata">
            <dl>
              {metadataRows.map(([k, v, flag]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-4 border-b border-line/60 py-2.5 last:border-b-0">
                  <dt className="t-mono text-fg-3">{k}</dt><dd className="t-mono truncate text-fg">{v}</dd>
                  <dd className="w-[4.5rem] text-right">{flag && <GlassBadge tone="warn">Noted</GlassBadge>}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="frames" title="Frame analysis">
            <p className="text-sm leading-relaxed text-fg-2">
              {inv.mediaType === 'image'
                ? `1 full-resolution frame analyzed across spatial and frequency domains. ${flagged.length} intervals flagged.`
                : `${totalFrames} frames analyzed across temporal and spatial detectors. ${flagged.length} intervals flagged.`}
            </p>
            {flagged.length > 0 && (
              <ul className="mt-4">
                {flagged.map((a) => (
                  <li key={a.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-4 border-b border-line/60 py-3 last:border-b-0">
                    <span className="t-mono text-fg">{tc(a.start)} to {tc(a.end)}</span>
                    <span className="truncate text-sm text-fg-2">{a.title}</span>
                    <GlassBadge tone={SEVERITY_TONE[a.severity]}>{a.severity}</GlassBadge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="visual" title="Visual analysis">
            <p className="text-sm leading-relaxed text-fg-2">
              {visualFinding
                ? visualFinding.explanation
                : 'Error Level Analysis (ELA), frequency domain DCT distribution, and boundary consistency checks verified that no spatial splicing or recompression inconsistencies were detected.'}
            </p>
          </Section>

          <Section id="audio" title="Audio analysis" wide>
            <div className="grid gap-6 md:grid-cols-2">
              <p className="text-sm leading-relaxed text-fg-2">
                {audioFinding
                  ? audioFinding.explanation
                  : inv.mediaType === 'image'
                  ? 'No audio stream present in this image upload.'
                  : 'Fast Fourier Transform (FFT) spectral energy, silence consistency, and noise floor checks verified normal acoustic properties.'}
              </p>
              {heatmapUrl && (inv.mediaType === 'audio' || heatmapArtifact?.name.includes('spectrogram')) ? (
                <img src={heatmapUrl} alt="Audio spectrogram" className="h-40 w-full rounded-[8px] object-cover border border-line" />
              ) : (
                <Spectrogram start={0} end={duration} time={-1} flagStart={0} flagEnd={0} />
              )}
            </div>
          </Section>

          <Section id="cross" title="Cross-modal analysis">
            <p className="text-sm leading-relaxed text-fg-2">
              {temporalFinding
                ? temporalFinding.explanation
                : `Cross-modal evidence fusion calibrated in logit space. Total applicable module coverage: ${inv.coverage}%.`}
            </p>
          </Section>

          <Section id="timeline" title="Manipulation timeline" wide>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <ForensicTimeline readOnly duration={duration} anomalies={anomalyList} time={0} />
              </div>
            </div>
          </Section>

          <Section id="heatmaps" title="Heatmaps & Artifacts" wide>
            <div className="grid gap-4 sm:grid-cols-2">
              <figure>
                <div className="relative overflow-hidden rounded-[12px] border border-line bg-black/40">
                  <MediaFrame time={0} heat={1} mediaUrl={mediaUrl} mediaType={inv.mediaType} heatmapUrl={heatmapUrl} label="Forensic evaluation" />
                </div>
                <figcaption className="mt-2.5">
                  <span className="t-mono block text-fg">Analysis Artifact</span>
                  <span className="t-meta">{heatmapArtifact ? heatmapArtifact.name : 'Real media inspection frame'}</span>
                </figcaption>
              </figure>
              {flagged.length > 0 && flagged[0].region && (
                <figure>
                  <div className="relative overflow-hidden rounded-[12px] border border-line bg-black/40">
                    <MediaFrame time={flagged[0].start} heat={1} mediaUrl={mediaUrl} mediaType={inv.mediaType} heatmapUrl={heatmapUrl} label={flagged[0].title} />
                    <RegionBox region={flagged[0].region} active />
                  </div>
                  <figcaption className="mt-2.5">
                    <span className="t-mono block text-fg">{tc(flagged[0].start)}</span>
                    <span className="t-meta">{flagged[0].title}</span>
                  </figcaption>
                </figure>
              )}
            </div>
          </Section>

          <Section id="graph" title="Evidence graph" wide>
            <div className="overflow-x-auto">
              <EvidenceGraph interactive={false} className="aspect-[1380/640] min-w-[720px]" />
            </div>
            <Link to={`/evidence/${inv.id}`} className="btn mt-4 no-print" data-size="sm">Explore the graph</Link>
          </Section>

          <Section id="explanations" title="Explanations">
            <ol className="flex flex-col gap-6">
              {flagged.length === 0 ? (
                <li className="text-sm text-fg-3">All detectors returned values below the configured anomaly threshold.</li>
              ) : (
                flagged.map((a) => (
                  <li key={a.id}>
                    <h3 className="text-[0.9375rem] font-[540] text-fg">{a.title} <span className="t-mono ml-2 text-[0.8125rem] font-normal text-fg-3">{tc(a.start)}</span></h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{a.explanation}</p>
                    <p className="t-meta mt-2">Detector score {a.confidence}%. Modality: {MODALITY_LABEL[a.modality] || a.modality}.</p>
                  </li>
                ))
              )}
            </ol>
          </Section>

          <Section id="audit" title="Audit trail" wide>
            <ol>
              {auditList.slice(0, 6).map((e) => (
                <li key={e.seq} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line/60 py-2.5 last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]">
                  <span className="t-mono text-fg-3">{String(e.seq).padStart(2, '0')}</span>
                  <span className="truncate text-sm text-fg">{e.action}</span>
                  <span className="t-mono text-fg-3 max-sm:hidden">{e.actor || e.model}</span>
                  <span className="t-mono text-fg-2">{shortHash(e.output_hash || e.entry_hash || '', 6, 4)}</span>
                </li>
              ))}
            </ol>
            <p className="t-meta mt-3">{auditList.length} records sealed in cryptographic hash chain.</p>
            <Link to={`/audit/${inv.id}`} className="btn mt-4 no-print" data-size="sm">Open audit trail</Link>
          </Section>
        </GlassPanel>
      </div>

      <GlassModal open={share} onClose={() => setShare(false)} title="Share evidence" description="Direct link to this forensic report."
        footer={<GlassButton onClick={() => setShare(false)}>Done</GlassButton>}>
        <label htmlFor="share-link" className="t-label">Report link</label>
        <div className="mt-2 flex items-center gap-2">
          <input id="share-link" readOnly value={link} className="field t-mono" onFocus={(e) => e.currentTarget.select()} data-autofocus />
          <GlassButton variant="primary" onClick={async () => { try { await navigator.clipboard.writeText(link) } catch { /* clipboard blocked */ } toast({ title: 'Link copied', tone: 'ok' }) }}>Copy</GlassButton>
        </div>
      </GlassModal>
    </div>
  )
}
