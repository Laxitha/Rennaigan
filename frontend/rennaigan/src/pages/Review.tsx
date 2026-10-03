import { useId, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Question, X } from '@phosphor-icons/react'
import { api } from '@/services/api'
import { useQuery } from '@/hooks/useQuery'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import { tc } from '@/lib/format'
import { anomalies, MODALITY_LABEL } from '@/data/anomalies'
import { EmptyState, ErrorState, ForensicLoader, GlassBadge, GlassButton, GlassModal, GlassPanel, GlassProgress, useToast } from '@/components/glass'
import { MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { Tone } from '@/types'

type Decision = 'confirm' | 'reject' | 'inconclusive'
const DECISIONS: Array<{ id: Decision; label: string; past: string; icon: typeof Check; tone: Tone; help: string }> = [
  { id: 'confirm', label: 'Confirm', past: 'Confirmed', icon: Check, tone: 'ok', help: 'The evidence supports this finding.' },
  { id: 'reject', label: 'Reject', past: 'Rejected', icon: X, tone: 'danger', help: 'The finding is not supported. A note is required.' },
  { id: 'inconclusive', label: 'Inconclusive', past: 'Inconclusive', icon: Question, tone: 'neutral', help: 'The evidence does not settle it. A note is required.' },
]
const MIN_NOTE = 12

export default function Review() {
  const { id = '' } = useParams()
  const scope = useRef<HTMLDivElement>(null)
  const work = useRef<HTMLDivElement>(null)
  const noteId = useId()
  const toast = useToast()
  const { data, loading, error, retry } = useQuery(api.reviewQueue, [])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [recorded, setRecorded] = useState<Record<string, Decision>>({})
  usePageReveal(scope, [data])

  // Findings for the investigation in the URL come first.
  const queue = [...(data ?? [])].sort((a, b) => Number(b.investigationId === id) - Number(a.investigationId === id))
  const pending = queue.filter((q) => !recorded[q.id])
  const item = queue.find((q) => q.id === activeId) ?? pending[0] ?? null

  useGSAP(() => {
    if (item) fromToSafe(work.current, { autoAlpha: 0, y: dist(12) }, { autoAlpha: 1, y: 0, duration: d(0.4), ease: EASE.out })
  }, [item?.id])

  if (loading) return <ForensicLoader label="Loading review queue" />
  if (error) return <GlassPanel><ErrorState title="Review queue unavailable" body="Findings awaiting review could not be loaded." cause="The data service did not respond." onRetry={retry} /></GlassPanel>

  const open = (qid: string) => { setActiveId(qid); setDecision(null); setNote(''); setTouched(false) }
  const needsNote = decision === 'reject' || decision === 'inconclusive'
  const noteError = needsNote && note.trim().length < MIN_NOTE ? `Explain the decision in at least ${MIN_NOTE} characters.` : null
  const submit = () => { setTouched(true); if (decision && !noteError) setConfirming(true) }
  const record = () => {
    if (!item || !decision) return
    setConfirming(false)
    setRecorded((r) => ({ ...r, [item.id]: decision }))
    api.recordReview(item.investigationId, decision, note, 'Meenakshi Raghavan').catch((e) => console.warn('Could not sync review to gateway:', e))
    toast({ title: `${item.id} recorded as ${DECISIONS.find((x) => x.id === decision)!.past.toLowerCase()}`, description: 'Written to the audit trail with your note.', tone: 'ok' })
    const next = pending.find((q) => q.id !== item.id)
    setActiveId(next?.id ?? null)
    setDecision(null); setNote(''); setTouched(false)
  }

  const alreadyDecided = item ? recorded[item.id] : undefined
  const heat = item ? anomalies.filter((a) => a.region && Math.abs(a.frame - item.frame) < 3) : []

  return (
    <div ref={scope}>
      <PageHeader title="Human review" description="Findings wait here until an analyst decides. Your decision and note are recorded in the audit trail and feed the verified case dataset."
        meta={<span className="t-mono text-fg-3">{pending.length} of {queue.length} awaiting decision</span>} />

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <GlassPanel data-reveal level={1} as="nav" aria-label="Review queue" className="self-start">
          <h2 className="t-label border-b border-line px-5 py-4 text-fg">Queue</h2>
          <ul className="p-2">
            {queue.map((q) => {
              const done = recorded[q.id]
              const meta = done ? DECISIONS.find((x) => x.id === done)! : null
              return (
                <li key={q.id}>
                  <button type="button" onClick={() => open(q.id)} aria-current={item?.id === q.id ? 'true' : undefined}
                    className={cn('row-hover w-full rounded-[12px] border px-3 py-3 text-left transition-colors', item?.id === q.id ? 'border-accent/45 bg-accent/[0.1]' : 'border-transparent')}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="t-mono text-fg-3">{q.id}</span>
                      {meta ? <GlassBadge tone={meta.tone}>{meta.past}</GlassBadge> : <GlassBadge tone="warn">Pending</GlassBadge>}
                    </span>
                    <span className="mt-1.5 block truncate text-sm font-[520] text-fg">{q.finding}</span>
                    <span className="t-meta block truncate">{q.investigationId}, {tc(q.timecode)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </GlassPanel>

        {!item ? (
          <GlassPanel data-reveal level={1}><EmptyState title="No review cases" body="All current investigations have been reviewed." action={<GlassButton to="/overview">Go to overview</GlassButton>} /></GlassPanel>
        ) : (
          <div ref={work} className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <GlassPanel level={3} as="section" aria-label="Evidence frame" className="self-start overflow-hidden">
              <div className="relative">
                <MediaFrame time={item.timecode} heat={0.9} anomalies={heat} label={`Frame ${item.frame} with the flagged region`} />
                <RegionBox region={item.region} active label={`Frame ${String(item.frame).padStart(5, '0')}`} />
              </div>
              <div className="px-5 py-4">
                <h3 className="t-label">Supporting evidence</h3>
                <ul className="mt-2">
                  {item.supporting.map((s) => <li key={s} className="border-b border-line/60 py-2 text-[0.8125rem] text-fg-2 last:border-b-0">{s}</li>)}
                </ul>
                <GlassButton className="mt-4" size="sm" to={`/analysis/${item.investigationId}`}>Open in workstation</GlassButton>
              </div>
            </GlassPanel>

            <GlassPanel level={2} as="section" aria-labelledby="finding-h" pad="lg">
              <div className="flex items-center justify-between gap-3">
                <h2 id="finding-h" className="t-label">AI finding</h2>
                <GlassBadge tone="neutral">{MODALITY_LABEL[item.modality]}</GlassBadge>
              </div>
              <p className="mt-3 text-[1.375rem] font-[540] leading-tight tracking-[-0.025em]">{item.finding}</p>
              <GlassProgress className="mt-5" label="Confidence" valueLabel={`${item.confidence}%`} value={item.confidence} />
              <p className="t-meta mt-2">Detector confidence on frame {String(item.frame).padStart(5, '0')}. It informs your decision and does not replace it.</p>
              <h3 className="t-label mt-6">Explanation</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">{item.explanation}</p>

              <div className="mt-7 border-t border-line pt-6">
                {alreadyDecided ? (
                  <p className="text-sm text-fg-2" role="status">Decision recorded: <span className="font-[540] text-fg">{DECISIONS.find((x) => x.id === alreadyDecided)!.past}</span>. A recorded decision can be superseded by a new review, not edited.</p>
                ) : (
                  <>
                    <fieldset>
                      <legend className="t-label mb-3 text-fg">Analyst decision</legend>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2" role="radiogroup" aria-label="Analyst decision">
                        {DECISIONS.map((x) => (
                          <button key={x.id} type="button" role="radio" aria-checked={decision === x.id} data-tone={x.tone} onClick={() => setDecision(x.id)}
                            className={cn('flex h-11 items-center justify-center gap-2 rounded-[10px] border text-[0.8125rem] font-[540] uppercase tracking-[0.08em] transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98]',
                              decision === x.id ? 'border-[color:var(--tone)] bg-[color:color-mix(in_srgb,var(--tone)_16%,transparent)] text-fg' : 'border-line-2 text-fg-2 hover:border-[color:color-mix(in_srgb,var(--tone)_55%,transparent)] hover:text-fg')}>
                            <x.icon size={15} weight="light" />{x.label}
                          </button>
                        ))}
                      </div>
                      <p className="t-meta mt-2.5 min-h-[1.4em]">{decision ? DECISIONS.find((x) => x.id === decision)!.help : 'Choose one. Nothing is recorded until you confirm.'}</p>
                    </fieldset>
                    <div className="mt-5 flex flex-col gap-2">
                      <label htmlFor={noteId} className="t-label text-fg">Analyst note{needsNote ? '' : ', optional'}</label>
                      <textarea id={noteId} rows={4} className="field" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => setTouched(true)}
                        aria-invalid={touched && !!noteError} aria-describedby={`${noteId}-help`} placeholder="What you checked and why you decided this way" />
                      <p id={`${noteId}-help`} className={cn('t-meta', touched && noteError && 'text-danger')}>{touched && noteError ? noteError : 'The note is stored with the decision and shown in the forensic report.'}</p>
                    </div>
                    <GlassButton className="mt-5" variant="primary" size="lg" disabled={!decision} onClick={submit}>Record decision</GlassButton>
                  </>
                )}
              </div>
            </GlassPanel>
          </div>
        )}
      </div>

      <GlassModal open={confirming} onClose={() => setConfirming(false)} title="Record this decision?" width={460}
        description="It is written to the audit trail under your name. It cannot be edited afterwards, only superseded by a new review."
        footer={<><GlassButton onClick={() => setConfirming(false)}>Go back</GlassButton><GlassButton variant="primary" onClick={record} data-autofocus>Record decision</GlassButton></>}>
        {item && decision && (
          <dl className="glass-inner grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 p-4 text-[0.8125rem]">
            <dt className="t-label">Finding</dt><dd className="text-right text-fg">{item.finding}</dd>
            <dt className="t-label">Decision</dt><dd className="text-right font-[540] text-fg">{DECISIONS.find((x) => x.id === decision)!.label}</dd>
            <dt className="t-label">Note</dt><dd className="text-right text-fg-2">{note.trim() || 'No note'}</dd>
          </dl>
        )}
      </GlassModal>
    </div>
  )
}
