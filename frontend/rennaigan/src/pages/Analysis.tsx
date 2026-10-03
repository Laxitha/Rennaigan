import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, ArrowsOut, CaretLeft, CaretRight, Crosshair, MagnifyingGlassPlus, Pause, Play, SkipBack,
} from '@phosphor-icons/react'
import { api } from '@/services/api'
import { absUrl, useBackendUrl } from '@/services/backend'
import { useQuery } from '@/hooks/useQuery'
import { usePlayback } from '@/hooks/usePlayback'
import { useHotkey } from '@/hooks/useHotkey'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { d, dist, EASE, ensureFinished, gsap, useGSAP } from '@/lib/motion'
import { tc } from '@/lib/format'
import { EmptyState, ErrorState, ForensicLoader, GlassBadge, GlassButton, GlassPanel, GlassProgress, GlassTabs, GlassTooltip } from '@/components/glass'
import { heatIntensity, MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { Spectrogram } from '@/components/forensic/Spectrogram'
import { SEVERITY_TONE, StatusBadge } from '@/components/forensic/meta'
import { signalTone } from '@/components/forensic/RadialSignal'
import { ForensicTimeline } from '@/components/timeline/ForensicTimeline'
import { EvidenceGraph } from '@/components/graph/EvidenceGraph'
import { FrameDissector } from '@/components/forensic/FrameDissector'
import type { Anomaly, CaseFull } from '@/types'

const MEDIA_FPS = 25
const MODALITIES = ['visual', 'audio', 'lipsync', 'metadata', 'temporal'] as const
const MODALITY_LABEL: Record<string, string> = {
  visual: 'Visual artifacts',
  audio: 'Audio spectrum',
  lipsync: 'Lip-sync alignment',
  metadata: 'Metadata provenance',
  temporal: 'Temporal coherence',
}

const HEAT_LAYERS = [
  { id: 'visual', label: 'Visual / Spatial', modalities: ['visual'] },
  { id: 'audio', label: 'Audio / Spectral', modalities: ['audio', 'lipsync'] },
  { id: 'temporal', label: 'Temporal / Motion', modalities: ['temporal'] },
  { id: 'metadata', label: 'Container / Exif', modalities: ['metadata'] },
] as const

type LayerId = (typeof HEAT_LAYERS)[number]['id']
const RATES = [0.25, 0.5, 1, 2]
const ZOOMS = [1, 1.5, 2.25]

const NODE_NAMES: Record<string, string> = {
  media: 'Media Source',
  image: 'Image Forensics',
  video: 'Video Forensics',
  audio: 'Audio Forensics',
  motion: 'Motion Analysis',
  metadata: 'Container Metadata',
  fusion: 'Cross-Modal Fusion',
  assessment: 'Final Verdict',
}

export default function Analysis() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const scope = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const backendUrl = useBackendUrl()

  // Redirect to latest case if no ID provided in URL
  useEffect(() => {
    if (!id) {
      api.investigations().then((list) => {
        if (list.length > 0) {
          navigate(`/analysis/${list[0].id}`, { replace: true })
        }
      }).catch(() => {})
    }
  }, [id, navigate])

  const inv = useQuery(() => api.investigation(id || 'latest'), [id])
  const events = useQuery(() => api.anomalies(id || 'latest'), [id])
  const duration = inv.data?.duration ?? 10
  const isRealVideo = inv.data?.mediaType === 'video' && !!(inv.data?.rawCase as CaseFull | undefined)?.file?.media_url
  const player = usePlayback(duration, MEDIA_FPS, isRealVideo)
  const { seek, pause, timeRef, syncTime } = player

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [heat, setHeat] = useState(1)
  const [layers, setLayers] = useState<Set<LayerId>>(() => new Set(HEAT_LAYERS.map((l) => l.id)))
  const [inspect, setInspect] = useState(true)
  const [zoom, setZoom] = useState(0)
  const [view, setView] = useState<'source' | 'heat'>('heat')
  usePageReveal(scope, [inv.data, events.data])

  const anomalies = useMemo(() => events.data ?? [], [events.data])
  const flagged = useMemo(() => anomalies.filter((a) => a.flagged || a.severity !== 'low'), [anomalies])
  const selected = anomalies.find((a) => a.id === selectedId) ?? (flagged[0] ?? null)
  const heatAnomalies = useMemo(() => {
    const allowed = new Set(HEAT_LAYERS.filter((l) => layers.has(l.id)).flatMap((l) => l.modalities))
    return anomalies.filter((a) => allowed.has(a.modality))
  }, [anomalies, layers])

  /** Selecting an interval always replays */
  const select = useCallback((a: Anomaly) => { setSelectedId(a.id); setNonce((n) => n + 1) }, [])

  // Deep link from the analyzer: /analysis/:id?a=fnd-1
  useEffect(() => {
    const wanted = params.get('a')
    if (!wanted || !anomalies.length || !inv.data) return
    const found = anomalies.find((a) => a.id === wanted)
    if (found) select(found)
    params.delete('a')
    setParams(params, { replace: true })
  }, [anomalies, inv.data, params, setParams, select])

  useGSAP(() => {
    if (!selected) return
    pause()
    const proxy = { t: timeRef.current, heat: 0 }
    setHeat(0)
    const tl = ensureFinished(gsap.timeline({ defaults: { ease: EASE.out } }))
    tl.to(proxy, { t: selected.frame / MEDIA_FPS, duration: d(0.8), ease: EASE.inOut, onUpdate: () => seek(proxy.t) })
      .fromTo('[data-region-active]', { autoAlpha: 0, scale: 1.35 }, { autoAlpha: 1, scale: 1, duration: d(0.5) })
      .to(proxy, { heat: 1, duration: d(0.7), ease: EASE.soft, onUpdate: () => setHeat(proxy.heat) }, '<0.1')
      .fromTo('[data-spectro]', { autoAlpha: 0, y: dist(16) }, { autoAlpha: 1, y: 0, duration: d(0.5) }, '<0.2')
      .fromTo('[data-why]', { autoAlpha: 0, x: dist(26) }, { autoAlpha: 1, x: 0, duration: d(0.55) }, '<0.1')
      .fromTo('[data-why-item]', { autoAlpha: 0, y: dist(8) }, { autoAlpha: 1, y: 0, duration: d(0.35), stagger: 0.06 }, '<0.2')
      .fromTo('[data-path]', { autoAlpha: 0 }, { autoAlpha: 1, duration: d(0.5) }, '<0.1')
  }, { dependencies: [selectedId, nonce], scope })

  const ready = !!inv.data
  useHotkey('space', (e) => { e.preventDefault(); player.toggle() }, { enabled: ready })
  useHotkey('arrowleft', () => player.step(-1), { enabled: ready })
  useHotkey('arrowright', () => player.step(1), { enabled: ready })
  useHotkey('1', () => flagged[0] && select(flagged[0]), { enabled: ready })
  useHotkey('2', () => flagged[1] && select(flagged[1]), { enabled: ready })
  useHotkey('3', () => flagged[2] && select(flagged[2]), { enabled: ready })

  if (inv.loading || events.loading) return <ForensicLoader />
  if (inv.error || !inv.data) {
    return (
      <GlassPanel>
        <ErrorState
          title="Investigation not found"
          body={id ? `No investigation with ID ${id} exists in the gateway store.` : 'No cases have been analyzed yet.'}
          secondary={<GlassButton to="/analyze" variant="primary">Start new investigation</GlassButton>}
        />
      </GlassPanel>
    )
  }

  const investigation = inv.data
  const rawCase = investigation.rawCase as CaseFull | undefined
  const mediaUrl = absUrl(backendUrl, rawCase?.file?.media_url)
  const heatmapArtifact = rawCase?.artifacts?.find((a: any) => a.available && (a.name.includes('heatmap') || a.name.includes('ela')))
    || (investigation.mediaType === 'audio' ? rawCase?.artifacts?.find((a: any) => a.available && a.name.includes('spectrogram')) : null)
  const heatmapUrl = absUrl(backendUrl, heatmapArtifact?.url)

  const { time } = player
  const signals = {
    visual: investigation.signals.visual ?? 20,
    audio: investigation.signals.audio ?? 15,
    lipsync: investigation.signals.lipsync ?? 10,
    metadata: investigation.signals.metadata ?? 10,
    temporal: investigation.signals.temporal ?? 15,
  }

  const regions = anomalies.filter((a) => a.region && (a.id === selectedId || (inspect && heatIntensity(a, time) > 0.1)))
  const origin = selected?.region ? `${(selected.region.x + selected.region.w / 2) * 100}% ${(selected.region.y + selected.region.h / 2) * 100}%` : '50% 50%'
  const showSpectro = selected && (selected.modality === 'lipsync' || selected.modality === 'audio' || investigation.mediaType === 'audio')
  const toggleLayer = (l: LayerId) => setLayers((s) => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n })

  const overlays = (
    <div className="pointer-events-none absolute inset-0">
      {regions.map((a) => (
        <RegionBox key={a.id} region={a.region!} active={a.id === selectedId} label={a.id === selectedId ? a.label : undefined}
          {...(a.id === selectedId ? { 'data-region-active': '' } : {})} />
      ))}
    </div>
  )

  return (
    <div ref={scope}>
      <WorkstationHeader id={investigation.id} media={investigation.media} status={investigation.status} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div data-reveal className="md:hidden">
            <GlassTabs label="Canvas view" value={view} onChange={setView} items={[{ id: 'heat', label: 'Heatmap' }, { id: 'source', label: 'Source' }]} />
          </div>

          <div ref={stage} className="grid gap-5 bg-bg md:grid-cols-2 [&:fullscreen]:content-center [&:fullscreen]:p-6">
            <GlassPanel data-reveal as="section" aria-label="Source media" className={cn(view !== 'source' && 'max-md:hidden')}>
              <PanelTitle title="Source media" right={<span className="t-mono text-fg-3">Frame {String(player.frame).padStart(5, '0')}</span>} />
              <div className="relative mx-3 overflow-hidden rounded-[12px] border border-line bg-black/40">
                <div className="relative transition-transform duration-500 ease-[var(--ease-out-expo)]" style={{ transform: `scale(${ZOOMS[zoom]})`, transformOrigin: origin }}>
                  <MediaFrame
                    time={time}
                    mediaUrl={mediaUrl}
                    mediaType={investigation.mediaType}
                    heatmapUrl={null}
                    playing={player.playing}
                    rate={player.rate}
                    isPrimary={true}
                    onTimeUpdate={syncTime}
                    onEnded={pause}
                    onTogglePlay={player.toggle}
                    label={`Source frame at ${tc(time)}`}
                  />
                  {overlays}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 p-3">
                <GlassButton size="sm" iconOnly variant="primary" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'} icon={player.playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />} />
                <GlassButton size="sm" iconOnly variant="quiet" onClick={() => seek(0)} aria-label="Return to start" icon={<SkipBack size={15} weight="light" />} />
                <GlassButton size="sm" iconOnly variant="quiet" onClick={() => player.step(-1)} aria-label="Previous frame" icon={<CaretLeft size={15} weight="light" />} />
                <GlassButton size="sm" iconOnly variant="quiet" onClick={() => player.step(1)} aria-label="Next frame" icon={<CaretRight size={15} weight="light" />} />
                <span className="t-mono mx-1.5 text-fg">{tc(time)}<span className="text-fg-3 max-[1500px]:hidden"> / {tc(duration)}</span></span>
                <span className="ml-auto flex items-center gap-1.5">
                  <GlassTooltip content="Playback speed">
                    <GlassButton size="sm" onClick={() => player.setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length])} aria-label={`Playback speed ${player.rate}x. Change speed`} className="t-mono w-12 px-0">{player.rate}x</GlassButton>
                  </GlassTooltip>
                  <GlassTooltip content={`Zoom ${ZOOMS[zoom]}x`}>
                    <GlassButton size="sm" iconOnly onClick={() => setZoom((z) => (z + 1) % ZOOMS.length)} aria-label={`Zoom ${ZOOMS[zoom]}x. Change zoom`} aria-pressed={zoom > 0} icon={<MagnifyingGlassPlus size={15} weight="light" />} />
                  </GlassTooltip>
                  <GlassTooltip content="Show regions under inspection" align="end">
                    <GlassButton size="sm" iconOnly onClick={() => setInspect((v) => !v)} aria-label="Inspect regions" aria-pressed={inspect} icon={<Crosshair size={15} weight="light" />} />
                  </GlassTooltip>
                  <GlassTooltip content="Fullscreen" align="end">
                    <GlassButton size="sm" iconOnly onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen?.())} aria-label="Toggle fullscreen" icon={<ArrowsOut size={15} weight="light" />} />
                  </GlassTooltip>
                </span>
              </div>
            </GlassPanel>

            <GlassPanel data-reveal level={3} as="section" aria-label="Manipulation heatmap" className={cn(view !== 'heat' && 'max-md:hidden')}>
              <PanelTitle title="Forensic heatmap" right={
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[0.6875rem] text-fg-3">
                    <span>Intensity</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={heat}
                      onChange={(e) => setHeat(parseFloat(e.target.value))}
                      className="h-1.5 w-16 cursor-pointer accent-accent"
                      aria-label="Heatmap intensity"
                    />
                    <span className="t-mono w-7 text-right text-fg-2">{Math.round(heat * 100)}%</span>
                  </label>
                  <span className="flex items-center gap-1 text-[0.6875rem] text-fg-3 max-sm:hidden">
                    <span>Low</span>
                    <span aria-hidden className="h-1.5 w-10 rounded-full bg-gradient-to-r from-wine via-accent to-[#ffecc8]" />
                    <span>High</span>
                  </span>
                </div>
              } />
              <div className="relative mx-3 overflow-hidden rounded-[12px] border border-line bg-black/40">
                <div className="relative transition-transform duration-500 ease-[var(--ease-out-expo)]" style={{ transform: `scale(${ZOOMS[zoom]})`, transformOrigin: origin }}>
                  <MediaFrame
                    time={time}
                    heat={heat}
                    mediaUrl={mediaUrl}
                    mediaType={investigation.mediaType}
                    heatmapUrl={heatmapUrl}
                    anomalies={heatAnomalies}
                    playing={player.playing}
                    rate={player.rate}
                    isPrimary={false}
                    onTogglePlay={player.toggle}
                    label={`Manipulation heatmap at ${tc(time)}`}
                  />
                  {overlays}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 p-3" role="group" aria-label="Heatmap layers">
                {HEAT_LAYERS.map((l) => (
                  <button key={l.id} type="button" className="btn" data-size="sm" aria-pressed={layers.has(l.id)} onClick={() => toggleLayer(l.id)}>{l.label}</button>
                ))}
              </div>
            </GlassPanel>
          </div>

          <GlassPanel data-reveal level={1} as="section" aria-label="Forensic timeline" className="px-5 pb-5 pt-9">
            <ForensicTimeline duration={duration} anomalies={anomalies} time={time} selectedId={selected?.id ?? null} onSeek={seek} onSelect={select} />
          </GlassPanel>

          {inv.data?.mediaType === 'video' && (
            <FrameDissector
              caseId={inv.data.id}
              sourceFps={MEDIA_FPS}
              durationS={duration}
              onSeek={seek}
              currentTime={time}
            />
          )}

          {selected && (
            <div className={cn('grid items-start gap-5', showSpectro && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]')}>
              {showSpectro && (
                <GlassPanel data-spectro as="section" aria-label="Audio spectrogram" pad>
                  <h2 className="t-label mb-3 text-fg">Audio spectrogram</h2>
                  {heatmapUrl && investigation.mediaType === 'audio' ? (
                    <img src={heatmapUrl} alt="Audio spectrogram" className="h-44 w-full rounded-[8px] object-cover border border-line" />
                  ) : (
                    <Spectrogram start={Math.max(0, selected.start - 1.6)} end={Math.min(duration, selected.end + 1.6)} time={time} flagStart={selected.start} flagEnd={selected.end} />
                  )}
                  <p className="t-meta mt-3">{selected.indicators[0] || selected.explanation}</p>
                </GlassPanel>
              )}
              <GlassPanel data-path as="section" aria-label="Evidence path" pad>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="t-label text-fg">Evidence path</h2>
                  <GlassButton size="sm" variant="quiet" to={`/evidence/${investigation.id}`} trailing={<ArrowRight size={14} weight="light" />}>Open graph</GlassButton>
                </div>
                <EvidenceGraph interactive={false} highlightPath={selected.graphPath} className="aspect-[1380/640] w-full max-md:hidden" />
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:mt-3">
                  {selected.graphPath.map((n, i) => (
                    <li key={n} className="flex items-center gap-2 text-[0.75rem] text-fg-2">
                      {i > 0 && <CaretRight size={10} weight="light" className="text-fg-3" aria-hidden />}
                      {NODE_NAMES[n] || n}
                    </li>
                  ))}
                </ol>
              </GlassPanel>
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-5" aria-label="Forensic findings">
          <GlassPanel data-reveal as="section" aria-labelledby="flagged-title">
            <PanelTitle id="flagged-title" title={`${flagged.length} forensic intervals`} />
            <ul className="px-2 pb-2">
              {flagged.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-fg-3">
                  No anomalous intervals detected above threshold.
                </li>
              ) : (
                flagged.map((a, i) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => select(a)} aria-pressed={a.id === selected?.id}
                      className={cn('row-hover flex w-full items-center gap-3 rounded-[12px] border px-3 py-3 text-left transition-colors', a.id === selected?.id ? 'border-accent/45 bg-accent/[0.1]' : 'border-transparent')}>
                      <span className="kbd shrink-0">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="t-mono block text-fg">{tc(a.start)} to {tc(a.end)}</span>
                        <span className="t-label mt-1 block">{a.title}</span>
                      </span>
                      <GlassBadge tone={SEVERITY_TONE[a.severity]}>{a.severity}</GlassBadge>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </GlassPanel>

          {selected ? (
            <GlassPanel data-why level={4} as="section" aria-labelledby="why-title" aria-live="polite" pad>
              <h2 id="why-title" className="t-label text-accent-3">Why this was flagged</h2>
              <p className="mt-3 text-lg font-[540] leading-tight tracking-[-0.02em]">{selected.title}</p>
              <p className="t-mono mt-1.5 text-fg-2">{tc(selected.start)} to {tc(selected.end)}, frame {String(selected.frame).padStart(5, '0')}</p>
              <p className="mt-4 text-sm leading-relaxed text-fg-2">{selected.explanation}</p>
              <h3 className="t-label mt-5">Primary indicators</h3>
              <ul className="mt-2 flex flex-col">
                {selected.indicators.map((ind) => (
                  <li key={ind} data-why-item className="flex items-center gap-2.5 border-b border-line/60 py-2 text-sm text-fg last:border-b-0">
                    <span aria-hidden className="h-3 w-px bg-accent" />{ind}
                  </li>
                ))}
              </ul>
              <GlassProgress className="mt-5" label="Detector score" valueLabel={`${selected.confidence}%`} value={selected.confidence} />
              <p className="t-meta mt-2">Confidence of the {MODALITY_LABEL[selected.modality] || selected.modality} detector.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <GlassButton variant="primary" to={`/review/${investigation.id}`}>Review finding</GlassButton>
                <GlassButton onClick={() => select(selected)}>Replay</GlassButton>
              </div>
            </GlassPanel>
          ) : (
            <GlassPanel data-reveal level={1}>
              <EmptyState className="py-10" title="Analysis Clean" body="This media file has passed all applicable forensic integrity tests." />
            </GlassPanel>
          )}

          <GlassPanel data-reveal as="section" aria-labelledby="signals-now" pad>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="signals-now" className="t-label text-fg">Forensic signals</h2>
              <span className="t-mono text-fg-3">at {tc(time)}</span>
            </div>
            <div className="flex flex-col gap-4">
              {MODALITIES.map((m) => {
                const v = Math.round(signals[m])
                return <GlassProgress key={m} label={MODALITY_LABEL[m]} valueLabel={String(v)} value={v} tone={signalTone(v)} />
              })}
            </div>
          </GlassPanel>
        </aside>
      </div>
    </div>
  )
}

function PanelTitle({ title, right, id }: { title: string; right?: ReactNode; id?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <h2 id={id} className="t-label text-fg">{title}</h2>
      {right}
    </div>
  )
}

function WorkstationHeader({ id, media, status }: { id: string; media: string; status: Parameters<typeof StatusBadge>[0]['status'] }) {
  return (
    <header data-reveal className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-[540] tracking-[-0.02em]">{media}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="t-mono text-fg-3">{id}</span>
          <StatusBadge status={status} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={`/timeline/${id}`} className="btn">Timeline</Link>
        <Link to={`/reports/${id}`} className="btn" data-variant="primary">Forensic report</Link>
      </div>
    </header>
  )
}
