import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle, X } from '@phosphor-icons/react'
import { usePageReveal } from '@/animations/usePageReveal'
import { usePrefs } from '@/hooks/usePrefs'
import { d, dist, EASE, ensureFinished, gsap, useGSAP } from '@/lib/motion'
import { bytes } from '@/lib/format'
import { analyzeFile, useBackendUrl } from '@/services/backend'
import { ErrorState, GlassBadge, GlassButton, GlassPanel, GlassUploader, useToast } from '@/components/glass'
import { Pipeline, type PipelineStep, type StepState } from '@/components/forensic/Pipeline'
import { MediaGlyph, VERDICT_META, VerdictBadge } from '@/components/forensic/meta'
import { PageHeader } from '@/components/navigation/PageHeader'
import type { CaseFull, MediaType } from '@/types'

const ForensicLens = lazy(() => import('@/components/three/ForensicLens'))

type Phase = 'idle' | 'processing' | 'done' | 'error'
interface Picked { name: string; size: number; type: MediaType; preview?: string; file: File }

const STEPS: Array<{ id: string; label: string; events: string[] }> = [
  { id: 'ingest', label: 'Ingest', events: ['Upload received', 'SHA-256 recorded before processing'] },
  { id: 'preprocess', label: 'Preprocess', events: ['Container demuxed without re-encoding', 'Frames and streams prepared'] },
  { id: 'detectors', label: 'Detectors', events: ['Metadata parser running', 'Audio/Visual models verifying artifacts'] },
  { id: 'fusion', label: 'Fusion', events: ['Cross-modal evidence fusion in logit space', 'Calibrated trust score evaluated'] },
  { id: 'audit', label: 'Audit Seal', events: ['Cryptographic hash chain updated', 'Case sealed into tamper-evident store'] },
]

function classify(file: File): MediaType | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.type.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'ts', 'avi'].includes(ext)) return 'video'
  if (file.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(ext)) return 'audio'
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'heic'].includes(ext)) {
    return /screen ?shot|capture|screen/i.test(file.name) ? 'screenshot' : 'image'
  }
  return null
}

