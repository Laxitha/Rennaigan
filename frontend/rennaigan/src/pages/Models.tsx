import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, MagnifyingGlass } from '@phosphor-icons/react'
import { usePageReveal } from '@/animations/usePageReveal'
import { cn } from '@/lib/cn'
import { d, EASE, gsap, useGSAP } from '@/lib/motion'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { currentModel, improvementLoop, knowledge, modelSignals, modelVersions } from '@/data/models'
import { CountUp, EmptyState, GlassBadge, GlassButton, GlassInput, GlassPanel } from '@/components/glass'
import { PageHeader } from '@/components/navigation/PageHeader'
import { gateway, useBackendUrl } from '@/services/backend'
import type { GatewayInfo, Health, Tone } from '@/types'

const VERSION_TONE: Record<string, Tone> = { deployed: 'ok', candidate: 'info', retired: 'neutral' }

/** Precision and recall on one shared axis: two marks on a hairline, no filled tracks. */
function PrecisionRecall({ precision, recall }: { precision: number; recall: number }) {
  const pos = (v: number) => `${((v - 60) / 40) * 100}%`
  return (
    <div className="relative h-6" role="img" aria-label={`Precision ${precision} percent, recall ${recall} percent`}>
      <span className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      <span className="absolute top-1/2 h-px bg-accent/60" style={{ left: pos(recall), width: `calc(${pos(precision)} - ${pos(recall)})` }} />
      <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-2 bg-bg" style={{ left: pos(recall) }} />
      <span className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: pos(precision) }} />
    </div>
  )
}

