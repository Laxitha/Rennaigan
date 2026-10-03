import { DeviceMobile, FilmStrip, Image as ImageIcon, Waveform } from '@phosphor-icons/react'
import { GlassBadge } from '@/components/glass'
import { cn } from '@/lib/cn'
import type { BulkStatus, CaseStatus, Consistency, Level, MediaType, Severity, Tone } from '@/types'

export const STATUS_META: Record<CaseStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'accent' },
  processing: { label: 'Processing', tone: 'info' },
  review: { label: 'Requires review', tone: 'warn' },
  verified: { label: 'Verified', tone: 'ok' },
  inconclusive: { label: 'Inconclusive', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const BULK_META: Record<BulkStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  analyzing: { label: 'Analyzing', tone: 'accent' },
  review: { label: 'Review', tone: 'warn' },
  complete: { label: 'Complete', tone: 'ok' },
  inconclusive: { label: 'Inconclusive', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
}

export const LEVEL_TONE: Record<Level, Tone> = { low: 'ok', moderate: 'warn', high: 'danger' }
export const SEVERITY_TONE: Record<Severity, Tone> = { low: 'info', medium: 'warn', high: 'danger' }
export const CONSISTENCY_META: Record<Consistency, { label: string; tone: Tone }> = {
  consistent: { label: 'Consistent', tone: 'ok' },
  partial: { label: 'Partly consistent', tone: 'warn' },
  contradicted: { label: 'Contradicted', tone: 'danger' },
  unverified: { label: 'Unverified', tone: 'neutral' },
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const m = STATUS_META[status]
  return <GlassBadge tone={m.tone}>{m.label}</GlassBadge>
}

export function LevelBadge({ level, suffix = '' }: { level: Level; suffix?: string }) {
  return <GlassBadge tone={LEVEL_TONE[level]}>{level}{suffix}</GlassBadge>
}

const MEDIA_ICON = { video: FilmStrip, audio: Waveform, image: ImageIcon, screenshot: DeviceMobile, unknown: FilmStrip } as const

export function MediaGlyph({ type, className, size = 18 }: { type: MediaType; className?: string; size?: number }) {
  const Icon = MEDIA_ICON[type] ?? FilmStrip
  return (
    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white/[0.03] text-fg-2', className)}>
      <Icon size={size} weight="light" aria-label={type} />
    </span>
  )
}

/** Coverage is shown beside confidence everywhere so a score is never read alone. */
export function CoverageBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="relative h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
        <span className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-fg-2" style={{ transform: `scaleX(${value / 100})` }} />
      </span>
      <span className="t-mono text-fg-2">{value}%</span>
    </span>
  )
}
