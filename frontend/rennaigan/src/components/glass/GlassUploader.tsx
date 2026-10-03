import { useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import { FilmStrip, Image as ImageIcon, DeviceMobile, Waveform, UploadSimple } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { d, EASE, fromToSafe, gsap, useGSAP } from '@/lib/motion'

const KINDS = [
  { label: 'Video', icon: FilmStrip },
  { label: 'Audio', icon: Waveform },
  { label: 'Image', icon: ImageIcon },
  { label: 'Screenshot', icon: DeviceMobile },
]

interface UploaderProps {
  title: string
  hint: string
  onFiles: (files: File[]) => void
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
  action?: ReactNode
}

/** Drop zone whose glass surface reacts to the pointer and to a dragged file. */
export function GlassUploader({ title, hint, onFiles, multiple, disabled, compact, action }: UploaderProps) {
  const root = useRef<HTMLDivElement>(null)
  const ripple = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const { contextSafe } = useGSAP({ scope: root })

  const track = (x: number, y: number) => {
    const el = root.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${x - r.left}px`)
    el.style.setProperty('--my', `${y - r.top}px`)
  }

  const setLift = contextSafe((on: boolean) => {
    gsap.to(root.current, { scaleX: on ? 1.012 : 1, scaleY: on ? 1.028 : 1, duration: d(on ? 0.5 : 0.4), ease: on ? EASE.spring : EASE.out, overwrite: true })
  })
  const burst = contextSafe(() => {
    fromToSafe(ripple.current, { scale: 0, autoAlpha: 0.55 }, { scale: 1, autoAlpha: 0, duration: d(0.8), ease: EASE.out })
  })

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    if (disabled) return
    if (depth.current++ === 0) { setDragging(true); setLift(true) }
  }
  const onDragLeave = () => {
    if (--depth.current <= 0) { depth.current = 0; setDragging(false); setLift(false) }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    setLift(false)
    if (disabled) return
    track(e.clientX, e.clientY)
    burst()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      ref={root} data-level={dragging ? 4 : 2} data-dragging={dragging}
      onPointerMove={(e: PointerEvent) => track(e.clientX, e.clientY)}
      onDragEnter={onDragEnter} onDragOver={(e) => { e.preventDefault(); track(e.clientX, e.clientY) }} onDragLeave={onDragLeave} onDrop={onDrop}
      className={cn('glass group/up relative isolate overflow-hidden text-center transition-[border-color,background-color] duration-300', compact ? 'px-6 py-9' : 'px-6 py-16 sm:py-24', disabled && 'opacity-60')}
    >
      {/* pointer-following light */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover/up:opacity-100 group-data-[dragging=true]/up:opacity-100"
        style={{ background: 'radial-gradient(340px circle at var(--mx,50%) var(--my,50%), rgb(255 77 148 / 0.16), transparent 70%)' }} />
      <span ref={ripple} aria-hidden className="pointer-events-none invisible absolute -z-10 size-[520px] rounded-full border border-accent/60 bg-accent/10"
        style={{ left: 'calc(var(--mx,50%) - 260px)', top: 'calc(var(--my,50%) - 260px)' }} />
      {/* animated perimeter */}
      <svg aria-hidden className="pointer-events-none absolute inset-2 size-[calc(100%-16px)] overflow-visible">
        <rect x="0.5" y="0.5" width="100%" height="100%" rx="14" fill="none" strokeWidth="1" strokeDasharray="5 7" vectorEffect="non-scaling-stroke"
          className={cn('transition-[stroke] duration-300', dragging ? 'stroke-accent' : 'stroke-white/15')}
          style={{ animation: dragging ? 'dash-flow 0.7s linear infinite' : undefined }} />
      </svg>

      <div className="relative mx-auto flex max-w-xl flex-col items-center gap-5">
        <div className={cn('flex size-14 items-center justify-center rounded-[16px] border transition-[transform,border-color,color] duration-300 ease-[var(--ease-glass)]',
          dragging ? '-translate-y-1 border-accent/60 text-accent-2' : 'border-line-2 text-fg-2')}>
          <UploadSimple size={24} weight="light" />
        </div>
        <div>
          <h2 className={cn('font-[540] tracking-[-0.02em] text-fg', compact ? 'text-lg' : 'text-xl sm:text-2xl')}>{dragging ? 'Release to begin' : title}</h2>
          <p className="t-meta mt-2 text-[0.875rem]">{hint}</p>
        </div>
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Supported media types">
          {KINDS.map(({ label, icon: Icon }) => (
            <li key={label} className="t-label flex items-center gap-1.5"><Icon size={14} weight="light" />{label}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" className="btn" data-variant="primary" disabled={disabled} onClick={() => input.current?.click()}>
            {multiple ? 'Select files' : 'Select file'}
          </button>
          {action}
        </div>
        <input
          ref={input} type="file" className="sr-only" tabIndex={-1} multiple={multiple} aria-hidden
          accept="video/*,audio/*,image/*"
          onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) { burst(); onFiles(files) } }}
        />
      </div>
    </div>
  )
}