export default function Analyze() {
  const scope = useRef<HTMLDivElement>(null)
  const result = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const { prefs } = usePrefs()
  const backendUrl = useBackendUrl()
  const [phase, setPhase] = useState<Phase>('idle')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [step, setStep] = useState(0)
  const [events, setEvents] = useState<Array<{ at: number; text: string; step: string }>>([])
  const [rejected, setRejected] = useState<{ name: string; mime: string } | null>(null)
  const [realCase, setRealCase] = useState<CaseFull | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const [errorDetails, setErrorDetails] = useState<string | null>(null)
  const started = useRef(0)
  usePageReveal(scope, [phase])

  useEffect(() => () => { if (picked?.preview) URL.revokeObjectURL(picked.preview) }, [picked])

  const begin = (p: Picked) => {
    setPicked(p)
    setStep(0)
    setEvents([])
    setRealCase(null)
    setUploadPercent(null)
    setErrorDetails(null)
    started.current = performance.now()
    setPhase('processing')

    const logEvent = (text: string, stepName: string) => {
      setEvents((list) => [...list, { at: (performance.now() - started.current) / 1000, text, step: stepName }])
    }

    const gatewayUrl = backendUrl || 'http://127.0.0.1:8010'
    logEvent(`Streaming ${p.name} (${bytes(p.size)}) to gateway at ${gatewayUrl}...`, 'Ingest')
    setStep(0)

    analyzeFile(gatewayUrl, p.file, {
      onUploadProgress: (loaded, total) => {
        const pct = Math.round((loaded / total) * 100)
        setUploadPercent(pct)
      },
      onUploaded: () => {
        setUploadPercent(100)
        logEvent('Upload complete. Gateway computing SHA-256 digest...', 'Ingest')
        setStep(1)
      },
    })
      .then((resCase) => {
        logEvent(`Media classified as ${resCase.media?.media_type || p.type}`, 'Preprocess')
        setStep(2)
        setTimeout(() => {
          logEvent(`Detectors executed (${resCase.applicable_modules?.join(', ') || 'image, metadata'}). Findings: ${resCase.total_findings}`, 'Detectors')
          setStep(3)
        }, 200)
        setTimeout(() => {
          logEvent(`Fusion complete: ${resCase.label} (Trust: ${resCase.trust_score}%)`, 'Fusion')
          setStep(4)
        }, 400)
        setTimeout(() => {
          logEvent(`Cryptographic seal complete: Case #${resCase.id} stored with ${resCase.audit?.length || 0} audit records`, 'Audit Seal')
          setStep(STEPS.length)
          setRealCase(resCase)
          setPhase('done')
          toast({ title: 'Analysis complete', description: `Case ${resCase.id} is ready for inspection.`, tone: 'ok' })
        }, 600)
      })
      .catch((err) => {
        console.error('Analysis error from gateway:', err)
        setErrorDetails(err instanceof Error ? err.message : String(err))
        setPhase('error')
        toast({ title: 'Analysis failed', description: err instanceof Error ? err.message : 'Gateway error', tone: 'danger' })
      })
  }

  const onFiles = ([file]: File[]) => {
    const type = classify(file)
    if (!type) { setRejected({ name: file.name, mime: file.type || 'unknown' }); setPhase('error'); return }
    begin({
      name: file.name,
      size: file.size,
      type,
      file,
      preview: type === 'image' || type === 'screenshot' ? URL.createObjectURL(file) : undefined,
    })
  }

  const reset = () => { setPhase('idle'); setPicked(null); setRejected(null); setRealCase(null); setUploadPercent(null); setErrorDetails(null) }

  useGSAP(() => {
    if (phase !== 'done' || !result.current) return
    const tl = ensureFinished(gsap.timeline({ defaults: { ease: EASE.out } }))
    tl.fromTo('[data-result-head]', { autoAlpha: 0, y: dist(16) }, { autoAlpha: 1, y: 0, duration: d(0.6) })
      .fromTo('[data-interval]', { autoAlpha: 0, x: dist(-18) }, { autoAlpha: 1, x: 0, duration: d(0.5), stagger: 0.09 }, '-=0.25')
      .fromTo('[data-result-foot]', { autoAlpha: 0 }, { autoAlpha: 1, duration: d(0.4) }, '-=0.2')
  }, { dependencies: [phase], scope: result })

  const steps: PipelineStep[] = STEPS.map((s, i) => {
    const state: StepState = phase === 'done' || i < step ? 'done' : i === step && phase === 'processing' ? 'active' : 'pending'
    return { id: s.id, label: s.label, state }
  })
  const log = useRef<HTMLOListElement>(null)
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [events])

  return (
    <div ref={scope}>
      <PageHeader
        title="Media analyzer"
        description="Submit media for multi-modal forensic evaluation. Original hashes and detector outputs are sealed into SQLite audit trails."
      />

      {phase === 'idle' && (
        <div data-reveal>
          <GlassUploader
            title="Drop media to begin forensic analysis"
            hint="Supports MP4, WAV, PNG, JPG, MOV, WebM up to 100 MB. Analyzed live against the Rennaigan ML gateway."
            onFiles={onFiles}
          />
        </div>
      )}

      {phase === 'error' && (
        <GlassPanel data-reveal level={3}>
          <ErrorState
            title="Analysis could not be completed"
            body={errorDetails || 'The media processing pipeline encountered an error.'}
            cause={rejected ? 'Unsupported codec or file format.' : 'Gateway or detector error.'}
            onRetry={reset}
            details={rejected ? `File: ${rejected.name}\nReported type: ${rejected.mime}\nAccepted: video, audio, image, screenshot` : errorDetails || undefined}
            secondary={<GlassButton onClick={reset}>Try another file</GlassButton>}
          />
        </GlassPanel>
      )}

      {(phase === 'processing' || phase === 'done') && picked && (
        <div className="flex flex-col gap-5">
          <GlassPanel data-reveal level={3} pad="lg">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                {picked.preview
                  ? <img src={picked.preview} alt="" className="size-11 shrink-0 rounded-[10px] border border-line object-cover" />
                  : <MediaGlyph type={picked.type} className="size-11" size={20} />}
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-[540] text-fg">{picked.name}</p>
                  <p className="t-meta"><span className="capitalize">{picked.type}</span>, {bytes(picked.size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {uploadPercent !== null && uploadPercent < 100 && (
                  <GlassBadge tone="info">Uploading {uploadPercent}%</GlassBadge>
                )}
                <GlassBadge tone={phase === 'done' ? 'ok' : 'accent'}>
                  {phase === 'done' ? 'Analysis complete' : STEPS[Math.min(step, STEPS.length - 1)]?.label || 'Processing'}
                </GlassBadge>
                <GlassButton size="sm" variant="quiet" iconOnly aria-label="Cancel and choose another file" onClick={reset} icon={<X size={15} weight="light" />} />
              </div>
            </div>
            <Pipeline steps={steps} className="mt-8" />
          </GlassPanel>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div ref={result} className="min-w-0">
              {phase === 'processing' ? (
                <GlassPanel data-reveal className="relative flex min-h-[340px] items-end justify-center overflow-hidden pb-7">
                  {prefs.effects && (
                    <Suspense fallback={null}><ForensicLens energy={1} className="absolute inset-0" /></Suspense>
                  )}
                  <div className="relative text-center" role="status" aria-live="polite">
                    <p className="t-label text-fg">
                      {uploadPercent !== null && uploadPercent < 100
                        ? `Uploading media (${uploadPercent}%)...`
                        : ['Ingesting media', 'Extracting metadata & frames', 'Running model detectors', 'Computing evidence fusion', 'Sealing cryptographic audit trail'][Math.min(step, 4)]}
                    </p>
                    <p className="t-mono mt-2 text-fg-3">Stage {Math.min(step + 1, STEPS.length)} of {STEPS.length}</p>
                  </div>
                </GlassPanel>
              ) : realCase ? (
                <GlassPanel level={4} pad="lg" as="section" aria-labelledby="result-title">
                  <div data-result-head>
                    <div className="flex items-baseline gap-3">
                      <p className="t-num text-[4rem] font-[520] leading-none tracking-[-0.05em] text-fg">
                        {realCase.trust_score ?? '--'}
                      </p>
                      <span className="t-mono text-sm text-fg-3">/ 100 Trust Score</span>
                    </div>
                    <h2 id="result-title" className="mt-3 flex flex-wrap items-center gap-3 text-xl font-[540] tracking-[-0.02em]">
                      Verdict: {realCase.verdict ? VERDICT_META[realCase.verdict.verdict].label : realCase.label}
                      {realCase.verdict && <VerdictBadge verdict={realCase.verdict} />}
                    </h2>
                    <p className="t-body mt-2 text-sm text-fg-2">
                      {realCase.assessment?.explanation || realCase.verdict?.headline || realCase.label_reason}
                    </p>
                    <p className="t-meta mt-2">
                      {realCase.verdict?.source === 'claude'
                        ? `Reasoned from the detector findings by ${realCase.assessment?.model}. Detector result: ${realCase.label}.`
                        : `Rule-based verdict from the fused detector scores (${realCase.label}).`}
                    </p>
                  </div>

                  <ul className="mt-6 flex flex-col gap-2">
                    {realCase.findings.length > 0 ? (
                      realCase.findings.map((f, i) => (
                        <li key={f.id || i} data-interval>
                          <button
                            type="button"
                            onClick={() => navigate(`/analysis/${realCase.id}`)}
                            className="glass-inner row-hover group flex w-full items-center gap-4 px-4 py-3.5 text-left"
                          >
                            <span className="t-mono w-[6rem] shrink-0 text-fg">
                              Score {(f.score * 100).toFixed(0)}%
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="t-label block text-fg">{f.module} ({f.model})</span>
                              <span className="t-meta block truncate">{f.note}</span>
                            </span>
                            <GlassBadge tone={f.score > 0.6 ? 'danger' : f.score > 0.3 ? 'warn' : 'ok'}>
                              {f.kind}
                            </GlassBadge>
                            <ArrowRight size={16} weight="light" className="shrink-0 text-fg-3 transition-transform duration-300 group-hover:translate-x-1 group-hover:text-fg" />
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="py-6 text-center text-sm text-fg-3">
                        No manipulation markers exceeded threshold. Media verified authentic.
                      </li>
                    )}
                  </ul>

                  <div data-result-foot className="mt-6 flex flex-wrap items-center gap-2">
                    <GlassButton variant="primary" to={`/analysis/${realCase.id}`} trailing={<ArrowRight size={15} weight="light" />}>
                      Open forensic workstation
                    </GlassButton>
                    <GlassButton to={`/reports/${realCase.id}`}>View report</GlassButton>
                    <GlassButton to={`/audit/${realCase.id}`}>Audit trail</GlassButton>
                  </div>

                  <p data-result-foot className="t-meta mt-5 border-t border-line pt-4">
                    <span className="text-ok flex items-center gap-1.5 font-medium">
                      <CheckCircle size={15} weight="fill" />
                      Live Case #{realCase.id} saved in gateway database.
                    </span>
                  </p>
                </GlassPanel>
              ) : null}
            </div>

            <GlassPanel data-reveal level={1} as="section" aria-labelledby="log-title" className="flex max-h-[420px] min-h-[340px] flex-col">
              <h2 id="log-title" className="t-label flex items-center justify-between gap-3 border-b border-line px-5 py-4 text-fg">
                Forensic events
                <GlassBadge tone="ok">Live Gateway</GlassBadge>
              </h2>
              <ol ref={log} aria-live="polite" className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
                {events.length === 0 && <li className="t-meta py-2">Waiting for pipeline start.</li>}
                {events.map((e, i) => (
                  <li key={i} className="grid grid-cols-[4.2rem_minmax(0,1fr)] gap-3 border-b border-line/50 py-2.5 last:border-b-0">
                    <span className="t-mono text-[0.75rem] text-fg-3">+{e.at.toFixed(2)}s</span>
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] text-fg-2">{e.text}</span>
                      <span className="t-label mt-0.5 block text-[0.625rem]">{e.step}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </GlassPanel>
          </div>
        </div>
      )}
    </div>
  )
}
