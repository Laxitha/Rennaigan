import { memo, useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { mulberry32, tc } from '@/lib/format'

interface Props { start: number; end: number; time: number; flagStart: number; flagEnd: number; className?: string }

const COLS = 220
const ROWS = 44

/** Procedural spectrogram for the demo clip. Inside the flagged span the high band is empty. */
export const Spectrogram = memo(function Spectrogram({ start, end, time, flagStart, flagEnd, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const r = mulberry32(Math.round(start * 100) + 7)
    ctx.clearRect(0, 0, COLS, ROWS)
    for (let x = 0; x < COLS; x++) {
      const t = start + (x / COLS) * (end - start)
      const inFlag = t >= flagStart && t <= flagEnd
      const voiced = Math.abs(Math.sin(t * 9.3)) * Math.abs(Math.sin(t * 2.1 + 0.6))
      for (let y = 0; y < ROWS; y++) {
        const f = 1 - y / ROWS // 0 low, 1 high
        const formant = Math.exp(-((f - 0.16) ** 2) / 0.004) + 0.8 * Math.exp(-((f - 0.36 - 0.05 * Math.sin(t * 3)) ** 2) / 0.006) + 0.5 * Math.exp(-((f - 0.58) ** 2) / 0.01)
        let e = (formant * (0.35 + voiced) + (1 - f) * 0.18) * (0.75 + r() * 0.5)
        if (f > 0.68) e *= inFlag ? 0.04 : 0.55
        if (inFlag) e = e * 0.82 + 0.05
        const a = Math.min(1, e)
        ctx.fillStyle = a > 0.62 ? `rgba(255,214,232,${a})` : `rgba(255,77,148,${a * 0.9})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }, [start, end, flagStart, flagEnd])

  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - start) / (end - start)) * 100))}%`
  return (
    <div className={cn('relative', className)}>
      <canvas ref={ref} width={COLS} height={ROWS} role="img" aria-label={`Audio spectrogram from ${tc(start)} to ${tc(end)}. High-band energy is missing in the flagged span.`}
        className="block h-24 w-full rounded-[10px] bg-bg" style={{ imageRendering: 'pixelated' }} />
      <span aria-hidden className="absolute inset-y-0 rounded-[4px] border border-accent/70 bg-accent/[0.06]" style={{ left: pct(flagStart), width: `calc(${pct(flagEnd)} - ${pct(flagStart)})` }} />
      <span aria-hidden className="absolute inset-y-0 w-px bg-fg" style={{ left: pct(time) }} />
      <div className="t-mono mt-1.5 flex justify-between text-[0.6875rem] text-fg-3"><span>{tc(start)}</span><span>0 to 12 kHz</span><span>{tc(end)}</span></div>
    </div>
  )
})
