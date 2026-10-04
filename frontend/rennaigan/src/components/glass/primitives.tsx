import {
  forwardRef, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref,
} from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { motionState } from '@/lib/motion'
import type { Tone } from '@/types'

/* ------------------------------ Panel / Card ------------------------------ */

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Glass depth: 1 ambient, 2 interactive, 3 focused forensic, 4 critical evidence. */
  level?: 1 | 2 | 3 | 4
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'li' | 'nav'
  pad?: boolean | 'lg'
  hover?: boolean
}

export const GlassPanel = forwardRef<HTMLElement, PanelProps>(function GlassPanel(
  { level = 2, as = 'div', pad = false, hover = false, className, ...rest }, ref,
) {
  const Tag = as as 'div'
  return (
    <Tag
      ref={ref as Ref<HTMLDivElement>}
      data-level={level}
      className={cn('glass', pad === 'lg' ? 'pad-lg' : pad && 'pad', hover && 'glass-hover', className)}
      {...rest}
    />
  )
})

export const GlassCard = forwardRef<HTMLElement, PanelProps>(function GlassCard(props, ref) {
  return <GlassPanel ref={ref} pad hover {...props} />
})

/* --------------------------------- Button --------------------------------- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'quiet' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  trailing?: ReactNode
  iconOnly?: boolean
  loading?: boolean
  /** Renders a router link styled as a button. */
  to?: string
}

export const GlassButton = forwardRef<HTMLButtonElement, ButtonProps>(function GlassButton(
  { variant = 'default', size = 'md', icon, trailing, iconOnly, loading, to, className, children, disabled, ...rest }, ref,
) {
  const content = (
    <>
      {loading ? <span className="size-3.5 rounded-full border border-white/30 border-t-white animate-spin" aria-hidden /> : icon}
      {!iconOnly && children}
      {trailing}
    </>
  )
  const shared = { 'data-variant': variant, 'data-size': size, 'data-icon': iconOnly ? 'true' : undefined, className: cn('btn', className) }
  if (to) {
    return <Link to={to} {...shared} aria-label={rest['aria-label']}>{content}</Link>
  }
  return (
    <button ref={ref} type="button" disabled={disabled || loading} aria-busy={loading || undefined} {...shared} {...rest}>
      {content}
    </button>
  )
})

/* ---------------------------------- Input --------------------------------- */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  leading?: ReactNode
  hideLabel?: boolean
}

export const GlassInput = forwardRef<HTMLInputElement, InputProps>(function GlassInput(
  { label, hint, error, leading, hideLabel, className, id, ...rest }, ref,
) {
  const auto = useId()
  const fieldId = id ?? auto
  const descId = hint || error ? `${fieldId}-desc` : undefined
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && <label htmlFor={fieldId} className={cn('t-label', hideLabel && 'sr-only')}>{label}</label>}
      <div className="relative">
        {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3">{leading}</span>}
        <input
          ref={ref} id={fieldId} className={cn('field', leading ? 'pl-9' : undefined)}
          aria-invalid={error ? true : undefined} aria-describedby={descId} {...rest}
        />
      </div>
      {(error || hint) && (
        <p id={descId} className={cn('t-meta', error && 'text-danger')}>{error ?? hint}</p>
      )}
    </div>
  )
})

/* ---------------------------------- Badge --------------------------------- */

export function GlassBadge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span data-tone={tone} className={cn('badge', className)}>{children}</span>
}

/* --------------------------------- Metric --------------------------------- */

export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  // The number is evidence, the animation is not. React owns the text and it starts at the real
  // value; the count-up only runs while frames are actually being drawn, and a timer ends it.
  const [shown, setShown] = useState(value)
  useEffect(() => {
    setShown(value)
    if (motionState.reduced || document.hidden || !value) return
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / 900)
      setShown(value * (1 - Math.pow(1 - t, 4)))
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    const settle = setTimeout(() => { cancelAnimationFrame(frame); setShown(value) }, 1200)
    return () => { cancelAnimationFrame(frame); clearTimeout(settle) }
  }, [value])
  return <span className={cn('t-num', className)}>{fmt(shown)}</span>
}

