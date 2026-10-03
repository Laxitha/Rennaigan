import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CaretDown, Check, LinkSimple, ShieldCheck } from '@phosphor-icons/react'
import { useInvestigation } from '@/hooks/useInvestigation'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { fmtTime, shortHash } from '@/lib/format'
import { motionState } from '@/lib/motion'
import { api } from '@/services/api'
import { explainError, gateway } from '@/services/backend'
import { CopyButton, EmptyState, GlassBadge, GlassButton, GlassPanel, useToast } from '@/components/glass'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { AuditEntry, AuditVerification } from '@/types'

type ChainState = 'idle' | 'running' | 'intact' | 'broken'

function Hash({ label, value, linked }: { label: string; value: string; linked?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="t-label text-[0.625rem]">{label}</p>
      <p className={cn('t-mono mt-1 flex items-center gap-2 transition-colors duration-500', linked ? 'text-accent-3' : 'text-fg-2')}>
        <span className="truncate">{shortHash(value, 10, 8)}</span>
        <CopyButton text={value} label={label} />
      </p>
    </div>
  )
}

function Entry({ e, verified, open, onToggle, total }: { e: AuditEntry; verified: boolean; open: boolean; onToggle: () => void; total: number }) {
  const inHash = e.input_hash ?? e.prev_hash ?? e.inputHash ?? '0000000000000000'
  const outHash = e.output_hash ?? e.entry_hash ?? e.outputHash ?? '0000000000000000'
  const rawDur = e.duration_ms !== undefined && e.duration_ms !== null ? e.duration_ms : (e.durationMs ?? 0)
  const dur = rawDur || 0

  return (
    <li className="group/entry relative pl-12 sm:pl-16">
      <span className={cn('absolute left-0 top-5 flex size-9 items-center justify-center rounded-full border text-[0.75rem] transition-[border-color,background-color,color] duration-500 sm:left-2',
        verified ? 'border-ok/60 bg-ok/15 text-ok' : 'border-line-2 bg-bg-2 text-fg-2')}>
        {verified ? <Check size={15} weight="bold" /> : <span className="t-mono">{String(e.seq).padStart(2, '0')}</span>}
      </span>
      <div data-level={open ? 3 : 2} className="glass transition-[border-color] duration-300 group-hover/entry:border-line-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-left">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block text-[0.9375rem] font-[540] text-fg">{e.action}</span>
            <span className="t-mono mt-0.5 block text-fg-3">{fmtTime(e.timestamp)}</span>
          </span>
          <span className="t-mono text-fg-2">{e.actor || e.model} <span className="text-fg-3">{e.modelVersion || ''}</span></span>
          <span className="sm:w-24 sm:text-right">{e.confidence !== null && e.confidence !== undefined ? <span className="t-mono text-fg">{e.confidence}%</span> : <span className="t-meta">Recorded</span>}</span>
          <CaretDown size={14} weight="light" className={cn('ml-auto text-fg-3 transition-transform duration-300', open && 'rotate-180')} aria-hidden />
        </button>
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2">
          <Hash label="Input hash (prev)" value={inHash} linked={verified && e.seq > 1} />
          <Hash label="Output hash (seal)" value={outHash} linked={verified} />
        </div>
        {/* full record: opens on hover, keyboard focus, or when pinned by click */}
        <div className={cn('grid transition-[grid-template-rows] duration-500 ease-[var(--ease-out-expo)] group-hover/entry:grid-rows-[1fr] group-focus-within/entry:grid-rows-[1fr]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            <dl className="grid gap-x-8 gap-y-3 border-t border-line px-5 py-4 text-[0.8125rem] sm:grid-cols-3">
              <div className="sm:col-span-3"><dt className="t-label text-[0.625rem]">Record detail</dt><dd className="mt-1 text-fg-2">{e.detail}</dd></div>
              <div><dt className="t-label text-[0.625rem]">Actor</dt><dd className="t-mono mt-1 text-fg-2">{e.actor}</dd></div>
              <div><dt className="t-label text-[0.625rem]">Duration</dt><dd className="t-mono mt-1 text-fg-2">{(dur / 1000).toFixed(2)} s</dd></div>
              <div><dt className="t-label text-[0.625rem]">Sequence</dt><dd className="t-mono mt-1 text-fg-2">{e.seq} of {total}</dd></div>
              <div className="min-w-0 sm:col-span-3"><dt className="t-label text-[0.625rem]">Output hash, full SHA-256</dt><dd className="t-mono mt-1 break-all text-fg-2">{outHash}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </li>
  )
}

function ChainLink({ prev, next, verified }: { prev: AuditEntry; next: AuditEntry; verified: boolean }) {
  const prevOut = prev.entry_hash ?? prev.output_hash ?? prev.outputHash ?? ''
  const nextIn = next.prev_hash ?? next.input_hash ?? next.inputHash ?? ''
  const ok = prevOut === nextIn || (prev.output_hash && prev.output_hash === next.input_hash)
  return (
    <li aria-label={`Link ${prev.seq} to ${next.seq}: ${ok ? 'hashes match' : 'hash link verified'}`} className="relative flex h-12 items-center pl-12 sm:pl-16">
      <span aria-hidden className={cn('absolute left-[17px] top-0 h-full w-px transition-colors duration-500 sm:left-[25px]', verified ? 'bg-ok/70' : 'bg-line-2')} />
      <span className={cn('t-mono flex items-center gap-2 text-[0.6875rem] transition-colors duration-500', verified ? 'text-ok' : 'text-fg-3')}>
        <LinkSimple size={13} weight="light" />
        {prevOut.slice(0, 10)} {ok ? '=' : '→'} {nextIn.slice(0, 10)}
      </span>
    </li>
  )
}

export default function Audit() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const scope = useRef<HTMLDivElement>(null)
  const toast = useToast()

  // If no ID passed, redirect to latest case
  useEffect(() => {
    if (!id) {
      api.investigations().then((list) => {
        if (list.length > 0) {
          navigate(`/audit/${list[0].id}`, { replace: true })
        }
      }).catch(() => {})
    }
  }, [id, navigate])

  const { investigation, gate } = useInvestigation(id || 'latest', 'audit trail')
  const [trail, setTrail] = useState<AuditEntry[]>([])
  const [loadingTrail, setLoadingTrail] = useState(true)
  const [open, setOpen] = useState<number | null>(null)
  const [check, setCheck] = useState<ChainState>('idle')
  const [upTo, setUpTo] = useState(0)
  // The gateway recomputes every hash; the browser only animates the walk and shows its verdict.
  const [report, setReport] = useState<AuditVerification | Error | null>(null)
  usePageReveal(scope, [investigation, gate])

  useEffect(() => {
    setLoadingTrail(true)
    api.audit(id || 'latest')
      .then((t) => {
        setTrail(t || [])
      })
      .catch(() => {
        setTrail([])
      })
      .finally(() => {
        setLoadingTrail(false)
      })
  }, [id])

  // Walk the chain one link at a time
  useEffect(() => {
    if (check !== 'running') return
    if (upTo >= trail.length) {
      if (!report) return // still waiting for the gateway
      if (report instanceof Error) {
        setCheck('idle')
        toast({ title: 'Could not verify', description: explainError(report).body, tone: 'danger' })
        return
      }
      setCheck(report.intact ? 'intact' : 'broken')
      const first = report.problems[0]
      toast(report.intact
        ? { title: 'Hash chain intact', description: `${report.entries} entries recomputed by the gateway. The stored result matches its seal.`, tone: 'ok' }
        : { title: 'Hash chain broken', description: first ? `${first.seq ? `Entry ${first.seq}: ` : ''}${first.problem}.` : 'At least one entry failed verification.', tone: 'danger' })
      return
    }
    const t = setTimeout(() => setUpTo((n) => n + 1), motionState.reduced ? 0 : 150)
    return () => clearTimeout(t)
  }, [check, upTo, trail, toast, report])

  const brokenAt = report && !(report instanceof Error) ? report.broken_at : null

  if (gate || !investigation) return <div ref={scope}><PageHeader title="Audit trail" />{gate}</div>

  return (
    <div ref={scope}>
      <PageHeader
        title="Audit trail"
        description="Cryptographic hash chain for this investigation. Each entry is hashed together with the one before it, so a changed or removed record breaks the chain. Verification is recomputed by the gateway."
        meta={<>
          <GlassBadge tone={check === 'intact' ? 'ok' : check === 'broken' ? 'danger' : 'neutral'}>
            {check === 'intact' ? 'Chain intact' : check === 'broken' ? 'Chain broken' : check === 'running' ? 'Verifying chain...' : 'Not yet verified'}
          </GlassBadge>
          <span className="t-mono text-fg-3">{trail.length} entries</span>
        </>}
        actions={
          <GlassButton
            variant="primary"
            icon={<ShieldCheck size={16} weight="light" />}
            loading={check === 'running'}
            disabled={trail.length === 0}
            onClick={() => {
              setUpTo(0); setReport(null); setCheck('running')
              gateway.verifyAudit(investigation.id).then(setReport, (e) => setReport(e instanceof Error ? e : new Error(String(e))))
            }}
          >
            Verify hash chain
          </GlassButton>
        }
      />

      <GlassPanel data-reveal level={1} as="section" aria-label="Audit entries" className="px-4 py-6 sm:px-7">
        {trail.length === 0 ? (
          <EmptyState
            title="No audit entries"
            body={loadingTrail ? "Loading audit records from gateway..." : "No cryptographic audit events recorded for this case."}
            action={<GlassButton to="/analyze" variant="primary">Start new investigation</GlassButton>}
          />
        ) : (
          <ol>
            {trail.map((e, i) => (
              <div key={e.seq || i}>
                {i > 0 && <ChainLink prev={trail[i - 1]} next={e} verified={check === 'intact' || (check === 'running' && i <= upTo)} />}
                <Entry
                  e={e}
                  verified={check === 'intact' || (check === 'running' && i < upTo) || (check === 'broken' && brokenAt !== null && e.seq < brokenAt)}
                  open={open === e.seq}
                  onToggle={() => setOpen((cur) => (cur === e.seq ? null : e.seq))}
                  total={trail.length}
                />
              </div>
            ))}
          </ol>
        )}
      </GlassPanel>
    </div>
  )
}
