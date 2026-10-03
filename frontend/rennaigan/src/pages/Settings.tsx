import { useId, useRef, useState, type ReactNode } from 'react'
import { Bell, Brain, Check, Database, Eye, Plugs, ShieldCheck, SlidersHorizontal, UserCircle, WarningCircle } from '@phosphor-icons/react'
import { usePageReveal } from '@/animations/usePageReveal'
import { usePrefs } from '@/hooks/usePrefs'
import { cn } from '@/lib/cn'
import { d, dist, EASE, fromToSafe, useGSAP } from '@/lib/motion'
import { CopyButton, GlassBadge, GlassButton, GlassInput, GlassModal, GlassPanel, GlassSwitch, useToast } from '@/components/glass'
import { PageHeader } from '@/components/navigation/PageHeader'
import { useBackendUrl, setBackendUrl, useBackendHealth, checkHealth } from '@/services/backend'

const SECTIONS = [
  { id: 'ml', label: 'ML backend', icon: Brain },
  { id: 'appearance', label: 'Appearance', icon: Eye },
  { id: 'profile', label: 'Profile', icon: UserCircle },
  { id: 'analysis', label: 'Analysis preferences', icon: SlidersHorizontal },
  { id: 'notifications', label: 'Notification settings', icon: Bell },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'data', label: 'Data controls', icon: Database },
  { id: 'api', label: 'API and integrations', icon: Plugs },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

function Segmented<T extends string>({ label, value, options, onChange, description }: { label: string; value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; description?: string }) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
      <div className="min-w-0"><p id={id} className="text-sm font-[520] text-fg">{label}</p>{description && <p className="t-meta mt-0.5">{description}</p>}</div>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex gap-1 rounded-[12px] border border-line bg-white/[0.03] p-1">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            className={cn('h-8 rounded-[9px] px-3 text-[0.8125rem] font-[520] transition-colors', value === o.id ? 'border border-accent/40 bg-accent/[0.14] text-fg' : 'border border-transparent text-fg-3 hover:text-fg-2')}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

function Group({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="border-b border-line/70 py-6 first:pt-0 last:border-b-0 last:pb-0">
      <h3 className="t-label text-fg">{title}</h3>
      {description && <p className="t-meta mt-1.5">{description}</p>}
      <div className="mt-3 divide-y divide-line/50">{children}</div>
    </div>
  )
}

