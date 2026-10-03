import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, MinusCircle, XCircle } from '@phosphor-icons/react'
import { useInvestigation } from '@/hooks/useInvestigation'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { revealIn, useGSAP } from '@/lib/motion'
import { fmtTime, tc } from '@/lib/format'
import { claims, verificationSteps } from '@/data/claims'
import { GlassBadge, GlassButton, GlassPanel, GlassProgress } from '@/components/glass'
import { CONSISTENCY_META } from '@/components/forensic/meta'
import { Pipeline } from '@/components/forensic/Pipeline'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { Source } from '@/types'

const STANCE = {
  supports: { label: 'Supports', tone: 'ok', icon: CheckCircle },
  contradicts: { label: 'Contradicts', tone: 'danger', icon: XCircle },
  neutral: { label: 'Context only', tone: 'neutral', icon: MinusCircle },
} as const

function SourceCard({ s }: { s: Source }) {
  const st = STANCE[s.stance]
  return (
    <li data-source data-tone={st.tone} className="relative pl-7">
      {/* connection from the claim to this piece of evidence */}
      <span aria-hidden className="absolute left-[7px] top-0 h-full w-px bg-line-2" />
      <span aria-hidden className="absolute left-[7px] top-6 h-px w-4 bg-[color:var(--tone)]" />
      <span aria-hidden className="absolute left-1 top-[21px] size-[7px] rounded-full bg-[color:var(--tone)]" />
      <article className={cn('glass-inner mb-3 p-4', s.stance === 'contradicts' && 'border-danger/35')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="tone-text flex items-center gap-1.5 text-[0.75rem] font-[560] uppercase tracking-[0.08em]"><st.icon size={15} weight="light" />{st.label}</span>
          <span className="t-mono text-[0.6875rem] text-fg-3">{s.id}</span>
        </div>
        <h4 className="mt-2.5 text-sm font-[540] text-fg">{s.title}</h4>
        <p className="t-meta mt-0.5">{s.publisher}, {s.kind.toLowerCase()}</p>
        <p className="mt-3 border-l border-line-2 pl-3 text-[0.8125rem] leading-relaxed text-fg-2">{s.excerpt}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[0.75rem] text-fg-3">Source reliability <GlassBadge tone={s.reliability === 'high' ? 'ok' : s.reliability === 'moderate' ? 'warn' : 'danger'}>{s.reliability}</GlassBadge></span>
          <span className="t-mono text-[0.6875rem] text-fg-3">Retrieved {fmtTime(s.retrievedAt)}</span>
        </div>
      </article>
    </li>
  )
}

export default function Verification() {
  const { id = '' } = useParams()
  const scope = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const { investigation, gate } = useInvestigation(id, 'claim verification')
  const [claimId, setClaimId] = useState(claims[1].id)
  usePageReveal(scope, [investigation, gate])

  useGSAP(() => {
    const nodes = detail.current?.querySelectorAll('[data-claim-head], [data-source]')
    if (nodes?.length) revealIn(nodes, { duration: 0.4, stagger: 0.06 })
  }, { dependencies: [claimId, gate], scope: detail })

  if (gate || !investigation) return <div ref={scope}><PageHeader title="Claim and evidence verification" />{gate}</div>

  const claim = claims.find((c) => c.id === claimId)!
  const meta = CONSISTENCY_META[claim.consistency]
  const contradicting = claim.sources.filter((s) => s.stance === 'contradicts').length

  return (
    <div ref={scope}>
      <PageHeader title="Claim and evidence verification" description="Claims made in the media, compared against external sources and file evidence. Each state links to the sources behind it."
        actions={<GlassButton to={`/evidence/${investigation.id}`}>Evidence graph</GlassButton>} />

      <GlassPanel data-reveal level={1} pad="lg" className="mb-5">
        <Pipeline steps={verificationSteps.map((label, i) => ({ id: label, label, state: 'done' as const, note: ['1 file', '3 claims', '6 sources', '6 compared', '4 conflicts', 'Complete'][i] }))} />
      </GlassPanel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section data-reveal aria-labelledby="claims-title">
          <h2 id="claims-title" className="t-label mb-3 text-fg">Extracted claims</h2>
          <ul className="flex flex-col gap-3">
            {claims.map((c) => {
              const m = CONSISTENCY_META[c.consistency]
              const active = c.id === claimId
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setClaimId(c.id)} aria-pressed={active} data-level={active ? 4 : 2}
                    className="glass glass-hover w-full p-5 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <span className="t-mono text-fg-3">{c.id}</span>
                      <GlassBadge tone={m.tone}>{m.label}</GlassBadge>
                    </div>
                    <p className="mt-3 text-[1.0625rem] font-[520] leading-snug tracking-[-0.015em] text-fg">"{c.text}"</p>
                    <p className="t-meta mt-2">{c.origin}, at {tc(c.timecode)}. {c.sources.length} {c.sources.length === 1 ? 'source' : 'sources'}.</p>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <GlassPanel data-reveal level={3} as="section" aria-labelledby="claim-detail" aria-live="polite" pad="lg">
          <div ref={detail}>
            <div data-claim-head>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="claim-detail" className="t-label text-fg">Verification state</h2>
                <GlassBadge tone={meta.tone}>{meta.label}</GlassBadge>
              </div>
              <p className="mt-4 text-xl font-[540] leading-snug tracking-[-0.02em]">"{claim.text}"</p>
              <p className="mt-3 text-sm leading-relaxed text-fg-2">{claim.summary}</p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <GlassProgress label="Confidence in this state" valueLabel={`${claim.confidence}%`} value={claim.confidence} tone={meta.tone === 'neutral' ? 'info' : meta.tone} />
                <div className="flex items-end justify-between gap-3 text-[0.8125rem]">
                  <span className="text-fg-2">Sources in conflict</span>
                  <span className="t-mono text-fg">{contradicting} of {claim.sources.length}</span>
                </div>
              </div>
              <h3 className="t-label mb-3 mt-7">Evidence</h3>
            </div>
            <ul>{claim.sources.map((s) => <SourceCard key={s.id} s={s} />)}</ul>
          </div>
        </GlassPanel>
      </div>
    </div>
  )
}
