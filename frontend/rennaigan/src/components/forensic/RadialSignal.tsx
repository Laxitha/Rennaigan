import { memo, useRef } from 'react'
import { cn } from '@/lib/cn'
import { d, EASE, ensureFinished, gsap, useGSAP } from '@/lib/motion'
import type { Tone } from '@/types'

const R = 26
const C = 2 * Math.PI * R

export function signalTone(value: number): Tone {
  return value >= 70 ? 'accent' : value >= 40 ? 'warn' : 'neutral'
}
export function signalWord(value: number) {
  return value >= 70 ? 'Strong' : value >= 40 ? 'Moderate' : value > 0 ? 'Weak' : 'Not applicable'
}

interface Props { label: string; value: number; detail?: string; className?: string; size?: number }

/** Radial indicator for one forensic signal. The arc and the number animate together. */
export const RadialSignal = memo(function RadialSignal({ label, value, detail, className, size = 68 }: Props) {
  const arc = useRef<SVGCircleElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const state = useRef({ v: 0 })
  const tone = signalTone(value)

  useGSAP(() => {
    ensureFinished(gsap.to(state.current, {
      v: value, duration: d(0.7), ease: EASE.out, overwrite: true,
      onUpdate: () => {
        const v = state.current.v
        arc.current?.setAttribute('stroke-dashoffset', String(C * (1 - v / 100)))
        if (num.current) num.current.textContent = String(Math.round(v))
      },
    }))
  }, [value])

  return (
    <div data-tone={tone} className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={R} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="3" />
          <circle ref={arc} cx="32" cy="32" r={R} fill="none" stroke="var(--tone)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} />
        </svg>
        <span ref={num} className="t-num absolute inset-0 flex items-center justify-center text-[0.9375rem] font-[540]">0</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-[520] text-fg">{label}</p>
        <p className="t-meta truncate"><span className="tone-text">{signalWord(value)}</span>{detail ? `, ${detail}` : ''}</p>
      </div>
      <span className="sr-only">{label} signal strength {value} of 100</span>
    </div>
  )
})
