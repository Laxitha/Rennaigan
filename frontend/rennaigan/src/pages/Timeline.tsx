import { useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Pause, Play } from '@phosphor-icons/react'
import { useInvestigation } from '@/hooks/useInvestigation'
import { usePlayback } from '@/hooks/usePlayback'
import { useHotkey } from '@/hooks/useHotkey'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, gsap, useGSAP } from '@/lib/motion'
import { tc } from '@/lib/format'
import { anomalies, MEDIA_DURATION, MEDIA_FPS, MODALITIES, MODALITY_LABEL, signalAt } from '@/data/anomalies'
import { GlassBadge, GlassButton, GlassPanel, GlassProgress, VirtualList } from '@/components/glass'
import { heatIntensity, MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { SEVERITY_TONE } from '@/components/forensic/meta'
import { signalTone } from '@/components/forensic/RadialSignal'
import { ForensicTimeline } from '@/components/timeline/ForensicTimeline'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { Anomaly } from '@/types'

const FRAMES = Array.from({ length: Math.floor(MEDIA_DURATION * MEDIA_FPS) }, (_, i) => {
  const s = signalAt(i / MEDIA_FPS)
  return { index: i, peak: Math.max(s.visual, s.audio, s.lipsync, s.temporal) }
})
const SORTED = [...anomalies].sort((a, b) => a.start - b.start)

export default function Timeline() {
  const { id = '' } = useParams()
  const scope = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const { investigation, gate } = useInvestigation(id, 'timeline')
  const player = usePlayback(MEDIA_DURATION, MEDIA_FPS)
  const { seek, timeRef, pause } = player
  const [selectedId, setSelectedId] = useState<string | null>(null)
  usePageReveal(scope, [investigation, gate])
  useHotkey('space', (e) => { e.preventDefault(); player.toggle() }, { enabled: !gate })

  const selected = SORTED.find((a) => a.id === selectedId) ?? null
  const { time } = player
  const signals = useMemo(() => signalAt(time), [time])
  const here = SORTED.filter((a) => time >= a.start && time <= a.end)

  const jump = (a: Anomaly) => {
    pause()
    setSelectedId(a.id)
    const proxy = { t: timeRef.current }
    gsap.to(proxy, { t: a.start, duration: d(0.6), ease: EASE.inOut, onUpdate: () => seek(proxy.t) })
  }

  useGSAP(() => {
    if (selectedId) fromToSafe(detail.current, { autoAlpha: 0, y: dist(10) }, { autoAlpha: 1, y: 0, duration: d(0.4), ease: EASE.out })
  }, [selectedId])

  if (gate || !investigation) return <div ref={scope}><PageHeader title="Forensic timeline" />{gate}</div>

  return (
    <div ref={scope}>
      <PageHeader title="Forensic timeline" description="Every anomaly on one time axis, by modality. Drag the playhead and the panels below follow."
        meta={<><span className="t-mono text-fg-3">{investigation.media}</span><span className="t-mono text-fg-3">{tc(MEDIA_DURATION)} at {MEDIA_FPS} fps</span></>}
        actions={<GlassButton onClick={player.toggle} variant="primary" icon={player.playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}>{player.playing ? 'Pause' : 'Play'}</GlassButton>} />

      <GlassPanel data-reveal level={3} as="section" aria-label="Timeline" className="px-5 pb-6 pt-10 sm:px-7">
        <ForensicTimeline duration={MEDIA_DURATION} anomalies={SORTED} time={time} selectedId={selectedId} onSeek={seek} onSelect={jump} />
      </GlassPanel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <GlassPanel data-reveal as="section" aria-label="Frame at playhead" className="overflow-hidden">
          <div className="relative">
            <MediaFrame time={time} heat={0.85} anomalies={SORTED} />
            {here.filter((a) => a.region && heatIntensity(a, time) > 0.1).map((a) => <RegionBox key={a.id} region={a.region!} active={a.id === selectedId} />)}
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3.5">
            <span className="t-mono text-fg">{tc(time)}</span>
            <span className="t-mono text-fg-3">Frame {String(player.frame).padStart(5, '0')}</span>
          </div>
          <div ref={detail} className="border-t border-line px-5 py-4" aria-live="polite">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-[540] text-fg">{selected.title}</p>
                  <GlassBadge tone={SEVERITY_TONE[selected.severity]}>{selected.severity}</GlassBadge>
                </div>
                <p className="t-meta mt-1">{MODALITY_LABEL[selected.modality]}, {tc(selected.start)} to {tc(selected.end)}</p>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg-2">{selected.explanation}</p>
                <GlassButton className="mt-4" size="sm" to={`/analysis/${investigation.id}?a=${selected.id}`}>Open in workstation</GlassButton>
              </>
            ) : <p className="t-meta">Select an anomaly on the timeline to read its explanation.</p>}
          </div>
        </GlassPanel>

        <GlassPanel data-reveal as="section" aria-labelledby="tl-signals" pad="lg">
          <div className="mb-5 flex items-baseline justify-between gap-3">
            <h2 id="tl-signals" className="t-label text-fg">Signals at playhead</h2>
            <span className="t-mono text-fg-3">{tc(time)}</span>
          </div>
          <div className="flex flex-col gap-5">
            {MODALITIES.map((m) => {
              const v = Math.round(signals[m] * 100)
              return <GlassProgress key={m} label={MODALITY_LABEL[m]} valueLabel={String(v)} value={v} tone={signalTone(v)} />
            })}
          </div>
          <h3 className="t-label mb-2 mt-8">Active here</h3>
          {here.length ? (
            <ul className="flex flex-col gap-1.5">
              {here.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 text-[0.8125rem] text-fg-2"><span className="truncate">{a.title}</span><span className="t-mono shrink-0 text-fg-3">{a.confidence}%</span></li>)}
            </ul>
          ) : <p className="t-meta">No anomaly at this position.</p>}
        </GlassPanel>

        <GlassPanel data-reveal level={1} as="section" aria-labelledby="tl-events" className="lg:col-span-2 xl:col-span-1">
          <h2 id="tl-events" className="t-label border-b border-line px-5 py-4 text-fg">Anomalies, {SORTED.length}</h2>
          <ul>
            {SORTED.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => jump(a)} aria-pressed={a.id === selectedId}
                  className={cn('row-hover grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/50 px-5 py-3 text-left', a.id === selectedId && 'bg-accent/[0.08]')}>
                  <span className="t-mono text-fg">{tc(a.start)}</span>
                  <span className="min-w-0"><span className="block truncate text-[0.8125rem] text-fg">{a.title}</span><span className="t-label mt-0.5 block text-[0.625rem]">{MODALITY_LABEL[a.modality]}</span></span>
                  <GlassBadge tone={SEVERITY_TONE[a.severity]}>{a.severity}</GlassBadge>
                </button>
              </li>
            ))}
          </ul>
          <details className="group border-t border-line">
            <summary className="t-label cursor-pointer list-none px-5 py-3.5 text-fg-2 hover:text-fg">Frame index, {FRAMES.length} frames</summary>
            <VirtualList label="Frame index" items={FRAMES} rowHeight={30} height={240} className="border-t border-line/60" render={(f) => (
              <button type="button" onClick={() => { pause(); seek(f.index / MEDIA_FPS) }}
                className={cn('row-hover flex h-full w-full items-center gap-4 px-5 text-left', f.index === player.frame && 'bg-accent/[0.1]')}>
                <span className="t-mono w-14 text-fg-2">{String(f.index).padStart(5, '0')}</span>
                <span className="t-mono w-20 text-fg-3">{tc(f.index / MEDIA_FPS)}</span>
                <span aria-hidden className="h-[3px] rounded-full bg-accent" style={{ width: `${Math.max(2, f.peak * 90)}px`, opacity: 0.35 + f.peak * 0.65 }} />
                <span className="sr-only">Peak signal {Math.round(f.peak * 100)}</span>
              </button>
            )} />
          </details>
        </GlassPanel>
      </div>
    </div>
  )
}
