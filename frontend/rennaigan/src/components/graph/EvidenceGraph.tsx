import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ArrowsIn, Minus, Plus } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { d, EASE, gsap, useGSAP } from '@/lib/motion'
import { GRAPH_VIEW, graphEdges, graphNodes } from '@/data/graph'
import type { GraphKind, GraphNode } from '@/types'

const NW = 152
const NH = 48
const { w: VW, h: VH } = GRAPH_VIEW

const KIND_STYLE: Record<GraphKind, { fill: string; stroke: string; text: string }> = {
  media: { fill: 'rgb(255 77 148 / 0.16)', stroke: 'rgb(255 134 183 / 0.75)', text: '#fff' },
  modality: { fill: 'rgb(255 255 255 / 0.05)', stroke: 'rgb(255 214 232 / 0.22)', text: '#f7f2f5' },
  feature: { fill: 'rgb(255 255 255 / 0.035)', stroke: 'rgb(255 214 232 / 0.16)', text: '#f7f2f5' },
  external: { fill: 'rgb(126 195 255 / 0.08)', stroke: 'rgb(126 195 255 / 0.45)', text: '#f7f2f5' },
  anomaly: { fill: 'rgb(243 184 96 / 0.09)', stroke: 'rgb(243 184 96 / 0.5)', text: '#f7f2f5' },
  finding: { fill: 'rgb(217 71 159 / 0.14)', stroke: 'rgb(217 71 159 / 0.6)', text: '#fff' },
  fusion: { fill: 'rgb(255 77 148 / 0.22)', stroke: 'rgb(255 134 183 / 0.9)', text: '#fff' },
  assessment: { fill: 'rgb(255 77 148 / 0.3)', stroke: '#ffc2da', text: '#fff' },
}

export const KIND_LABEL: Record<GraphKind, string> = {
  media: 'Source media', modality: 'Modality', feature: 'Extracted feature', external: 'External evidence',
  anomaly: 'Anomaly', finding: 'Forensic finding', fusion: 'Evidence fusion', assessment: 'Assessment',
}

const byId = new Map(graphNodes.map((n) => [n.id, n]))

/** Every node upstream and downstream of id: the evidence path that passes through it. */
export function connected(id: string) {
  const set = new Set([id])
  const walk = (from: string, dir: 'up' | 'down') => {
    for (const e of graphEdges) {
      const next = dir === 'down' && e.from === from ? e.to : dir === 'up' && e.to === from ? e.from : null
      if (next && !set.has(next)) { set.add(next); walk(next, dir) }
    }
  }
  walk(id, 'up')
  walk(id, 'down')
  return set
}

function edgePath(a: GraphNode, b: GraphNode) {
  const x1 = a.x + NW / 2
  const x2 = b.x - NW / 2
  const mx = (x1 + x2) / 2
  return `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`
}

interface Props {
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Nodes to emphasise when nothing is hovered or selected, e.g. the path behind one anomaly. */
  highlightPath?: string[] | null
  /** Hide everything outside the active path. */
  isolate?: boolean
  query?: string
  /** Pan the view to this node when it changes. */
  focusId?: string | null
  interactive?: boolean
  className?: string
}

