import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, DotsThree, FileText, Gear, Keyboard, MagnifyingGlass, ShieldCheck, SignOut, Stack, UserCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { d, dist, EASE, ensureFinished, fromToSafe, useGSAP } from '@/lib/motion'
import { useHotkey } from '@/hooks/useHotkey'
import { investigations, PRIMARY_ID } from '@/data/investigations'
import { useBackendHealth, useBackendUrl } from '@/services/backend'
import { api } from '@/services/api'
import type { Investigation } from '@/types'
import {
  ForensicLoader, GlassBadge, GlassCommandPalette, GlassDropdown, GlassModal, GlassSheet, GlassTooltip, useToast, type Command,
} from '@/components/glass'
import { Brand } from './Brand'
import { INVESTIGATION_ROUTE, INVESTIGATION_VIEWS, NAV, SECONDARY } from './routes'

const ANALYST = { name: 'Meenakshi Raghavan', role: 'Senior forensic analyst', initials: 'MR' }
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const NOTIFICATIONS = [
  { id: 'n1', label: 'RG-2026-00124 requires review', hint: '3 flagged intervals, 12 min ago', to: `/review/${PRIMARY_ID}` },
  { id: 'n2', label: 'Bulk batch finished', hint: '14 of 16 files complete', to: '/bulk' },
  { id: 'n3', label: 'Model v2.5.0-rc2 entered evaluation', hint: 'Yesterday, 11:00 UTC', to: '/models' },
]

const SHORTCUTS: Array<[string, string]> = [
  [isMac ? '⌘ K' : 'Ctrl K', 'Open the command palette'],
  ['/', 'Search evidence and cases'],
  ['?', 'Show this list'],
  ['Space', 'Play or pause, in the analysis workstation'],
  ['← →', 'Step one frame'],
  ['1 2 3', 'Jump to a flagged interval'],
]

