import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowClockwise, ArrowRight, FileX, Trash } from '@phosphor-icons/react'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { revealIn, useGSAP } from '@/lib/motion'
import { bytes } from '@/lib/format'
import { analyzeFile, BackendError, explainError, useBackendUrl } from '@/services/backend'
import { EmptyState, GlassBadge, GlassButton, GlassMetric, GlassPanel, GlassUploader, useToast } from '@/components/glass'
import { BULK_META, CoverageBar, LevelBadge, MediaGlyph } from '@/components/forensic/meta'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { BulkItem, BulkStatus, CaseFull, MediaType } from '@/types'

const MAX_FILES = 20
/** Matches gateway.max_concurrent_analyses in config.yaml. */
const CONCURRENCY = 2
const FINAL: BulkStatus[] = ['complete', 'review', 'inconclusive', 'failed']

function typeOf(name: string): BulkItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mov', 'webm', 'mkv', 'ts', 'avi', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'].includes(ext)) return 'audio'
  if (['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'bmp', 'heic'].includes(ext)) return /screen|capture/i.test(name) ? 'screenshot' : 'image'
  return 'unsupported'
}

/** Map the gateway's verdict for one file onto the queue row. */
function outcome(c: CaseFull): Pick<BulkItem, 'status' | 'indicators' | 'evidence' | 'caseId'> {
  const evidence = Math.round((c.evidence_weight ?? 0) * 100)
  if (c.label === 'Inconclusive') return { status: 'inconclusive', indicators: null, evidence, caseId: c.id }
  if (c.label === 'Low risk') return { status: 'complete', indicators: 'low', evidence, caseId: c.id }
  return { status: 'review', indicators: c.label === 'High manipulation indicators' ? 'high' : 'moderate', evidence, caseId: c.id }
}

/** The gateway's own explanation when it gave one, otherwise a short description of the failure. */
function failureReason(e: unknown): string {
  if (e instanceof BackendError && e.body) {
    try { const detail = JSON.parse(e.body).detail; if (typeof detail === 'string') return detail } catch { /* not JSON */ }
  }
  return explainError(e).title
}

const newBatchId = () => `BT-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')}`

let nextId = 1

export default function Bulk() {
  const scope = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const backendUrl = useBackendUrl()
  const [items, setItems] = useState<BulkItem[]>([])
  const files = useRef(new Map<string, File>())
  const inflight = useRef(new Map<string, AbortController>())
  const batchId = useRef(newBatchId())
  usePageReveal(scope, [items.length > 0])

  const patch = (id: string, p: Partial<BulkItem>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)))

  const add = (incoming: File[]) => {
    const room = MAX_FILES - items.length
    if (room <= 0) { toast({ title: 'Queue is full', description: `A batch holds up to ${MAX_FILES} files. Clear the queue to add more.`, tone: 'warn' }); return }
    if (incoming.length > room) toast({ title: `${incoming.length - room} files were not added`, description: `A batch holds up to ${MAX_FILES} files.`, tone: 'warn' })
    const made = incoming.slice(0, room).map((file): BulkItem => {
      const type = typeOf(file.name)
      const id = `BF-${String(nextId++).padStart(4, '0')}`
      if (type !== 'unsupported') files.current.set(id, file)
      return { id, name: file.name, type, sizeBytes: file.size, status: type === 'unsupported' ? 'failed' : 'queued', progress: 0, indicators: null, evidence: null }
    })
    setItems((cur) => [...cur, ...made])
  }

  const busy = items.some((i) => !FINAL.includes(i.status))

  // Send queued files to the gateway, CONCURRENCY at a time. Each file becomes its own sealed case.
  useEffect(() => {
    for (const item of items) {
      if (inflight.current.size >= CONCURRENCY) break
      const file = files.current.get(item.id)
      if (item.status !== 'queued' || !file || inflight.current.has(item.id)) continue
      const ctl = new AbortController()
      inflight.current.set(item.id, ctl)
      patch(item.id, { status: 'processing', progress: 2, error: undefined })
      analyzeFile(backendUrl, file, {
        signal: ctl.signal,
        batchId: batchId.current,
        onUploadProgress: (loaded, total) => patch(item.id, { progress: Math.max(2, Math.round((loaded / total) * 45)) }),
        onUploaded: () => patch(item.id, { status: 'analyzing', progress: 60 }),
      })
        .then((c) => patch(item.id, { progress: 100, ...outcome(c) }))
        .catch((e) => {
          if (ctl.signal.aborted) return
          patch(item.id, { status: 'failed', progress: 100, error: failureReason(e) })
        })
        .finally(() => { inflight.current.delete(item.id); setItems((cur) => [...cur]) })
    }
  }, [items, backendUrl])

  // Leaving the page cancels uploads that are still in flight.
  useEffect(() => () => { inflight.current.forEach((c) => c.abort()) }, [])

  const count = items.length
  useGSAP(() => {
    const fresh = list.current?.querySelectorAll('[data-row]:not([data-shown])')
    if (!fresh?.length) return
    fresh.forEach((n) => n.setAttribute('data-shown', ''))
    revealIn(fresh, { duration: 0.4, stagger: 0.03 })
  }, { dependencies: [count], scope: list })

  const totals = useMemo(() => ({
    processed: items.filter((i) => FINAL.includes(i.status)).length,
    review: items.filter((i) => i.status === 'review').length,
    anomalies: items.filter((i) => i.indicators === 'high' || i.indicators === 'moderate').length,
    completed: items.filter((i) => i.status === 'complete').length,
  }), [items])

  const retry = (id: string) => patch(id, { status: 'queued', progress: 0, indicators: null, evidence: null, error: undefined })
  const clear = () => { files.current.clear(); batchId.current = newBatchId(); setItems([]) }

  return (
    <div ref={scope}>
      <PageHeader title="Bulk verification" description={`Submit up to ${MAX_FILES} files at once. Each file is hashed and analysed independently, and anything that needs an analyst is routed to review.`}
        actions={items.length > 0 && <GlassButton variant="quiet" icon={<Trash size={15} weight="light" />} onClick={clear} disabled={busy}>Clear queue</GlassButton>} />

      <div data-reveal>
        <GlassUploader multiple compact={items.length > 0} title={`Drop up to ${MAX_FILES} files`} hint={items.length ? `${items.length} of ${MAX_FILES} slots used.` : 'Video, audio, images and screenshots. Unsupported files are listed as failed, not dropped silently.'}
          onFiles={add} disabled={items.length >= MAX_FILES} />
      </div>

      {items.length > 0 && (
        <>
          <section data-reveal aria-label="Batch totals" className="my-8 grid grid-cols-2 gap-x-8 gap-y-7 border-y border-line py-6 lg:grid-cols-4">
            <GlassMetric label="Files processed" value={totals.processed} suffix={`/ ${items.length}`} />
            <GlassMetric label="Requires review" value={totals.review} tone="warn" hint={totals.review ? 'Routed to analyst review' : undefined} />
            <GlassMetric label="Anomalies detected" value={totals.anomalies} hint="Files with moderate or high indicators" />
            <GlassMetric label="Completed" value={totals.completed} hint="No indicators above threshold" />
          </section>

          <GlassPanel data-reveal level={1} as="section" aria-label="Verification queue">
            <div className="bulk-row t-label border-b border-line px-5 py-2.5" aria-hidden>
              <span>File</span><span className="max-md:hidden">Type</span><span>Status</span><span className="max-lg:hidden">Indicators</span><span className="max-sm:hidden">Evidence</span><span />
            </div>
            <ul ref={list}>
              {items.map((i) => {
                const meta = BULK_META[i.status]
                const done = FINAL.includes(i.status)
                const openable = done && i.status !== 'failed' && !!i.caseId
                const running = i.status === 'processing' || i.status === 'analyzing'
                return (
                  <li key={i.id} data-row className="relative border-b border-line/60 last:border-b-0">
                    <div
                      role={openable ? 'button' : undefined} tabIndex={openable ? 0 : undefined} aria-label={openable ? `Open forensic investigation for ${i.name}` : undefined}
                      onClick={openable ? () => navigate(`/analysis/${i.caseId}`) : undefined}
                      onKeyDown={openable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/analysis/${i.caseId}`) } } : undefined}
                      className={cn('bulk-row px-5 py-3.5', openable && 'row-hover cursor-pointer')}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {i.type === 'unsupported'
                          ? <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-danger/30 bg-danger/10 text-danger"><FileX size={18} weight="light" /></span>
                          : <MediaGlyph type={i.type as MediaType} />}
                        <span className="min-w-0"><span className="block truncate text-sm font-[520] text-fg">{i.name}</span><span className="t-mono block text-[0.6875rem] text-fg-3">{i.caseId ?? i.id}, {bytes(i.sizeBytes)}</span></span>
                      </span>
                      <span className="text-[0.8125rem] capitalize text-fg-2 max-md:hidden">{i.type}</span>
                      <span className="flex flex-col items-start gap-1.5">
                        <GlassBadge tone={meta.tone}>{meta.label}</GlassBadge>
                        {i.type === 'unsupported' && <span className="t-meta text-[0.6875rem]">Unsupported file type</span>}
                        {i.error && <span className="t-meta text-[0.6875rem]">{i.error}</span>}
                      </span>
                      <span className="max-lg:hidden">{i.indicators ? <LevelBadge level={i.indicators} /> : <span className="t-meta">{done ? 'Not assessed' : 'Pending'}</span>}</span>
                      <span className="max-sm:hidden">{i.evidence !== null ? <CoverageBar value={i.evidence} /> : <span className="t-meta">{done ? 'None' : 'Pending'}</span>}</span>
                      <span className="flex justify-end">
                        {i.status === 'failed' && i.type !== 'unsupported' && <GlassButton size="sm" iconOnly aria-label={`Retry ${i.name}`} onClick={(e) => { e.stopPropagation(); retry(i.id) }} icon={<ArrowClockwise size={14} weight="light" />} />}
                        {openable && <ArrowRight size={16} weight="light" className="text-fg-3" aria-hidden />}
                      </span>
                    </div>
                    {/* per-file progress as a thin trace along the row's lower edge */}
                    <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-accent transition-[transform,opacity] duration-500 ease-out', running ? 'opacity-100' : 'opacity-0')}
                      style={{ transform: `scaleX(${i.progress / 100})` }} />
                    {running && <span className="sr-only" role="progressbar" aria-valuenow={Math.round(i.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`${i.name} progress`} />}
                  </li>
                )
              })}
            </ul>
          </GlassPanel>
          <p className="t-meta mt-4">Each file is analysed by the gateway and sealed as its own case. Batch {batchId.current}. Open a finished row to inspect it.</p>
        </>
      )}

      {items.length === 0 && (
        <GlassPanel data-reveal level={1} className="mt-5">
          <EmptyState title="Queue is empty" body="Files you add appear here with their status, indicators and evidence coverage." />
        </GlassPanel>
      )}
    </div>
  )
}
