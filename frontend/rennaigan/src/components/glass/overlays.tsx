import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, Info, Warning, WarningOctagon, X } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import type { Tone } from '@/types'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Shared dialog behaviour: scroll lock, Escape, focus trap and focus restore. */
function useDialog(open: boolean, onClose: () => void, panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !panel.current) return
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!nodes.length) return
      const head = nodes[0]
      const tail = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus() }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, onClose, panel])
}

/* ---------------------------------- Modal --------------------------------- */

interface ModalProps { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; width?: number; bare?: boolean }

export function GlassModal({ open, onClose, title, description, children, footer, width = 520, bare }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(open, onClose, panel)

  useGSAP(() => {
    if (!open) return
    fromToSafe(scrim.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: d(0.24), ease: EASE.soft })
    // opacity, not autoAlpha: visibility:hidden would block the focus move into the dialog
    fromToSafe(panel.current, { opacity: 0, scale: 0.965, y: dist(10) }, { opacity: 1, scale: 1, y: 0, duration: d(0.38), ease: EASE.out })
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-[12vh] max-sm:items-end max-sm:pt-4">
      <div ref={scrim} className="fixed inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-level="3"
        className="glass relative w-full outline-none" style={{ maxWidth: width }}
      >
        {bare ? (
          <>
            <h2 id={titleId} className="sr-only">{title}</h2>
            {children}
          </>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 px-6 pt-5">
              <div>
                <h2 id={titleId} className="t-section">{title}</h2>
                {description && <p className="t-meta mt-1">{description}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close dialog" className="btn" data-variant="quiet" data-size="sm" data-icon="true">
                <X size={16} weight="light" />
              </button>
            </header>
            <div className="px-6 py-5">{children}</div>
            {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">{footer}</footer>}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ----------------------------- Drawer and Sheet ---------------------------- */

interface DrawerProps { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: 'right' | 'left' | 'bottom' }

export function GlassDrawer({ open, onClose, title, children, side = 'right' }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(open, onClose, panel)

  useGSAP(() => {
    if (!open) return
    const from = side === 'bottom' ? { yPercent: 100 } : { xPercent: side === 'right' ? 100 : -100 }
    fromToSafe(scrim.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: d(0.24) })
    fromToSafe(panel.current, from, { xPercent: 0, yPercent: 0, duration: d(0.46), ease: EASE.out })
  }, [open, side])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div ref={scrim} className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-level="3"
        className={cn('glass absolute flex flex-col outline-none',
          side === 'bottom'
            ? 'inset-x-0 bottom-0 max-h-[86dvh] rounded-b-none pb-[env(safe-area-inset-bottom)]'
            : cn('inset-y-0 w-[min(420px,92vw)]', side === 'right' ? 'right-0 rounded-r-none' : 'left-0 rounded-l-none'))}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id={titleId} className="t-section">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close panel" className="btn" data-variant="quiet" data-size="sm" data-icon="true">
            <X size={16} weight="light" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Bottom sheet. Used on small screens where a side drawer would crowd the content. */
export function GlassSheet(props: Omit<DrawerProps, 'side'>) {
  return <GlassDrawer {...props} side="bottom" />
}

/* -------------------------------- Dropdown -------------------------------- */

export interface MenuItem { id: string; label: string; hint?: string; icon?: ReactNode; onSelect: () => void; tone?: Tone }
interface DropdownProps { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: MenuItem[]; label: string; align?: 'left' | 'right'; header?: ReactNode; width?: number }

export function GlassDropdown({ trigger, items, label, align = 'right', header, width = 240 }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useGSAP(() => {
    if (open) fromToSafe(menu.current, { opacity: 0, y: dist(-6), scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: d(0.22), ease: EASE.out })
  }, [open])

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const nodes = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = nodes.indexOf(document.activeElement as HTMLElement)
    nodes[(i + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length]?.focus()
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          ref={menu} role="menu" aria-label={label} data-level="3" style={{ width }}
          className={cn('glass absolute top-full z-[50] mt-2 origin-top rounded-[14px] p-1.5', align === 'right' ? 'right-0' : 'left-0')}
        >
          {header && <div className="border-b border-line px-2.5 pb-2.5 pt-1.5">{header}</div>}
          <div className={header ? 'pt-1.5' : undefined}>
            {items.map((item) => (
              <button
                key={item.id} type="button" role="menuitem" data-tone={item.tone}
                onClick={() => { setOpen(false); item.onSelect() }}
                className="row-hover flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[0.8125rem] text-fg-2 hover:text-fg focus-visible:text-fg"
              >
                {item.icon && <span className="shrink-0 text-fg-3">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate', item.tone && 'tone-text')}>{item.label}</span>
                  {item.hint && <span className="block truncate text-xs text-fg-3">{item.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- Toast --------------------------------- */

interface Toast { id: number; title: string; description?: string; tone?: Tone }
const ToastContext = createContext<((t: Omit<Toast, 'id'>) => void) | null>(null)
const TOAST_ICON = { ok: CheckCircle, warn: Warning, danger: WarningOctagon, info: Info, accent: Info, neutral: Info } as const

function ToastCard({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const Icon = TOAST_ICON[toast.tone ?? 'neutral']
  useGSAP(() => {
    fromToSafe(ref.current, { autoAlpha: 0, y: dist(12), scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: d(0.36), ease: EASE.out })
  }, [])
  useEffect(() => {
    const t = setTimeout(onDone, 4200)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div ref={ref} data-level="3" data-tone={toast.tone ?? 'neutral'} className="glass pointer-events-auto flex w-[min(360px,calc(100vw-32px))] items-start gap-3 rounded-[14px] p-3.5">
      <Icon size={18} weight="light" className="tone-text mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-[540] text-fg">{toast.title}</p>
        {toast.description && <p className="t-meta mt-0.5">{toast.description}</p>}
      </div>
      <button type="button" onClick={onDone} aria-label="Dismiss notification" className="text-fg-3 hover:text-fg"><X size={14} weight="light" /></button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)
  const push = useCallback((t: Omit<Toast, 'id'>) => setToasts((list) => [...list.slice(-2), { ...t, id: next.current++ }]), [])
  const remove = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const handlers = useMemo(() => new Map<number, () => void>(), [])
  const doneFor = (id: number) => {
    if (!handlers.has(id)) handlers.set(id, () => { handlers.delete(id); remove(id) })
    return handlers.get(id)!
  }
  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 nav:bottom-6 nav:items-end nav:pr-6">
          {toasts.map((t) => <ToastCard key={t.id} toast={t} onDone={doneFor(t.id)} />)}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
