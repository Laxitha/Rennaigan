import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FileCode, FilmStrip, Image as ImageIcon, LinkSimple, Waveform } from '@phosphor-icons/react'
import { usePrefs } from '@/hooks/usePrefs'
import { cn } from '@/lib/cn'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { d, dist, EASE, ensureFinished, fromToSafe, gsap, motionState, useGSAP } from '@/lib/motion'
import { shortHash, tc } from '@/lib/format'
import { anomalies, flagged, MODALITIES, MODALITY_LABEL } from '@/data/anomalies'
import { auditTrail } from '@/data/audit'
import { investigations } from '@/data/investigations'
import { improvementLoop } from '@/data/models'
import { GlassBadge, GlassButton, GlassPanel } from '@/components/glass'
import { MediaFrame, RegionBox } from '@/components/forensic/MediaFrame'
import { RadialSignal } from '@/components/forensic/RadialSignal'
import { EvidenceGraph } from '@/components/graph/EvidenceGraph'
import { Brand } from '@/components/navigation/Brand'

// ScrollTrigger is only needed on this page, so it ships with the landing chunk, not the console.
gsap.registerPlugin(ScrollTrigger)

const ForensicLens = lazy(() => import('@/components/three/ForensicLens'))

const MODALITY_CARDS = [
  { label: 'Video', icon: FilmStrip, body: 'Face tracks, blend boundaries, frame continuity.' },
  { label: 'Audio', icon: Waveform, body: 'Speaker, spectrum, prosody, synthesis traces.' },
  { label: 'Image', icon: ImageIcon, body: 'Error levels, copy-move, reverse lookup.' },
  { label: 'Metadata', icon: FileCode, body: 'Container, encoder history, provenance.' },
]
const LINKS = [['Forensics', '#forensics'], ['Evidence', '#evidence'], ['Reports', '#reports'], ['Audit', '#audit']] as const
const primary = investigations[0]
const lip = flagged[1]

function Heading({ n, title, children, className }: { n: string; title: string; children: ReactNode; className?: string }) {
  return (
    <div data-in className={cn('max-w-xl', className)}>
      <p className="t-mono text-accent-2">{n}</p>
      <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.75rem)] font-[540] uppercase leading-[1.05] tracking-[-0.02em]">{title}</h2>
      <p className="t-body mt-5 text-base">{children}</p>
    </div>
  )
}