function InvestigationBar({ pathname }: { pathname: string }) {
  const m = pathname.match(INVESTIGATION_ROUTE)
  if (!m) return null
  const [, segment, id] = m
  return (
    <div className="shell-x no-print">
      <div className="page flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line pb-3 pt-1">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[0.8125rem]">
          <Link to="/cases" className="text-fg-3 transition-colors hover:text-fg">Cases</Link>
          <span aria-hidden className="text-fg-3">/</span>
          <span className="t-mono text-fg">{id}</span>
        </nav>
        <nav aria-label="Investigation views" className="-mx-1 flex min-w-0 basis-full gap-0.5 overflow-x-auto px-1 nav:flex-1 nav:basis-0 nav:justify-end">
          {INVESTIGATION_VIEWS.map((v) => {
            const active = v.segment === segment
            return (
              <Link key={v.segment} to={`/${v.segment}/${id}`} aria-current={active ? 'page' : undefined}
                className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[0.8125rem] font-[520] transition-colors',
                  active ? 'bg-accent/[0.14] text-fg' : 'text-fg-3 hover:bg-white/[0.04] hover:text-fg-2')}>
                <v.icon size={15} weight="light" />{v.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const backendUrl = useBackendUrl()
  const { health } = useBackendHealth(backendUrl)
  const [caseList, setCaseList] = useState<Investigation[]>([])
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [more, setMore] = useState(false)
  const main = useRef<HTMLElement>(null)

  useHotkey('mod+k', (e) => { e.preventDefault(); setPalette((o) => !o) })
  useHotkey('/', (e) => { e.preventDefault(); setPalette(true) })
  useHotkey('?', () => setShortcuts(true))

  // Route transition: content cross-fades and settles upward. Short on purpose so the console stays fast.
  useGSAP(() => {
    window.scrollTo({ top: 0 })
    ensureFinished(fromToSafe(main.current, { autoAlpha: 0, y: dist(10) }, { autoAlpha: 1, y: 0, duration: d(0.36), ease: EASE.out, clearProps: 'transform' }))
  }, [pathname])

  useEffect(() => { setMore(false) }, [pathname])

  useEffect(() => {
    api.investigations().then(setCaseList).catch(() => {})
  }, [pathname])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    const list = caseList.length > 0 ? caseList : investigations
    const latestId = list[0]?.id || PRIMARY_ID
    return [
      { id: 'start', group: 'Actions', label: 'Start investigation', icon: <NAV_ICON i={2} />, keywords: 'upload analyze new media', run: go('/analyze') },
      { id: 'bulk', group: 'Actions', label: 'Bulk verify', icon: <Stack size={16} weight="light" />, keywords: 'batch files queue', run: go('/bulk') },
      { id: 'dash', group: 'Go to', label: 'Go to dashboard', icon: <NAV_ICON i={0} />, keywords: 'overview command center home', run: go('/overview') },
      { id: 'evidence', group: 'Go to', label: 'Search evidence', icon: <NAV_ICON i={3} />, keywords: 'graph nodes', run: go(`/evidence/${latestId}`) },
      { id: 'reports', group: 'Go to', label: 'Open reports', icon: <FileText size={16} weight="light" />, run: go(`/reports/${latestId}`) },
      { id: 'audit', group: 'Go to', label: 'Open audit trail', icon: <ShieldCheck size={16} weight="light" />, keywords: 'hash chain', run: go(`/audit/${latestId}`) },
      { id: 'cases', group: 'Go to', label: 'Open cases', icon: <NAV_ICON i={4} />, run: go('/cases') },
      { id: 'models', group: 'Go to', label: 'Model and forensic knowledge', icon: <SECONDARY_ICON i={0} />, run: go('/models') },
      { id: 'settings', group: 'Go to', label: 'Open settings', icon: <Gear size={16} weight="light" />, keywords: 'preferences motion gateway backend', run: go('/settings') },
      ...list.slice(0, 8).map((inv) => ({
        id: inv.id, group: 'Recent cases', label: `${inv.id}  ${inv.media}`, hint: inv.status, keywords: `${inv.finding} ${inv.analyst}`,
        icon: <FileText size={16} weight="light" />, run: go(`/analysis/${inv.id}`),
      })),
    ]
  }, [navigate, caseList])

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <a href="#main" className="btn sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90]" data-variant="primary">Skip to content</a>

      <header className="shell-x sticky top-0 z-40 py-3 no-print">
        <div data-level="3" className="glass page flex h-[var(--nav-h)] items-center gap-4 rounded-[18px] px-4">
          <Brand to="/overview" />
          <nav aria-label="Primary" className="ml-4 hidden items-center gap-0.5 nav:flex">
            {NAV.map((item) => {
              const active = item.match.test(pathname)
              return (
                <NavLink key={item.to} to={item.to} aria-current={active ? 'page' : undefined}
                  className={cn('relative flex h-9 items-center rounded-[10px] px-3 text-[0.8125rem] font-[520] transition-colors duration-200',
                    active ? 'bg-accent/[0.13] text-fg shadow-[inset_0_0_0_1px_rgb(255_77_148/0.32),0_8px_24px_-12px_rgb(255_77_148/0.6)]' : 'text-fg-3 hover:bg-white/[0.04] hover:text-fg')}>
                  {item.label}
                </NavLink>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden sm:block">
              {health?.status === 'ok' ? (
                <GlassTooltip side="bottom" content={`ML Gateway Connected: ${health.services_up}/${health.services_total} services active (${backendUrl})`}>
                  <span tabIndex={0} className="rounded-[6px]"><GlassBadge tone="ok">ML Gateway: Online</GlassBadge></span>
                </GlassTooltip>
              ) : health?.status === 'degraded' ? (
                <GlassTooltip side="bottom" content={`ML Gateway Active: ${health.services_up}/${health.services_total} services active (metadata detector online)`}>
                  <span tabIndex={0} className="rounded-[6px]"><GlassBadge tone="warn">ML Gateway: Connected</GlassBadge></span>
                </GlassTooltip>
              ) : (
                <GlassTooltip side="bottom" content="Gateway offline. Showing local cases.">
                  <span tabIndex={0} className="rounded-[6px]"><GlassBadge tone="neutral">Local Mode</GlassBadge></span>
                </GlassTooltip>
              )}
            </span>
            <button type="button" onClick={() => setPalette(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K"
              className="btn ml-1 xl:w-52 xl:justify-between xl:px-3" data-icon="true">
              <span className="flex items-center gap-2 text-fg-3"><MagnifyingGlass size={16} weight="light" /><span className="hidden text-[0.8125rem] font-normal xl:inline">Search</span></span>
              <span className="kbd hidden xl:inline-flex">{isMac ? '⌘K' : 'Ctrl K'}</span>
            </button>
            <GlassDropdown label="Notifications" width={300}
              header={<p className="t-label">Notifications</p>}
              trigger={(p) => (
                <button type="button" {...p} aria-label="Notifications, 3 unread" className="btn relative" data-variant="quiet" data-icon="true">
                  <Bell size={18} weight="light" />
                  <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-accent" />
                </button>
              )}
              items={NOTIFICATIONS.map((n) => ({ id: n.id, label: n.label, hint: n.hint, onSelect: () => navigate(n.to) }))} />
            <Link to="/settings" aria-label="Settings" className="btn hidden sm:inline-flex" data-variant="quiet" data-icon="true"><Gear size={18} weight="light" /></Link>
            <GlassDropdown label="Analyst profile"
              header={<div><p className="text-sm font-[540] text-fg">{ANALYST.name}</p><p className="t-meta">{ANALYST.role}</p></div>}
              trigger={(p) => (
                <button type="button" {...p} aria-label={`Analyst profile, ${ANALYST.name}`}
                  className="ml-1 flex size-9 items-center justify-center rounded-full border border-accent/40 bg-accent/[0.14] text-xs font-[560] tracking-wide text-fg transition-[border-color] hover:border-accent-2">
                  {ANALYST.initials}
                </button>
              )}
              items={[
                { id: 'profile', label: 'Profile', icon: <UserCircle size={16} weight="light" />, onSelect: () => navigate('/settings') },
                { id: 'keys', label: 'Keyboard shortcuts', icon: <Keyboard size={16} weight="light" />, onSelect: () => setShortcuts(true) },
                { id: 'out', label: 'Sign out', icon: <SignOut size={16} weight="light" />, onSelect: () => toast({ title: 'Sign-out is disabled in this console session', tone: 'info' }) },
              ]} />
          </div>
        </div>
      </header>

      <InvestigationBar pathname={pathname} />

      <main id="main" ref={main} tabIndex={-1} className="shell-x flex-1 pb-28 pt-6 outline-none nav:pb-16">
        <div className="page">
          <Suspense fallback={<ForensicLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* small screens: bottom navigation with the four core workflows, everything else in a sheet */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] nav:hidden no-print">
        <div data-level="3" className="glass mx-auto flex max-w-md items-stretch justify-between rounded-[18px] p-1.5">
          {[NAV[0], NAV[2], NAV[4], NAV[6]].map((item) => {
            const active = item.match.test(pathname)
            return (
              <NavLink key={item.to} to={item.to} aria-current={active ? 'page' : undefined}
                className={cn('flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[13px] py-2 text-[0.6875rem] font-[520] transition-colors', active ? 'bg-accent/[0.14] text-fg' : 'text-fg-3')}>
                <item.icon size={20} weight="light" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
          <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[13px] py-2 text-[0.6875rem] font-[520] text-fg-3">
            <DotsThree size={20} weight="light" />More
          </button>
        </div>
      </nav>

      <GlassSheet open={more} onClose={() => setMore(false)} title="Navigate">
        <ul className="grid grid-cols-2 gap-2">
          {[...NAV, ...SECONDARY].map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="glass-inner row-hover flex items-center gap-3 px-3.5 py-3 text-sm text-fg">
                <item.icon size={18} weight="light" className="text-fg-3" />{item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="t-meta mt-5">Rennaigan Forensic Suite. Real-time media analysis & audit verification.</p>
      </GlassSheet>

      <GlassCommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />

      <GlassModal open={shortcuts} onClose={() => setShortcuts(false)} title="Keyboard shortcuts" width={440}>
        <dl className="flex flex-col">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-6 border-b border-line/60 py-2.5 last:border-b-0">
              <dt className="text-sm text-fg-2">{label}</dt>
              <dd className="flex gap-1">{keys.split(' ').map((k) => <span key={k} className="kbd">{k}</span>)}</dd>
            </div>
          ))}
        </dl>
      </GlassModal>
    </div>
  )
}

function NAV_ICON({ i }: { i: number }) {
  const Icon = NAV[i].icon
  return <Icon size={16} weight="light" />
}
function SECONDARY_ICON({ i }: { i: number }) {
  const Icon = SECONDARY[i].icon
  return <Icon size={16} weight="light" />
}