export default function Models() {
  const scope = useRef<HTMLDivElement>(null)
  const loop = useRef<HTMLOListElement>(null)
  const [query, setQuery] = useState('')
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const backendUrl = useBackendUrl()
  usePageReveal(scope, [])

  useEffect(() => {
    if (backendUrl) {
      gateway.info().then(setGatewayInfo).catch(() => {})
      gateway.health().then(setHealth).catch(() => {})
    }
  }, [backendUrl])

  // The loop plays once on entry and again on request: a pulse travels the six stages.
  const { contextSafe } = useGSAP(() => { play() }, { scope: loop })
  const play = contextSafe(() => {
    const nodes = loop.current?.querySelectorAll('[data-stage]')
    if (!nodes?.length) return
    gsap.timeline()
      .fromTo(nodes, { '--on': 0 }, { '--on': 1, duration: d(0.35), stagger: 0.22, ease: EASE.soft })
      .to(nodes, { '--on': 0, duration: d(0.6), stagger: 0.22, ease: EASE.soft }, 0.5)
  })

  const articles = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? knowledge.filter((k) => `${k.title} ${k.category} ${k.summary} ${k.id}`.toLowerCase().includes(q)) : knowledge
  }, [query])

  const totalCases = health?.gateway?.cases ?? currentModel.verifiedCases

  return (
    <div ref={scope}>
      <PageHeader title="Model and forensic knowledge" description="Forensic model architectures, evaluation benchmarks, and active detector pipelines." />

      <section data-reveal aria-label="Current model" className="mb-10 grid gap-x-10 gap-y-8 border-y border-line py-7 md:grid-cols-[auto_minmax(0,1fr)]">
        <div>
          <p className="t-label">Gateway Engine</p>
          <p className="t-mono mt-2 text-[2.75rem] font-[520] leading-none tracking-[-0.04em] text-fg">v{gatewayInfo?.version || currentModel.version}</p>
          <p className="t-meta mt-3">Active on {backendUrl || 'localhost:8010'}</p>
        </div>
        <dl className="grid content-center gap-x-8 gap-y-6 sm:grid-cols-3">
          <div>
            <dt className="t-label">Evaluation Benchmark</dt>
            <dd className="mt-2 text-sm text-fg">{fmtDateTime(currentModel.lastEvaluation)}</dd>
            <dd className="t-meta mt-1">{currentModel.evaluationSet}</dd>
          </div>
          <div>
            <dt className="t-label">Indexed Gateway Cases</dt>
            <dd className="mt-2 text-2xl font-[520] tracking-[-0.03em]"><CountUp value={totalCases} /></dd>
            <dd className="t-meta mt-1">Cases recorded in SQLite audit ledger</dd>
          </div>
          <div>
            <dt className="t-label">Detector Services</dt>
            <dd className="mt-2 text-2xl font-[520] tracking-[-0.03em]"><CountUp value={health?.services_up ?? 1} /> <span className="text-base text-fg-3">/ {health?.services_total ?? 5}</span></dd>
            <dd className="t-meta mt-1">Active microservices answering</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassPanel data-reveal as="section" aria-labelledby="signals-h" pad="lg">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="signals-h" className="t-label text-fg">Supported forensic signals</h2>
            <span className="flex items-center gap-4 text-[0.6875rem] text-fg-3">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-accent-2" />Recall</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" />Precision</span>
            </span>
          </div>
          <ul className="mt-5">
            {modelSignals.map((s) => (
              <li key={s.modality} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 border-b border-line/60 py-3.5 last:border-b-0">
                <div className="min-w-0"><p className="text-sm font-[540] text-fg">{s.label}</p><p className="t-mono truncate text-[0.6875rem] text-fg-3">{s.detector}</p></div>
                <PrecisionRecall precision={s.precision} recall={s.recall} />
                <p className="t-mono text-right text-fg-2">{s.recall.toFixed(1)} <span className="text-fg-3">/</span> <span className="text-fg">{s.precision.toFixed(1)}</span></p>
              </li>
            ))}
          </ul>
          <div className="t-mono mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] gap-x-5 text-[0.6875rem] text-fg-3">
            <span /><span className="flex justify-between"><span>60%</span><span>80%</span><span>100%</span></span><span className="invisible">00.0 / 00.0</span>
          </div>
          <p className="t-meta mt-5">Measured on held-out verified cases. Fusion operates in calibrated logit space with strong-signal capping.</p>
        </GlassPanel>

        <GlassPanel data-reveal level={1} as="section" aria-labelledby="versions-h">
          <h2 id="versions-h" className="t-label border-b border-line px-6 py-4 text-fg">Pipeline history</h2>
          <ol>
            {modelVersions.map((v) => (
              <li key={v.version} className="border-b border-line/60 px-6 py-4 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-mono text-[0.9375rem] text-fg">{v.version}</span>
                  <GlassBadge tone={VERSION_TONE[v.status]}>{v.status}</GlassBadge>
                </div>
                <p className="mt-1.5 text-[0.8125rem] text-fg-2">{v.note}</p>
                <p className="t-meta mt-1">{fmtDate(v.releasedAt)}</p>
              </li>
            ))}
          </ol>
        </GlassPanel>
      </div>

      <GlassPanel data-reveal level={3} as="section" aria-labelledby="loop-h" pad="lg" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="loop-h" className="t-label text-fg">Model improvement loop</h2>
            <p className="t-meta mt-1.5">Analyst-verified cases feed continuous calibration. Hashes and weights are verified against gateway config.</p>
          </div>
          <GlassButton size="sm" onClick={play}>Replay loop</GlassButton>
        </div>
        <ol ref={loop} className="mt-7 grid gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          {improvementLoop.map((stage, i) => (
            <li key={stage} data-stage className="relative flex items-center gap-3 sm:flex-col sm:items-start" style={{ ['--on' as string]: 0 }}>
              <span className="relative flex w-full items-center">
                <span className="size-3 shrink-0 rounded-full border border-accent" style={{ background: 'rgb(255 77 148 / calc(var(--on) * 0.9))', boxShadow: '0 0 0 calc(var(--on) * 6px) rgb(255 77 148 / 0.16)' }} />
                <span aria-hidden className={cn('ml-2 h-px flex-1 bg-line-2 max-sm:hidden', i === improvementLoop.length - 1 && 'lg:invisible')} />
              </span>
              <span className="text-sm font-[520] text-fg sm:mt-3">{stage}</span>
            </li>
          ))}
        </ol>
      </GlassPanel>

      <section data-reveal aria-labelledby="kb-h" className="mt-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <h2 id="kb-h" className="t-section">Forensic knowledge base</h2>
          <GlassInput label="Search the knowledge base" hideLabel type="search" placeholder="Search articles" value={query} onChange={(e) => setQuery(e.target.value)}
            leading={<MagnifyingGlass size={15} weight="light" />} className="w-full sm:w-64" />
        </div>
        <GlassPanel level={1}>
          {articles.length === 0 ? (
            <EmptyState icon={<BookOpen size={22} weight="light" />} title="No evidence found" body="No article matches this query." action={<GlassButton onClick={() => setQuery('')}>Modify search</GlassButton>} />
          ) : (
            <ul className="grid md:grid-cols-2">
              {articles.map((k) => (
                <li key={k.id} className="border-b border-line/60 md:odd:border-r md:[&:nth-last-child(-n+2)]:border-b-0">
                  <article className="row-hover h-full px-6 py-5">
                    <div className="flex items-center justify-between gap-3"><span className="t-label">{k.category}</span><span className="t-mono text-[0.6875rem] text-fg-3">{k.id}</span></div>
                    <h3 className="mt-2.5 text-[0.9375rem] font-[540] text-fg">{k.title}</h3>
                    <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-2">{k.summary}</p>
                    <p className="t-meta mt-2.5">Updated {fmtDate(k.updatedAt)}</p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </section>
    </div>
  )
}