export default function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const { prefs } = usePrefs()
  const [frame, setFrame] = useState({ heat: 0.15, t: 4.3 })

  useGSAP(() => {
    // hero: one short sequence, text first, then the lens settles in
    ensureFinished(gsap.timeline({ defaults: { ease: EASE.out } })
      .fromTo('[data-hero-nav]', { autoAlpha: 0, y: dist(-14) }, { autoAlpha: 1, y: 0, duration: d(0.6) })
      .fromTo('[data-hero-line]', { yPercent: motionState.reduced ? 0 : 110 }, { yPercent: 0, duration: d(0.95), stagger: 0.09 }, 0.1)
      .fromTo('[data-hero-fade]', { autoAlpha: 0, y: dist(16) }, { autoAlpha: 1, y: 0, duration: d(0.7), stagger: 0.08 }, 0.45)
      .fromTo('[data-hero-lens]', { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: d(1.4) }, 0.2))

    if (motionState.reduced) { setFrame({ heat: 1, t: 4.96 }); return }

    // section reveals, created top to bottom
    gsap.set('[data-in]', { autoAlpha: 0, y: dist(28) })
    ScrollTrigger.batch('[data-in]', {
      start: 'top 86%', once: true,
      onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.8, ease: EASE.out, stagger: 0.08, overwrite: true }),
    })
    // modality lines draw toward evidence fusion as the band scrolls through
    fromToSafe('[data-flow]', { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: 'none', stagger: 0.08, scrollTrigger: { trigger: '[data-flow-wrap]', start: 'top 80%', end: 'bottom 55%', scrub: 0.6 } })
    // the heatmap develops while the frame section crosses the viewport
    ScrollTrigger.create({
      trigger: '[data-frame-section]', start: 'top 70%', end: 'center 40%', scrub: true,
      onUpdate: (self) => setFrame({ heat: 0.15 + self.progress * 0.85, t: 4.3 + self.progress * 0.66 }),
    })
    fromToSafe('[data-hero-copy]', { y: 0, autoAlpha: 1 }, { y: -60, autoAlpha: 0.2, ease: 'none', scrollTrigger: { trigger: '[data-hero]', start: 'top top', end: 'bottom 30%', scrub: true } })
  }, { scope: root })

  return (
    <div ref={root} className="relative z-10">
      <header data-hero-nav className="shell-x fixed inset-x-0 top-0 z-40 py-3">
        <div data-level="3" className="glass mx-auto flex h-[60px] max-w-5xl items-center gap-6 rounded-[18px] px-4">
          <Brand />
          <nav aria-label="Platform" className="ml-auto hidden items-center gap-1 md:flex">
            {LINKS.map(([label, href]) => <a key={href} href={href} className="rounded-[9px] px-3 py-1.5 text-[0.8125rem] font-[520] text-fg-3 transition-colors hover:bg-white/[0.04] hover:text-fg">{label}</a>)}
          </nav>
          <GlassButton to="/overview" size="sm" className="max-md:ml-auto">Open console</GlassButton>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section data-hero className="shell-x relative flex min-h-[100dvh] items-center overflow-hidden pb-16 pt-28 max-lg:items-end">
          <div data-hero-lens className="pointer-events-none absolute inset-y-0 right-[-12%] w-[78%] max-lg:inset-x-0 max-lg:top-[-6%] max-lg:h-[62%] max-lg:w-full max-lg:opacity-55">
            {prefs.effects && <Suspense fallback={null}><ForensicLens scrollLinked className="size-full" /></Suspense>}
          </div>
          <div data-hero-copy className="page relative">
            <div className="max-w-[44rem]">
              <p data-hero-fade className="text-[0.8125rem] font-[560] tracking-[0.34em] text-accent-2">RENNAIGAN</p>
              <h1 className="t-display mt-6" aria-label="The eye that sees through illusions">
                {['The eye that sees', 'through illusions'].map((line) => (
                  <span key={line} aria-hidden className="block overflow-hidden pb-[0.08em]"><span data-hero-line className="block">{line}</span></span>
                ))}
              </h1>
              <p data-hero-fade className="mt-7 max-w-[34rem] text-[1.0625rem] leading-relaxed text-fg-2">
                Multimodal forensic intelligence for investigating synthetic media, manipulation and digital evidence.
              </p>
              <div data-hero-fade className="mt-9 flex flex-wrap gap-3">
                <GlassButton variant="primary" size="lg" to="/analyze" trailing={<ArrowRight size={16} weight="light" />}>Start investigation</GlassButton>
                <a href="#platform" className="btn" data-size="lg">Explore platform</a>
              </div>
            </div>
          </div>
        </section>

        {/* MODALITIES */}
        <section id="platform" className="shell-x scroll-mt-24 pb-28">
          <div className="page" data-flow-wrap>
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {MODALITY_CARDS.map((m) => (
                <li key={m.label} data-in data-level="2" className="glass p-5">
                  <m.icon size={22} weight="light" className="text-accent-2" />
                  <p className="t-label mt-5 text-fg">{m.label}</p>
                  <p className="t-meta mt-1.5 text-[0.8125rem]">{m.body}</p>
                </li>
              ))}
            </ul>
            <svg viewBox="0 0 1000 150" preserveAspectRatio="none" className="h-28 w-full max-lg:hidden" aria-hidden>
              {[125, 375, 625, 875].map((x) => (
                <path key={x} data-flow d={`M${x},0 C${x},90 500,60 500,150`} fill="none" stroke="var(--color-accent)" strokeOpacity="0.7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" />
              ))}
            </svg>
            <div data-in data-level="4" className="glass mx-auto flex max-w-md flex-col items-center px-6 py-5 text-center max-lg:mt-4">
              <p className="t-label text-accent-3">Evidence fusion</p>
              <p className="mt-2 text-sm text-fg-2">Four modalities are weighed against each other. Disagreement between them is evidence too.</p>
            </div>
          </div>
        </section>

        {/* 01 */}
        <section id="forensics" className="shell-x scroll-mt-24 py-24 md:py-32">
          <div className="page grid items-center gap-14 lg:grid-cols-2">
            <Heading n="01" title="Multimodal forensics">
              Video, audio, image and metadata are analysed separately, then compared. A manipulation that hides in one modality usually shows in another.
            </Heading>
            <GlassPanel data-in pad="lg">
              <p className="t-label text-fg">Signal strength, demonstration case</p>
              <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {MODALITIES.map((m) => <RadialSignal key={m} label={MODALITY_LABEL[m]} value={primary.signals[m]} />)}
              </div>
            </GlassPanel>
          </div>
        </section>

        {/* 02 */}
        <section data-frame-section className="shell-x py-24 md:py-32">
          <div className="page">
            <Heading n="02" title="Frame-level analysis">
              Every frame is scored. Heatmaps mark where in the frame the evidence sits, and the timeline marks when.
            </Heading>
            <GlassPanel data-in level={3} className="mt-12 overflow-hidden">
              <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="relative">
                  <MediaFrame time={frame.t} heat={frame.heat} anomalies={anomalies} label="Heatmap developing over a flagged frame" />
                  {flagged[0].region && <RegionBox region={flagged[0].region} active={frame.heat > 0.6} />}
                </div>
                <div className="flex flex-col justify-center gap-5 p-7">
                  <p className="t-mono text-fg-3">Frame {String(Math.floor(frame.t * 25)).padStart(5, '0')}, {tc(frame.t)}</p>
                  <p className="text-xl font-[540] leading-snug tracking-[-0.02em]">{flagged[0].title}</p>
                  <p className="text-sm leading-relaxed text-fg-2">{flagged[0].explanation}</p>
                  <ul className="flex flex-wrap gap-2">{flagged[0].indicators.map((i) => <li key={i}><GlassBadge tone="accent">{i}</GlassBadge></li>)}</ul>
                </div>
              </div>
            </GlassPanel>
          </div>
        </section>

        {/* 03 */}
        <section id="evidence" className="shell-x scroll-mt-24 py-24 md:py-32">
          <div className="page">
            <Heading n="03" title="Evidence correlation" className="mx-auto text-center">
              Findings are linked back to the features, frames and sources they came from. Any conclusion can be traced to the file.
            </Heading>
            <div data-in className="mt-12 overflow-x-auto">
              <EvidenceGraph interactive={false} highlightPath={lip.graphPath} className="aspect-[1380/640] min-w-[760px]" />
            </div>
          </div>
        </section>

        {/* 04 */}
        <section id="reports" className="shell-x scroll-mt-24 py-24 md:py-32">
          <div className="page grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <GlassPanel data-in level={4} pad="lg" className="lg:order-2">
              <p className="t-label text-accent-3">Forensic assessment</p>
              <dl className="mt-5">
                {([['Manipulation indicators', 'High'], ['Evidence confidence', `${primary.confidence}%`], ['Evidence coverage', `${primary.coverage}%`], ['Cross-modal consistency', 'Low'], ['Human review', 'Recommended']] as const).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-6 border-b border-line/70 py-3.5 last:border-b-0">
                    <dt className="text-sm text-fg-2">{k}</dt><dd className="t-mono text-[0.9375rem] text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="t-meta mt-4">Confidence is reported with the share of media the evidence covers.</p>
            </GlassPanel>
            <Heading n="04" title="Forensic reports">
              Reports state what was found, how confident each detector is and how much of the media the evidence covers. Uncertainty is shown, not hidden.
            </Heading>
          </div>
        </section>

        {/* 05 */}
        <section className="shell-x py-24 md:py-32">
          <div className="page">
            <Heading n="05" title="Continuous learning">
              Analyst-verified cases feed the next model. Nothing is deployed until it passes evaluation on held-out cases.
            </Heading>
            <ol className="mt-14 grid gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {improvementLoop.map((stage, i) => (
                <li key={stage} data-in className="relative pr-6">
                  <span className="flex items-center"><span className="size-2.5 rounded-full border border-accent bg-accent/30" /><span aria-hidden className={cn('ml-2 h-px flex-1 bg-gradient-to-r from-accent/60 to-line', i === improvementLoop.length - 1 && 'invisible')} /></span>
                  <p className="mt-4 text-[0.9375rem] font-[520] text-fg">{stage}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 06 */}
        <section id="audit" className="shell-x scroll-mt-24 py-24 md:py-32">
          <div className="page grid items-center gap-14 lg:grid-cols-2">
            <Heading n="06" title="Auditability">
              Every action is recorded with its model version and hashes. Each entry is bound to the one before it, so a later change is detectable.
            </Heading>
            <ol data-in>
              {auditTrail.slice(0, 3).map((e, i) => {
                const inH = e.inputHash ?? e.input_hash ?? ''
                const outH = e.outputHash ?? e.output_hash ?? ''
                const prevOut = auditTrail[i - 1]?.outputHash ?? auditTrail[i - 1]?.output_hash ?? ''
                return (
                  <li key={e.seq}>
                    {i > 0 && <p className="t-mono flex items-center gap-2 py-2.5 pl-6 text-[0.6875rem] text-accent-2"><LinkSimple size={13} weight="light" />{inH.slice(0, 12)} = {prevOut.slice(0, 12)}</p>}
                    <div data-level="2" className="glass flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4">
                      <span><span className="t-mono mr-3 text-fg-3">{String(e.seq).padStart(2, '0')}</span><span className="text-sm font-[540] text-fg">{e.action}</span></span>
                      <span className="t-mono text-fg-2">{shortHash(outH, 8, 6)}</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        {/* CLOSE */}
        <section className="shell-x pb-28 pt-10">
          <GlassPanel data-in level={3} className="page flex flex-col items-center px-6 py-16 text-center md:py-20">
            <h2 className="max-w-2xl text-[clamp(1.75rem,3.6vw,3rem)] font-[540] leading-[1.05] tracking-[-0.03em]">Bring the media. Leave with evidence you can defend.</h2>
            <div className="mt-9"><GlassButton variant="primary" size="lg" to="/analyze" trailing={<ArrowRight size={16} weight="light" />}>Start investigation</GlassButton></div>
          </GlassPanel>
        </section>
      </main>

      <footer className="shell-x border-t border-line py-8">
        <div className="page flex flex-wrap items-center justify-between gap-4">
          <Brand />
          <p className="t-meta">Demonstration build. Investigations, findings and hashes shown are fixtures.</p>
          <Link to="/overview" className="text-[0.8125rem] text-fg-2 transition-colors hover:text-fg">Open console</Link>
        </div>
      </footer>
    </div>
  )
}
