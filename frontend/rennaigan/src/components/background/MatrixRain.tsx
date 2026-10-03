import { useEffect, useRef } from 'react'
import { usePrefs } from '@/hooks/usePrefs'

interface Stream { x: number; y: number; speed: number; len: number; layer: 0 | 1 | 2; glyphs: number[]; mutateIn: number; bright: boolean }

/** far, mid, near. Near is larger, faster, brighter and much sparser. */
const LAYERS = [
  { size: 11, alpha: 0.13, speed: [12, 24], len: [8, 18], share: 0.56, parallax: 0.015 },
  { size: 14, alpha: 0.2, speed: [26, 44], len: [6, 14], share: 0.32, parallax: 0.035 },
  { size: 21, alpha: 0.2, speed: [48, 78], len: [4, 9], share: 0.1, parallax: 0.07 },
] as const

const FRAME_MS = 1000 / 30
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function lowPower() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4
}

/**
 * Signature background: sparse pink number rain on one canvas.
 * 30 fps cap, DPR cap, pauses when the tab is hidden, static frame under reduced motion.
 */
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null)
  const { prefs, reduced } = usePrefs()
  const enabled = prefs.effects

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !enabled) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let w = 0
    let h = 0
    let streams: Stream[] = []
    let raf = 0
    let last = 0
    let acc = 0
    const budget = lowPower() ? 0.5 : 1

    const spawn = (layer: 0 | 1 | 2, initial: boolean): Stream => {
      const L = LAYERS[layer]
      const len = Math.round(rand(L.len[0], L.len[1]))
      return {
        x: Math.round(rand(0, w) / 24) * 24,
        y: initial ? rand(-h * 0.2, h * 1.1) : -rand(0, h * 0.4),
        speed: rand(L.speed[0], L.speed[1]),
        len, layer,
        glyphs: Array.from({ length: len }, () => Math.floor(Math.random() * 10)),
        mutateIn: rand(0.3, 1.4),
        bright: Math.random() < 0.14,
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      // Adaptive count: one stream per ~46px of width, clamped, then split across depth layers.
      const total = Math.round(Math.min(64, Math.max(9, w / 46)) * budget)
      streams = []
      LAYERS.forEach((L, i) => {
        const n = Math.max(2, Math.round(total * L.share))
        for (let k = 0; k < n; k++) streams.push(spawn(i as 0 | 1 | 2, true))
      })
      draw(0)
    }

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h)
      const scroll = window.scrollY
      for (let layer = 0; layer < 3; layer++) {
        const L = LAYERS[layer]
        const step = L.size * 1.32
        ctx.font = `${L.size}px "Geist Mono Variable", ui-monospace, monospace`
        for (const s of streams) {
          if (s.layer !== layer) continue
          s.y += s.speed * dt
          s.mutateIn -= dt
          if (s.mutateIn <= 0) {
            s.glyphs[Math.floor(Math.random() * s.len)] = Math.floor(Math.random() * 10)
            s.mutateIn = rand(0.25, 1.1)
          }
          const headY = s.y - scroll * L.parallax
          if (headY - s.len * step > h) { Object.assign(s, spawn(s.layer, false)); continue }
          for (let i = 0; i < s.len; i++) {
            const y = headY - i * step
            if (y < -step || y > h) continue
            const fall = 1 - i / s.len
            if (i === 0) {
              ctx.fillStyle = `rgba(255, 214, 232, ${Math.min(0.5, L.alpha * (s.bright ? 2.4 : 1.8))})`
              if (s.bright && layer === 2) { ctx.shadowColor = 'rgba(255, 77, 148, 0.9)'; ctx.shadowBlur = 14 }
            } else {
              ctx.fillStyle = `rgba(255, 77, 148, ${L.alpha * fall * fall})`
            }
            ctx.fillText(String(s.glyphs[i]), s.x, y)
            if (i === 0) ctx.shadowBlur = 0
          }
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const delta = now - last
      last = now
      acc += delta
      if (acc < FRAME_MS) return
      draw(Math.min(acc, 100) / 1000)
      acc = 0
    }
    const start = () => { if (!raf && !reduced && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop) } }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    const onVisibility = () => (document.hidden ? stop() : start())

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); ro.disconnect(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [enabled, reduced])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden no-print">
      {enabled && <canvas ref={ref} className="size-full" />}
      {/* keeps the reading area calm: rain stays visible at the edges, quieter behind content */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_75%_at_50%_45%,rgb(10_7_12/0.78),rgb(10_7_12/0.3)_70%,transparent)]" />
    </div>
  )
}