export default function Settings() {
  const scope = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const { prefs, set } = usePrefs()
  const toast = useToast()
  const backendUrl = useBackendUrl()
  const { health, loading: healthLoading, refresh: refreshHealth } = useBackendHealth(backendUrl)
  const [gatewayInput, setGatewayInput] = useState(backendUrl || 'http://127.0.0.1:8010')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [section, setSection] = useState<SectionId>('ml')
  const [local, setLocal] = useState({
    name: 'Meenakshi Raghavan', email: 'm.raghavan@rennaigan.example', title: 'Senior forensic analyst',
    autoReplay: true, heatDefault: true, threshold: 'balanced', frameSampling: 'every',
    nReview: true, nBatch: true, nModel: false, nDigest: true,
    twoFactor: true, sessionLock: true, retention: '180', redact: true,
  })
  const [erase, setErase] = useState(false)
  const intensityId = useId()
  usePageReveal(scope, [])
  const patch = (p: Partial<typeof local>) => setLocal((s) => ({ ...s, ...p }))

  useGSAP(() => {
    fromToSafe(body.current, { autoAlpha: 0, y: dist(10) }, { autoAlpha: 1, y: 0, duration: d(0.35), ease: EASE.out })
  }, [section])

  const handleSaveBackend = async () => {
    try {
      setTesting(true)
      setTestResult(null)
      const res = await checkHealth(gatewayInput)
      setBackendUrl(gatewayInput)
      refreshHealth()
      setTestResult({ ok: true, message: `Connected to Rennaigan gateway v${res.gateway.version} (${res.latencyMs} ms)` })
      toast({ title: 'Gateway address saved', description: `Connected to ${gatewayInput}`, tone: 'ok' })
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Could not reach gateway' })
      toast({ title: 'Gateway check failed', description: String(e), tone: 'danger' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div ref={scope}>
      <PageHeader title="Settings" description="Workspace configuration, ML backend gateway, and user preferences." />
      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav data-reveal aria-label="Settings sections" className="lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s) => (
              <li key={s.id} className="shrink-0">
                <button type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined}
                  className={cn('flex h-10 w-full items-center gap-2.5 whitespace-nowrap rounded-[10px] px-3 text-[0.8125rem] font-[520] transition-colors',
                    section === s.id ? 'bg-accent/[0.13] text-fg shadow-[inset_0_0_0_1px_rgb(255_77_148/0.3)]' : 'text-fg-3 hover:bg-white/[0.04] hover:text-fg')}>
                  <s.icon size={16} weight="light" />{s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <GlassPanel data-reveal as="section" aria-label={SECTIONS.find((s) => s.id === section)!.label} pad="lg">
          <div ref={body}>
            {section === 'ml' && (
              <div>
                <Group title="ML Gateway Connection" description="Address of the Python orchestrator & analysis gateway (backend/gateway.py). Defaults to port 8010 on localhost.">
                  <div className="grid gap-4 py-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-0 flex-1">
                        <GlassInput
                          label="Gateway URL"
                          value={gatewayInput}
                          onChange={(e) => setGatewayInput(e.target.value)}
                          placeholder="http://127.0.0.1:8010"
                        />
                      </div>
                      <GlassButton variant="primary" onClick={handleSaveBackend} disabled={testing}>
                        {testing ? 'Testing...' : 'Save & Connect'}
                      </GlassButton>
                      <GlassButton variant="quiet" onClick={() => { setGatewayInput('http://127.0.0.1:8010'); setBackendUrl('http://127.0.0.1:8010'); refreshHealth(); }}>
                        Reset default
                      </GlassButton>
                    </div>

                    {testResult && (
                      <div className={cn('flex items-center gap-2 rounded-[10px] border p-3 text-sm', testResult.ok ? 'border-ok/40 bg-ok/10 text-ok' : 'border-danger/40 bg-danger/10 text-danger')}>
                        {testResult.ok ? <Check size={16} weight="bold" /> : <WarningCircle size={16} weight="bold" />}
                        <span>{testResult.message}</span>
                      </div>
                    )}
                  </div>
                </Group>

                <Group title="Detector Services Status" description="Live status of the five forensic detector microservices connected through the gateway.">
                  <div className="py-2">
                    {healthLoading ? (
                      <p className="t-meta">Checking detector services...</p>
                    ) : health ? (
                      <div className="flex flex-col divide-y divide-line/40">
                        {Object.entries(health.services || {}).map(([name, s]) => (
                          <div key={name} className="flex items-center justify-between py-2.5">
                            <div>
                              <p className="text-sm font-[520] capitalize text-fg">{name} Detector</p>
                              <p className="t-mono text-[0.75rem] text-fg-3">{s.url} — {s.latency_ms} ms</p>
                            </div>
                            <GlassBadge tone={s.ok ? 'ok' : 'neutral'}>
                              {s.ok ? 'Online' : 'Offline / Standby'}
                            </GlassBadge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-2 text-sm text-fg-3">
                        Gateway is currently unreachable. Make sure <code className="text-accent">python start.py</code> is running.
                      </div>
                    )}
                  </div>
                </Group>

                <Group title="Host Tools & Environment" description="System utilities detected on the machine running the analysis gateway.">
                  {health?.tools ? (
                    <div className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4">
                      {Object.entries(health.tools).map(([tool, present]) => (
                        <div key={tool} className="glass-inner flex items-center justify-between p-3">
                          <span className="t-mono text-sm text-fg">{tool}</span>
                          <GlassBadge tone={present ? 'ok' : 'neutral'}>{present ? 'Present' : 'Missing'}</GlassBadge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="t-meta py-2">Connect to gateway to inspect host tools.</p>
                  )}
                </Group>

                <Group title="Gateway Metadata" description="Database storage and RAG engine status.">
                  <div className="grid grid-cols-2 gap-4 py-3 sm:grid-cols-3">
                    <div>
                      <dt className="t-label">Gateway Version</dt>
                      <dd className="t-mono mt-1 text-fg">{health?.gateway?.version || '1.0.0'}</dd>
                    </div>
                    <div>
                      <dt className="t-label">Total Stored Cases</dt>
                      <dd className="t-mono mt-1 text-fg">{health?.gateway?.cases ?? '--'}</dd>
                    </div>
                    <div>
                      <dt className="t-label">RAG Extension</dt>
                      <dd className="t-mono mt-1 text-fg">{health?.rag?.enabled ? 'Enabled' : 'Not configured'}</dd>
                    </div>
                  </div>
                </Group>
              </div>
            )}

            {section === 'profile' && (
              <form onSubmit={(e) => { e.preventDefault(); toast({ title: 'Profile saved', tone: 'ok' }) }}>
                <Group title="Profile" description="Shown on reports and audit entries you create.">
                  <div className="grid gap-5 py-3 sm:grid-cols-2">
                    <GlassInput label="Full name" value={local.name} onChange={(e) => patch({ name: e.target.value })} required autoComplete="name" />
                    <GlassInput label="Role" value={local.title} onChange={(e) => patch({ title: e.target.value })} autoComplete="organization-title" />
                    <GlassInput label="Work email" type="email" value={local.email} onChange={(e) => patch({ email: e.target.value })} required autoComplete="email" className="sm:col-span-2" hint="Used for review assignments and report delivery." />
                  </div>
                </Group>
                <div className="mt-6"><GlassButton type="submit" variant="primary">Save profile</GlassButton></div>
              </form>
            )}

            {section === 'appearance' && (
              <>
                <Group title="Motion and animation">
                  <Segmented label="Motion style" description="Respects your operating system preferences by default." value={prefs.motion}
                    onChange={(motion) => set({ motion })} options={[{ id: 'full', label: 'Full' }, { id: 'reduced', label: 'Reduced' }, { id: 'system', label: 'System' }]} />
                </Group>
                <Group title="Density">
                  <Segmented label="Information density" value={prefs.density} onChange={(density) => set({ density })}
                    options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]} />
                </Group>
                <Group title="Background effects">
                  <GlassSwitch label="Shaders and forensic lens" description="WebGL animations for analysis." checked={prefs.effects} onChange={(effects) => set({ effects })} />
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
                    <div>
                      <label htmlFor={intensityId} className="text-sm font-[520] text-fg">Background glow</label>
                      <p className="t-meta mt-0.5">Controls glass refraction intensity.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <input id={intensityId} type="range" min="0" max="1" step="0.05" value={prefs.intensity} onChange={(e) => set({ intensity: Number(e.target.value) })}
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prefs.intensity * 100)} aria-valuetext={`${Math.round(prefs.intensity * 100)} percent`}
                        className="h-1.5 w-32 accent-accent cursor-pointer" />
                      <span className="t-mono text-[0.8125rem] text-fg-3 w-8 text-right">{Math.round(prefs.intensity * 100)}%</span>
                    </div>
                  </div>
                </Group>
              </>
            )}

            {section === 'analysis' && (
              <>
                <Group title="Workstation defaults">
                  <GlassSwitch label="Auto-replay flagged intervals on selection" checked={local.autoReplay} onChange={(autoReplay) => patch({ autoReplay })} />
                  <GlassSwitch label="Show heatmap layer by default" checked={local.heatDefault} onChange={(heatDefault) => patch({ heatDefault })} />
                  <Segmented label="Threshold preset" description="Calibration sensitivity for anomaly scoring." value={local.threshold} onChange={(threshold) => patch({ threshold })}
                    options={[{ id: 'sensitive', label: 'High recall' }, { id: 'balanced', label: 'Balanced' }, { id: 'strict', label: 'High precision' }]} />
                </Group>
              </>
            )}

            {section === 'notifications' && (
              <Group title="Alert channels">
                <GlassSwitch label="Review assignments" description="When a case is routed to your queue." checked={local.nReview} onChange={(nReview) => patch({ nReview })} />
                <GlassSwitch label="Bulk batch completion" description="When an asynchronous queue finishes." checked={local.nBatch} onChange={(nBatch) => patch({ nBatch })} />
                <GlassSwitch label="Daily digest" description="Summary of cases opened and verified." checked={local.nDigest} onChange={(nDigest) => patch({ nDigest })} />
              </Group>
            )}

            {section === 'security' && (
              <>
                <Group title="Authentication">
                  <GlassSwitch label="Two-factor authentication" description="Hardware key or authenticator app required." checked={local.twoFactor} onChange={(twoFactor) => patch({ twoFactor })} />
                  <GlassSwitch label="Lock session after 15 minutes idle" checked={local.sessionLock} onChange={(sessionLock) => patch({ sessionLock })} />
                </Group>
              </>
            )}

            {section === 'data' && (
              <>
                <Group title="Retention">
                  <Segmented label="Keep source media for" description="Reports and audit trails are kept regardless." value={local.retention} onChange={(retention) => patch({ retention })}
                    options={[{ id: '30', label: '30 days' }, { id: '180', label: '180 days' }, { id: '365', label: '1 year' }]} />
                  <GlassSwitch label="Redact faces in shared reports" description="Applies to recipients outside the investigation." checked={local.redact} onChange={(redact) => patch({ redact })} />
                </Group>
                <Group title="Erase" description="Removes local preferences stored in this browser. Investigations are not affected.">
                  <div className="py-3"><GlassButton variant="danger" onClick={() => setErase(true)}>Erase local preferences</GlassButton></div>
                </Group>
              </>
            )}

            {section === 'api' && (
              <>
                <Group title="API access" description="Submit media and read findings from your own systems.">
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0"><p className="text-sm font-[520] text-fg">Workspace key</p><p className="t-mono mt-1 flex items-center gap-2 text-fg-2">rg_live_••••••••••••8a1f <CopyButton text="rg_live_8a1f4920" label="Workspace key" /></p></div>
                    <GlassButton size="sm" onClick={() => toast({ title: 'Key rotation simulated', tone: 'info' })}>Rotate</GlassButton>
                  </div>
                </Group>
                <Group title="Integrations">
                  {[['Case management webhook', 'Posts a signed event when a finding is recorded', true], ['Evidence storage', 'Write-once bucket for source media and reports', true], ['Messaging alerts', 'Not connected', false]].map(([name, desc, on]) => (
                    <div key={String(name)} className="flex items-center justify-between gap-4 py-3">
                      <div><p className="text-sm font-[520] text-fg">{name}</p><p className="t-meta">{desc}</p></div>
                      <GlassBadge tone={on ? 'ok' : 'neutral'}>{on ? 'Connected' : 'Not connected'}</GlassBadge>
                    </div>
                  ))}
                </Group>
              </>
            )}
          </div>
        </GlassPanel>
      </div>

      <GlassModal open={erase} onClose={() => setErase(false)} title="Erase local preferences?" description="Motion, density and background settings return to their defaults." width={440}
        footer={<><GlassButton onClick={() => setErase(false)}>Cancel</GlassButton><GlassButton variant="danger" onClick={() => { set({ motion: 'system', density: 'comfortable', intensity: 1, effects: true }); setErase(false); toast({ title: 'Preferences reset', tone: 'ok' }) }}>Erase</GlassButton></>}>
        <p className="text-sm text-fg-2">This affects only this browser.</p>
      </GlassModal>
    </div>
  )
}
