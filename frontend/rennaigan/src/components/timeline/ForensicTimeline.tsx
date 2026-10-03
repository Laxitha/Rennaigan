import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { tc } from '@/lib/format'
import { d, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import { MODALITIES, MODALITY_LABEL, signalAt } from '@/data/anomalies'
import { GlassBadge } from '@/components/glass'
import { SEVERITY_TONE } from '@/components/forensic/meta'
import type { Anomaly } from '@/types'

interface Props {
  duration: number
  anomalies: Anomaly[]
  time: number
  selectedId?: string | null
  onSeek?: (t: number) => void
  onSelect?: (a: Anomaly) => void
  /** Static rendering for reports: no playhead interaction. */
  readOnly?: boolean
  className?: string
}

const LANE_H = 36

/** Intensity trace above the lanes: the strongest signal at each moment. */
const IntensityTrace = memo(function IntensityTrace({ duration }: { duration: number }) {
  const path = useMemo(() => {
    const n = 180
    let dAttr = ''
    for (let i = 0; i <= n; i++) {
      const s = signalAt((i / n) * duration)
      const v = Math.max(s.visual, s.audio, s.lipsync, s.temporal)
      dAttr += `${i === 0 ? 'M' : 'L'}${((i / n) * 1000).toFixed(1)},${(30 - v * 26).toFixed(1)} `
    }
    return dAttr
  }, [duration])
  return (
    <svg viewBox="0 0 1000 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden>
      <path d={`${path} L1000,32 L0,32 Z`} fill="url(#trace-fill)" />
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <defs>
        <linearGradient id="trace-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="rgb(255 77 148 / 0.28)" />
          <stop offset="1" stopColor="rgb(255 77 148 / 0)" />
        </linearGradient>
      </defs>
    </svg>
  )
})

export function ForensicTimeline({ duration, anomalies, time, selectedId, onSeek, onSelect, readOnly, className }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The selected anomaly pulses once so the eye lands on it.
  useGSAP(() => {
    if (!selectedId) return
    const ring = root.current?.querySelector(`[data-anomaly="${selectedId}"] [data-ring]`)
    if (ring) fromToSafe(ring, { autoAlpha: 0.9, scaleX: 1, scaleY: 1 }, { autoAlpha: 0, scaleX: 1.25, scaleY: 2.4, duration: d(0.8), ease: EASE.out })
  }, { dependencies: [selectedId], scope: root })

  const ticks = useMemo(() => {
    const step = duration > 120 ? 30 : duration > 45 ? 10 : 5
    const out: number[] = []
    for (let t = 0; t <= duration; t += step) out.push(t)
    return out
  }, [duration])

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly || !onSeek || (e.target as HTMLElement).closest('[data-anomaly]')) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(timeAt(e.clientX))
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current) onSeek?.(timeAt(e.clientX)) }
  const onUp = () => { dragging.current = false }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek || e.target !== e.currentTarget) return
    const stepSize = e.shiftKey ? 1 : 0.2
    if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, time + stepSize)) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, time - stepSize)) }
    else if (e.key === 'Home') { e.preventDefault(); onSeek(0) }
    else if (e.key === 'End') { e.preventDefault(); onSeek(duration) }
  }

  const hovered = anomalies.find((a) => a.id === hover)

  return (
    <div ref={root} className={cn('grid grid-cols-[72px_minmax(0,1fr)] sm:grid-cols-[92px_minmax(0,1fr)]', className)}>
      <div className="flex flex-col">
        <div className="h-8" />
        <div className="h-6" />
        {MODALITIES.map((m) => (
          <div key={m} className="t-label flex items-center border-t border-line/70" style={{ height: LANE_H }}>{MODALITY_LABEL[m]}</div>
        ))}
      </div>

      <div
        ref={track}
        role={readOnly ? undefined : 'slider'} tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly ? undefined : 'Playback position'} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={readOnly ? undefined : tc(time)}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        className={cn('relative touch-none select-none', !readOnly && 'cursor-ew-resize')}
      >
        <IntensityTrace duration={duration} />
        <div className="relative h-6">
          {ticks.map((t) => (
            <span key={t} className="t-mono absolute top-1 -translate-x-1/2 text-[0.6875rem] text-fg-3 first:translate-x-0" style={{ left: `${(t / duration) * 100}%` }}>{tc(t, false)}</span>
          ))}
        </div>
        {MODALITIES.map((m) => (
          <div key={m} className="relative border-t border-line/70" style={{ height: LANE_H }}>
            {ticks.map((t) => <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-white/[0.035]" style={{ left: `${(t / duration) * 100}%` }} />)}
            {anomalies.filter((a) => a.modality === m).map((a) => {
              const selected = a.id === selectedId
              return (
                <button
                  key={a.id} type="button" data-anomaly={a.id} data-tone={a.flagged ? 'accent' : SEVERITY_TONE[a.severity]}
                  disabled={readOnly} aria-pressed={readOnly ? undefined : selected}
                  aria-label={`${a.title}, ${MODALITY_LABEL[a.modality]}, ${a.severity} severity, ${tc(a.start)} to ${tc(a.end)}`}
                  onClick={() => onSelect?.(a)} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(a.id)} onBlur={() => setHover(null)}
                  className={cn('absolute top-1/2 h-4 min-w-[10px] -translate-y-1/2 cursor-pointer rounded-[4px] border transition-[background-color,border-color,height] duration-200 disabled:cursor-default',
                    selected ? 'h-5 border-[color:var(--tone)] bg-[color:var(--tone)]' : 'border-[color:color-mix(in_srgb,var(--tone)_65%,transparent)] bg-[color:color-mix(in_srgb,var(--tone)_30%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--tone)_55%,transparent)]')}
                  style={{ left: `${(a.start / duration) * 100}%`, width: `${((a.end - a.start) / duration) * 100}%` }}
                >
                  <span data-ring aria-hidden className="pointer-events-none invisible absolute inset-0 rounded-[4px] border border-[color:var(--tone)]" />
                </button>
              )
            })}
          </div>
        ))}

        {hovered && (
          <div role="tooltip" data-level="3"
            className="glass pointer-events-none absolute z-20 w-60 -translate-x-1/2 -translate-y-full rounded-[12px] p-3"
            style={{ left: `clamp(120px, ${(((hovered.start + hovered.end) / 2) / duration) * 100}%, calc(100% - 120px))`, top: 56 + MODALITIES.indexOf(hovered.modality) * LANE_H }}>
            <div className="flex items-center justify-between gap-2">
              <span className="t-mono text-fg">{tc(hovered.start)}</span>
              <GlassBadge tone={SEVERITY_TONE[hovered.severity]}>{hovered.severity}</GlassBadge>
            </div>
            <p className="mt-2 text-[0.8125rem] font-[520] text-fg">{hovered.title}</p>
            <p className="t-meta mt-1 line-clamp-3">{hovered.explanation}</p>
          </div>
        )}

        {!readOnly && (
          <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-px bg-fg will-change-transform" style={{ transform: `translateX(${(time / duration) * width}px)` }}>
            <span className="t-mono absolute left-1/2 top-0 -translate-x-1/2 -translate-y-full rounded-[5px] bg-fg px-1.5 py-0.5 text-[0.6875rem] font-[540] text-bg">{tc(time)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