export const EvidenceGraph = memo(function EvidenceGraph({ selectedId, onSelect, highlightPath, isolate, query, focusId, interactive = true, className }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const layer = useRef<SVGGElement>(null)
  const view = useRef({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { contextSafe } = useGSAP({ scope: svg })

  const apply = useCallback(() => {
    const v = view.current
    layer.current?.setAttribute('transform', `translate(${v.x.toFixed(2)} ${v.y.toFixed(2)}) scale(${v.k.toFixed(4)})`)
  }, [])

  const animateTo = contextSafe((x: number, y: number, k: number) => {
    gsap.to(view.current, { x, y, k, duration: d(0.6), ease: EASE.out, onUpdate: apply, overwrite: true })
  })

  const home = useCallback(() => {
    const narrow = (svg.current?.clientWidth ?? 1000) < 700
    return narrow ? { x: 30, y: VH / 2 - 320 * 2.1, k: 2.1 } : { x: 0, y: 0, k: 1 }
  }, [])

  const reset = useCallback(() => { const h = home(); animateTo(h.x, h.y, h.k) }, [home, animateTo])
  const zoomBy = useCallback((factor: number, cx = VW / 2, cy = VH / 2) => {
    const v = view.current
    const k = Math.min(3.2, Math.max(0.6, v.k * factor))
    const ratio = k / v.k
    animateTo(cx - (cx - v.x) * ratio, cy - (cy - v.y) * ratio, k)
  }, [animateTo])

  useEffect(() => {
    if (!interactive) return
    Object.assign(view.current, home())
    apply()
  }, [interactive, home, apply])

  useEffect(() => {
    if (!focusId) return
    const n = byId.get(focusId)
    if (!n) return
    const k = Math.max(view.current.k, (svg.current?.clientWidth ?? 1000) < 700 ? 2.1 : 1.35)
    animateTo(VW / 2 - n.x * k, VH / 2 - n.y * k, k)
  }, [focusId, animateTo])

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = svg.current
    if (!el || !interactive) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 40) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const unit = Math.max(VW / r.width, VH / r.height)
      zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, (e.clientX - r.left) * unit, (e.clientY - r.top) * unit)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [interactive, zoomBy])

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = drag.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.moved && Math.hypot(dx, dy) < 4) return
    if (!g.moved) { g.moved = true; e.currentTarget.setPointerCapture(e.pointerId) }
    const r = e.currentTarget.getBoundingClientRect()
    const unit = Math.max(VW / r.width, VH / r.height)
    gsap.killTweensOf(view.current)
    view.current.x += dx * unit
    view.current.y += dy * unit
    g.x = e.clientX
    g.y = e.clientY
    apply()
  }
  const onUp = () => { setTimeout(() => { drag.current = null }, 0) }

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget) return
    const pan = 60
    if (e.key === '+' || e.key === '=') zoomBy(1.25)
    else if (e.key === '-') zoomBy(0.8)
    else if (e.key === '0') reset()
    else if (e.key === 'ArrowLeft') animateTo(view.current.x + pan, view.current.y, view.current.k)
    else if (e.key === 'ArrowRight') animateTo(view.current.x - pan, view.current.y, view.current.k)
    else if (e.key === 'ArrowUp') animateTo(view.current.x, view.current.y + pan, view.current.k)
    else if (e.key === 'ArrowDown') animateTo(view.current.x, view.current.y - pan, view.current.k)
    else return
    e.preventDefault()
  }

  const active = useMemo(() => {
    if (hover) return connected(hover)
    if (selectedId) return connected(selectedId)
    if (highlightPath?.length) return new Set(highlightPath)
    const q = query?.trim().toLowerCase()
    if (q) return new Set(graphNodes.filter((n) => `${n.label} ${n.ref} ${KIND_LABEL[n.kind]}`.toLowerCase().includes(q)).map((n) => n.id))
    return null
  }, [hover, selectedId, highlightPath, query])
  const pathMode = !!(hover || selectedId || highlightPath?.length)

  return (
    <div className={cn('relative', className)}>
      <svg
        ref={svg} viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet"
        role={interactive ? 'application' : 'img'} tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? 'Evidence graph. Arrow keys pan, plus and minus zoom, zero resets. Tab moves between nodes.' : 'Evidence graph: media, modalities, features, anomalies and findings flowing into evidence fusion'}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        onClick={(e) => { if (interactive && e.target === e.currentTarget && !drag.current?.moved) onSelect?.(null) }}
        className={cn('block size-full select-none', interactive && 'cursor-grab touch-none active:cursor-grabbing')}
      >
        <g ref={layer}>
          {graphEdges.map((e) => {
            const a = byId.get(e.from)!
            const b = byId.get(e.to)!
            const on = !!active && active.has(e.from) && active.has(e.to) && pathMode
            const dim = !!active && !on
            return (
              <path key={`${e.from}-${e.to}`} d={edgePath(a, b)} fill="none" vectorEffect="non-scaling-stroke"
                stroke={on ? 'var(--color-accent-2)' : 'rgb(255 214 232 / 0.2)'} strokeWidth={on ? 1.6 : 1}
                strokeDasharray={on ? '6 6' : undefined}
                style={{ opacity: dim ? (isolate ? 0 : 0.25) : 1, transition: 'opacity 320ms, stroke 320ms', animation: on ? 'dash-flow 0.9s linear infinite' : undefined }} />
            )
          })}
          {graphNodes.map((n) => {
            const s = KIND_STYLE[n.kind]
            const on = !active || active.has(n.id)
            const selected = n.id === selectedId
            const hidden = !on && isolate
            return (
              <g
                key={n.id} data-node={n.id} transform={`translate(${n.x - NW / 2} ${n.y - NH / 2})`}
                role={interactive ? 'button' : undefined} tabIndex={interactive && !hidden ? 0 : undefined}
                aria-label={interactive ? `${n.label}, ${KIND_LABEL[n.kind]}, ${n.ref}` : undefined} aria-pressed={interactive ? selected : undefined}
                onPointerEnter={interactive ? () => setHover(n.id) : undefined} onPointerLeave={interactive ? () => setHover(null) : undefined}
                onFocus={interactive ? () => setHover(n.id) : undefined} onBlur={interactive ? () => setHover(null) : undefined}
                onClick={interactive ? () => { if (!drag.current?.moved) onSelect?.(selected ? null : n.id) } : undefined}
                onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(selected ? null : n.id) } } : undefined}
                style={{ opacity: hidden ? 0 : on ? 1 : 0.28, transition: 'opacity 320ms', cursor: interactive ? 'pointer' : undefined, pointerEvents: hidden ? 'none' : undefined, outline: 'none' }}
                className="group/node"
              >
                {selected && <rect x={-5} y={-5} width={NW + 10} height={NH + 10} rx={16} fill="none" stroke="var(--color-accent)" strokeOpacity={0.55} strokeDasharray="3 5" />}
                <rect width={NW} height={NH} rx={12} fill="#120c14" />
                <rect width={NW} height={NH} rx={12} fill={s.fill} stroke={selected ? '#ffc2da' : s.stroke} strokeWidth={selected ? 1.6 : 1}
                  className="transition-[stroke] duration-200 group-hover/node:stroke-[#ffc2da] group-focus-visible/node:stroke-[#ffc2da]" />
                <text x={12} y={20} fill={s.text} fontSize={12.5} fontWeight={540} letterSpacing="-0.01em">{n.label}</text>
                <text x={12} y={36} fill="#8b7f8a" fontSize={10} fontFamily="var(--font-mono)">{n.ref}</text>
                {n.weight !== undefined && <rect x={12} y={NH - 4} width={(NW - 24) * n.weight} height={1.5} rx={1} fill="var(--color-warn)" />}
              </g>
            )
          })}
        </g>
      </svg>
      {interactive && (
        <div className="absolute bottom-3 right-3 flex gap-1">
          <button type="button" className="btn" data-size="sm" data-icon="true" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Minus size={14} weight="light" /></button>
          <button type="button" className="btn" data-size="sm" data-icon="true" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={14} weight="light" /></button>
          <button type="button" className="btn" data-size="sm" data-icon="true" aria-label="Reset view" onClick={reset}><ArrowsIn size={14} weight="light" /></button>
        </div>
      )}
    </div>
  )
})