interface MetricProps { label: string; value: number; suffix?: string; hint?: string; tone?: Tone; decimals?: number; className?: string }
export function GlassMetric({ label, value, suffix, hint, tone, decimals, className }: MetricProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="t-label">{label}</span>
      <span className="flex items-baseline gap-1">
        <CountUp value={value} decimals={decimals} className="text-[2.25rem] font-[520] leading-none" />
        {suffix && <span className="text-lg text-fg-2">{suffix}</span>}
      </span>
      {hint && <span data-tone={tone} className={cn('t-meta', tone && 'tone-text')}>{hint}</span>}
    </div>
  )
}

/* -------------------------------- Progress -------------------------------- */

interface ProgressProps { value: number; label?: string; valueLabel?: string; tone?: Tone; className?: string }
export function GlassProgress({ value, label, valueLabel, tone = 'accent', className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div data-tone={tone} className={cn('flex flex-col gap-2', className)}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <span className="text-[0.8125rem] text-fg-2">{label}</span>}
          {valueLabel && <span className="t-mono text-fg">{valueLabel}</span>}
        </div>
      )}
      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)} aria-label={label}
        className="relative h-[3px] overflow-hidden rounded-full bg-white/[0.07]"
      >
        <div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-out-expo)]"
          style={{ transform: `scaleX(${clamped / 100})`, background: 'linear-gradient(90deg, color-mix(in srgb, var(--tone) 55%, transparent), var(--tone))' }}
        />
      </div>
    </div>
  )
}

/* ---------------------------------- Tabs ---------------------------------- */

export interface TabItem<T extends string> { id: T; label: string; count?: number }
interface TabsProps<T extends string> { items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string }

export function GlassTabs<T extends string>({ items, value, onChange, label, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState({ x: 0, w: 0 })

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (el) setBar({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, items])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const item = items[(next + items.length) % items.length]
    onChange(item.id)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${item.id}"]`)?.focus())
  }

  return (
    <div className={cn('max-w-full overflow-x-auto', className)}>
      <div
        ref={listRef} role="tablist" aria-label={label} onKeyDown={onKey}
        className="relative inline-flex h-10 items-center gap-1 rounded-[12px] border border-line bg-white/[0.03] p-1"
      >
        <span
          aria-hidden
          className="absolute left-0 top-1 h-8 rounded-[9px] border border-accent/40 bg-accent/[0.14] transition-[transform,width] duration-300 ease-[var(--ease-glass)]"
          style={{ transform: `translateX(${bar.x}px)`, width: bar.w }}
        />
        {items.map((t) => {
          const active = t.id === value
          return (
            <button
              key={t.id} type="button" role="tab" data-tab={t.id} aria-selected={active} tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn('relative z-[1] flex h-8 items-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-[0.8125rem] font-[520] transition-colors',
                active ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
            >
              {t.label}
              {t.count !== undefined && <span className="t-mono text-[0.6875rem] text-fg-3">{t.count}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* --------------------------------- Tooltip -------------------------------- */

export function GlassTooltip({ content, children, side = 'top', align = 'center' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom'; align?: 'start' | 'center' | 'end' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'glass pointer-events-none absolute z-[70] w-max max-w-[220px] rounded-[10px] px-2.5 py-1.5 text-xs text-fg-2 opacity-0 transition-[opacity,transform] duration-200',
          align === 'center' && 'left-1/2 -translate-x-1/2', align === 'start' && 'left-0', align === 'end' && 'right-0',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2 translate-y-1 group-hover/tt:translate-y-0' : 'top-full mt-2 -translate-y-1 group-hover/tt:translate-y-0',
        )}
        data-level="3"
      >
        {content}
      </span>
    </span>
  )
}

/* ------------------------------- Switch / Seg ------------------------------ */

export function GlassSwitch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-[520] text-fg">{label}</label>
        {description && <p className="t-meta mt-0.5">{description}</p>}
      </div>
      <button
        id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
          checked ? 'border-accent/60 bg-accent/30' : 'border-line-2 bg-white/[0.05]')}
      >
        <span className={cn('absolute left-[3px] top-[3px] size-4 rounded-full bg-fg transition-transform duration-300 ease-[var(--ease-glass)]', checked && 'translate-x-5')} />
      </button>
    </div>
  )
}
