import { memo, useEffect, useRef, type HTMLAttributes } from 'react'
import { SpeakerHigh } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { mulberry32 } from '@/lib/format'
import type { Anomaly, MediaType, Region } from '@/types'

const W = 640
const H = 360

/** 0-1 intensity of an anomaly at time t. */
export function heatIntensity(a: Anomaly, t: number) {
  // full strength anywhere inside the interval, easing out over 0.45 s on either side
  const outside = t < a.start ? a.start - t : t > a.end ? t - a.end : 0
  const k = Math.max(0, 1 - outside / 0.45)
  return k * k * (3 - 2 * k) * (a.severity === 'high' ? 1 : a.severity === 'medium' ? 0.78 : 0.55)
}

/**
 * Procedural stand-in for decoded media when no real media is loaded.
 */
function drawScene(ctx: CanvasRenderingContext2D, t: number, seed: number) {
  const r = mulberry32(seed)
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#2a2030')
  bg.addColorStop(1, '#120d15')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // out-of-focus background lights
  for (let i = 0; i < 5; i++) {
    const x = r() * W
    const y = r() * H * 0.7
    const rad = 40 + r() * 90
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    const warm = r() > 0.5
    g.addColorStop(0, warm ? 'rgba(255,190,150,0.16)' : 'rgba(150,170,255,0.13)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }

  const sway = Math.sin(t * 0.9) * 5
  const nod = Math.sin(t * 1.7) * 2
  const cx = W / 2 + sway
  const cy = H * 0.37 + nod

  // shoulders
  const sh = ctx.createLinearGradient(0, H * 0.6, 0, H)
  sh.addColorStop(0, '#3d2f42')
  sh.addColorStop(1, '#1c1520')
  ctx.fillStyle = sh
  ctx.beginPath()
  ctx.ellipse(W / 2 + sway * 0.4, H * 1.06, W * 0.3, H * 0.4, 0, Math.PI, 0)
  ctx.fill()

  // neck
  ctx.fillStyle = '#8a6a70'
  ctx.beginPath()
  ctx.roundRect(cx - 22, cy + 52, 44, 62, 14)
  ctx.fill()

  // head
  const skin = ctx.createRadialGradient(cx - 26, cy - 22, 6, cx, cy, 96)
  skin.addColorStop(0, '#e3bdb4')
  skin.addColorStop(0.6, '#b98d8b')
  skin.addColorStop(1, '#7c5c66')
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.ellipse(cx, cy, 58, 76, 0, 0, Math.PI * 2)
  ctx.fill()

  // hair
  ctx.fillStyle = '#1d141a'
  ctx.beginPath()
  ctx.ellipse(cx, cy - 22, 62, 62, 0, Math.PI * 1.02, Math.PI * 1.98)
  ctx.quadraticCurveTo(cx + 30, cy - 46, cx, cy - 44)
  ctx.quadraticCurveTo(cx - 36, cy - 44, cx - 61, cy - 20)
  ctx.fill()

  // eyes
  const blink = Math.sin(t * 0.8 + 1) > 0.985 ? 0.2 : 1
  ctx.fillStyle = 'rgba(52,32,42,0.62)'
  for (const dx of [-21, 21]) {
    ctx.beginPath()
    ctx.ellipse(cx + dx, cy - 6, 7, 3 * blink, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // mouth
  const speak = Math.abs(Math.sin(t * 9.3)) * Math.abs(Math.sin(t * 2.1 + 0.6))
  ctx.fillStyle = 'rgba(84,44,58,0.8)'
  ctx.beginPath()
  ctx.ellipse(cx, cy + 40, 13, 1.6 + speak * 6, 0, 0, Math.PI * 2)
  ctx.fill()

  // vignette
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(6,4,8,0.62)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

function drawHeat(ctx: CanvasRenderingContext2D, t: number, anomalies: Anomaly[], strength: number, isOverlay = false) {
  ctx.clearRect(0, 0, W, H)
  if (!isOverlay) {
    ctx.fillStyle = `rgba(10,7,12,${0.58 * strength})`
    ctx.fillRect(0, 0, W, H)
  }
  ctx.globalCompositeOperation = 'screen'
  for (const a of anomalies) {
    if (!a.region) continue
    const k = heatIntensity(a, t) * strength
    if (k < 0.02) continue
    const cx = (a.region.x + a.region.w / 2) * W
    const cy = (a.region.y + a.region.h / 2) * H
    const rx = Math.max(20, a.region.w * W * 0.78)
    const ry = Math.max(20, a.region.h * H * 0.78)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, `rgba(255,236,200,${0.9 * k})`)
    g.addColorStop(0.28, `rgba(255,120,150,${0.85 * k})`)
    g.addColorStop(0.62, `rgba(217,71,159,${0.55 * k})`)
    g.addColorStop(1, 'rgba(107,29,69,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export interface FrameProps {
  time: number
  seed?: number
  /** 0 hides the heatmap, 1 shows it at full strength. */
  heat?: number
  anomalies?: Anomaly[]
  className?: string
  label?: string
  mediaUrl?: string | null
  mediaType?: MediaType
  heatmapUrl?: string | null
  playing?: boolean
  rate?: number
  isPrimary?: boolean
  onTimeUpdate?: (t: number) => void
  onEnded?: () => void
  onTogglePlay?: () => void
}

export const MediaFrame = memo(function MediaFrame({
  time,
  seed = 124,
  heat = 0,
  anomalies,
  className,
  label,
  mediaUrl,
  mediaType = 'video',
  heatmapUrl,
  playing = false,
  rate = 1,
  isPrimary = false,
  onTimeUpdate,
  onEnded,
  onTogglePlay,
}: FrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heatCanvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // 1. Sync play / pause state
  useEffect(() => {
    const v = videoRef.current
    if (!v || mediaType !== 'video') return
    if (playing && v.paused) {
      v.play().catch(() => {})
    } else if (!playing && !v.paused) {
      v.pause()
    }
  }, [playing, mediaType])

  // 2. Playback speed
  useEffect(() => {
    const v = videoRef.current
    if (v && rate) {
      v.playbackRate = rate
    }
  }, [rate])

  // 3. Time synchronization without locking the video decoder in an infinite seek loop
  useEffect(() => {
    const v = videoRef.current
    if (!v || mediaType !== 'video') return

    // Paused: immediately jump to the requested frame (scrubbing, stepping)
    if (!playing) {
      if (Math.abs(v.currentTime - time) > 0.03) {
        v.currentTime = time
      }
      return
    }

    // Playing: only seek when there's an intentional jump (timeline scrub or anomaly click)
    const diff = Math.abs(v.currentTime - time)
    if (isPrimary) {
      if (diff > 0.6) {
        v.currentTime = time
      }
    } else {
      if (diff > 0.35) {
        v.currentTime = time
      }
    }
  }, [time, playing, mediaType, isPrimary])

  // 4. Primary video drives time clock via RAF for buttery 60fps tracking
  useEffect(() => {
    const v = videoRef.current
    if (!v || !isPrimary || mediaType !== 'video' || !playing) return

    let rafId: number
    const tick = () => {
      if (v && !v.paused) {
        onTimeUpdate?.(v.currentTime)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPrimary, playing, mediaType, onTimeUpdate])

  // Fallback canvas drawing if no real media URL
  useEffect(() => {
    if (!mediaUrl && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        drawScene(ctx, time, seed)
        if (heat > 0 && anomalies) drawHeat(ctx, time, anomalies, heat, false)
      }
    }
  }, [mediaUrl, time, seed, heat, anomalies])

  // Heat overlay canvas when real media exists
  useEffect(() => {
    if (mediaUrl && heatCanvasRef.current) {
      const ctx = heatCanvasRef.current.getContext('2d')
      if (ctx) {
        if (heat > 0 && anomalies && anomalies.length > 0) {
          drawHeat(ctx, time, anomalies, heat, true)
        } else {
          ctx.clearRect(0, 0, W, H)
        }
      }
    }
  }, [mediaUrl, time, heat, anomalies])

  // Case 1: Real Image or Screenshot
  if (mediaUrl && (mediaType === 'image' || mediaType === 'screenshot')) {
    return (
      <div className={cn('relative aspect-video w-full overflow-hidden bg-bg-2 flex items-center justify-center', className)}>
        <img
          src={mediaUrl}
          alt={label ?? 'Uploaded media'}
          className="h-full w-full object-contain"
          crossOrigin="anonymous"
        />
        {heatmapUrl && heat > 0 && (
          <img
            src={heatmapUrl}
            alt="Forensic heatmap overlay"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-screen transition-opacity duration-300"
            style={{ opacity: heat }}
            crossOrigin="anonymous"
          />
        )}
        {heat > 0 && (!heatmapUrl || (anomalies && anomalies.length > 0)) && (
          <canvas
            ref={heatCanvasRef}
            width={W}
            height={H}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>
    )
  }

  // Case 2: Real Video
  if (mediaUrl && mediaType === 'video') {
    return (
      <div className={cn('relative aspect-video w-full overflow-hidden bg-bg-2 flex items-center justify-center group', className)}>
        <video
          ref={videoRef}
          src={mediaUrl}
          className="h-full w-full object-contain cursor-pointer"
          playsInline
          muted
          preload="auto"
          crossOrigin="anonymous"
          onEnded={() => onEnded?.()}
          onClick={() => onTogglePlay?.()}
        />

        {/* Forensic Deepfake Heatmap Overlay */}
        {heatmapUrl && heat > 0 && (
          <img
            src={heatmapUrl}
            alt="Forensic deepfake heatmap overlay"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-screen transition-opacity duration-300"
            style={{ opacity: heat }}
            crossOrigin="anonymous"
          />
        )}

        {/* Dynamic thermal anomaly canvas */}
        {heat > 0 && (
          <canvas
            ref={heatCanvasRef}
            width={W}
            height={H}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>
    )
  }


  // Case 3: Real Audio
  if (mediaUrl && mediaType === 'audio') {
    return (
      <div className={cn('relative aspect-video w-full overflow-hidden bg-bg-2 flex flex-col items-center justify-center p-6 text-center', className)}>
        {heatmapUrl ? (
          <div className="relative w-full max-w-lg overflow-hidden rounded-[10px] border border-line">
            <img src={heatmapUrl} alt="Audio spectrogram" className="h-44 w-full object-cover" crossOrigin="anonymous" />
            <div className="t-mono absolute bottom-2 left-2 rounded bg-bg/80 px-2 py-0.5 text-[0.6875rem] text-accent-3">
              Spectrogram: 16 kHz Signal FFT
            </div>
          </div>
        ) : (
          <div className="flex size-20 items-center justify-center rounded-full border border-line bg-accent/[0.12] text-accent">
            <SpeakerHigh size={36} weight="light" />
          </div>
        )}
        <audio
          src={mediaUrl}
          className="mt-4 w-full max-w-md"
          controls
          crossOrigin="anonymous"
        />
      </div>
    )
  }

  // Fallback: procedural scene
  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      role="img"
      aria-label={label ?? 'Demo media frame'}
      className={cn('block aspect-video w-full bg-bg-2', className)}
    />
  )
})

/** Outline over a suspicious region. Coordinates are normalized to the frame. */
interface RegionProps extends HTMLAttributes<HTMLDivElement> { region: Region; active?: boolean; label?: string }
export function RegionBox({ region, active, label, className, ...rest }: RegionProps) {
  return (
    <div
      {...rest}
      data-region
      className={cn(
        'pointer-events-none absolute rounded-[6px] border transition-[border-color,opacity] duration-300',
        active ? 'border-accent shadow-[0_0_12px_rgba(255,77,148,0.5)]' : 'border-white/50',
        className
      )}
      style={{
        left: `${Math.max(0, Math.min(100, region.x * 100))}%`,
        top: `${Math.max(0, Math.min(100, region.y * 100))}%`,
        width: `${Math.max(2, Math.min(100, region.w * 100))}%`,
        height: `${Math.max(2, Math.min(100, region.h * 100))}%`,
      }}
    >
      {(['-left-px -top-px border-l-2 border-t-2', '-right-px -top-px border-r-2 border-t-2', '-left-px -bottom-px border-l-2 border-b-2', '-right-px -bottom-px border-r-2 border-b-2'] as const).map((c) => (
        <span key={c} className={cn('absolute size-2.5', active ? 'border-accent-3' : 'border-white/70', c)} />
      ))}
      {label && (
        <span className="t-mono absolute -top-6 left-0 whitespace-nowrap rounded-[5px] bg-bg/90 px-1.5 py-0.5 text-[0.6875rem] font-medium text-accent-3 border border-accent/30">
          {label}
        </span>
      )}
    </div>
  )
}
