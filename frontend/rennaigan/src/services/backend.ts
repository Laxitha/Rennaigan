/**
 * Client for the Rennaigan gateway (backend/gateway.py). Every number the app shows comes from here.
 *
 *   GET /health, GET /info, POST /analyze, GET /cases, GET /cases/:id, DELETE /cases/:id,
 *   POST /cases/:id/review, GET /cases/:id/audit/verify, GET /media/:id, GET /artifacts/:id/:file, GET /rag/status, POST /rag/query
 *
 * The gateway address is set in Settings. When the app is served locally it defaults to the
 * gateway's default port, so `python start.py` + `npm run dev` works with no configuration.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { AuditVerification, CaseFull, CaseSummary, Decision, GatewayInfo, Health, RagHit, RagStatus, VideoDissectionResult } from '@/types'

const KEY = 'rennaigan.backend.v2'
const EVENT = 'rennaigan:backend'
const DEFAULT_PORT = 8010
const ENV_URL = (import.meta.env.VITE_RENNAIGAN_API as string | undefined) ?? ''

/* ----------------------------------------------------------------- URL config */

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i

export class ConfigError extends Error {}

/** Accepts "abc.trycloudflare.com", full URLs, or URLs pasted with a path such as /docs. */
export function normalizeBackendUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  if (/\s/.test(text)) throw new ConfigError('Addresses cannot contain spaces.')
  // a bare address defaults to https, except local ones, which are normally plain http
  const bareHost = text.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].replace(/:\d+$/, '')
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `${PRIVATE_HOST.test(bareHost) ? 'http' : 'https'}://${text}`
  let url: URL
  try { url = new URL(withScheme) } catch { throw new ConfigError('That is not a valid address.') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError('Use an https:// address.')
  if (!/^(localhost|\[[0-9a-f:]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+)$/i.test(url.hostname)) throw new ConfigError('That does not look like a host name, for example abc-123.trycloudflare.com.')
  if (url.protocol === 'http:' && !PRIVATE_HOST.test(url.hostname)) {
    throw new ConfigError('Plain http is only allowed for localhost and local network addresses. Use the https:// address, because uploaded media is sent to it.')
  }
  return url.origin
}

/** When the app itself is served from a local address, assume the gateway runs beside it. */
function defaultUrl() {
  if (ENV_URL) return ENV_URL
  if (typeof location === 'undefined' || !PRIVATE_HOST.test(location.hostname)) return ''
  return `http://${location.hostname === 'localhost' ? '127.0.0.1' : location.hostname}:${DEFAULT_PORT}`
}

export function getBackendUrl(): string {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === null ? defaultUrl() : stored
  } catch { return defaultUrl() }
}

/** '' is stored explicitly so "no backend" survives a reload instead of falling back to the default. */
export function setBackendUrl(raw: string): string {
  const url = normalizeBackendUrl(raw)
  try { localStorage.setItem(KEY, url) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
  return url
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb) }
}

/** Current gateway URL, or '' when none is configured. */
export function useBackendUrl() {
  return useSyncExternalStore(subscribe, getBackendUrl, () => '')
}

export const hostOf = (url: string) => { try { return new URL(url).host } catch { return url } }
/** Absolute URL for a gateway-relative path such as /media/RG-... or /artifacts/... */
export const absUrl = (url: string, path: string | null | undefined) => (path && url ? `${url}${path}` : null)

/* -------------------------------------------------------------------- errors */

export type BackendErrorKind = 'unconfigured' | 'unreachable' | 'timeout' | 'http' | 'invalid' | 'aborted'
export class BackendError extends Error {
  readonly kind: BackendErrorKind
  readonly status?: number
  readonly body?: string
  constructor(kind: BackendErrorKind, message: string, status?: number, body?: string) {
    super(message)
    this.kind = kind
    this.status = status
    this.body = body
  }
}

/** Plain-language cause and detail for the error state. */
export function explainError(e: unknown): { title: string; body: string; cause: string; details: string } {
  if (!(e instanceof BackendError)) return { title: 'Something went wrong', body: 'The request could not be completed.', cause: 'An unexpected error occurred.', details: String(e) }
  switch (e.kind) {
    case 'unconfigured':
      return { title: 'No gateway configured', body: 'Rennaigan needs the address of its analysis gateway.', cause: 'Set it in Settings, under ML backend.', details: e.message }
    case 'unreachable':
      return { title: 'Gateway unreachable', body: 'The analysis gateway could not be reached.', cause: 'It may not be running (python start.py), the address may have changed, or it is blocking this site.', details: e.message }
    case 'timeout':
      return { title: 'Gateway timed out', body: 'The gateway took too long to respond.', cause: 'Large files can exceed the time limit, or the GPU is busy.', details: e.message }
    case 'http': {
      let detail = e.body ?? ''
      try { const j = JSON.parse(detail); if (typeof j.detail === 'string') detail = j.detail } catch { /* not JSON */ }
      return {
        title: e.status === 404 ? 'Not found' : 'Gateway error',
        body: e.status === 404 ? 'The gateway has no record of this.' : `The gateway returned an error (HTTP ${e.status}).`,
        cause: e.status === 413 ? 'The file is larger than the limit in config.yaml.' : e.status === 422 ? 'The gateway did not accept the request.' : e.status === 404 ? 'The case may have been deleted, or the gateway is using a different data folder.' : 'See the details.',
        details: `${e.message}${detail ? `\n\n${detail.slice(0, 1200)}` : ''}`,
      }
    }
    case 'invalid':
      return { title: 'Unexpected response', body: 'The gateway replied with something this app does not understand.', cause: 'The address may point at a different service.', details: e.message }
    default:
      return { title: 'Cancelled', body: 'The request was cancelled.', cause: 'It was stopped before it finished.', details: e.message }
  }
}

/* --------------------------------------------------------------------- fetch */

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const url = getBackendUrl()
  if (!url) throw new BackendError('unconfigured', 'No gateway address is set')
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, init.timeoutMs ?? 15_000)
  try {
    const res = await fetch(`${url}${path}`, { ...init, signal: ctl.signal, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
    if (!res.ok) throw new BackendError('http', `${init.method ?? 'GET'} ${path} returned ${res.status}`, res.status, await res.text().catch(() => ''))
    try { return (await res.json()) as T } catch { throw new BackendError('invalid', `${path} did not return JSON`) }
  } catch (e) {
    if (e instanceof BackendError) throw e
    if (timedOut) throw new BackendError('timeout', `${path} timed out`)
    throw new BackendError('unreachable', `${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`)
  } finally { clearTimeout(timer) }
}

export const gateway = {
  health: () => request<Health>('/health'),
  info: () => request<GatewayInfo>('/info'),
  cases: () => request<{ total: number; cases: CaseSummary[] }>('/cases?limit=500'),
  case: (id: string) => request<CaseFull>(`/cases/${encodeURIComponent(id)}`),
  deleteCase: (id: string) => request<{ deleted: string }>(`/cases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  review: (id: string, body: { decision: Decision; note: string; analyst: string }) =>
    request<CaseFull>(`/cases/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(body) }),
  /** Server-side recomputation of every hash in the case's audit chain. */
  verifyAudit: (id: string) => request<AuditVerification>(`/cases/${encodeURIComponent(id)}/audit/verify`),
  ragStatus: () => request<RagStatus>('/rag/status'),
  ragQuery: (query: string, caseId?: string, k = 5) =>
    request<{ hits: RagHit[] }>('/rag/query', { method: 'POST', body: JSON.stringify({ query, k, case_id: caseId ?? null }), timeoutMs: 60_000 }),
  dissect: (id: string, opts?: { fps?: number; max_frames?: number; start_s?: number; end_s?: number; quality?: number }) => {
    const params = new URLSearchParams()
    if (opts?.fps !== undefined) params.set('fps', String(opts.fps))
    if (opts?.max_frames !== undefined) params.set('max_frames', String(opts.max_frames))
    if (opts?.start_s !== undefined) params.set('start_s', String(opts.start_s))
    if (opts?.end_s !== undefined) params.set('end_s', String(opts.end_s))
    if (opts?.quality !== undefined) params.set('quality', String(opts.quality))
    const q = params.toString() ? `?${params.toString()}` : ''
    return request<VideoDissectionResult>(`/cases/${encodeURIComponent(id)}/dissect${q}`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
      timeoutMs: 60_000,
    })
  },
  framesZipUrl: (id: string, fps = 2.0) => {
    const base = getBackendUrl()
    return `${base}/cases/${encodeURIComponent(id)}/frames/zip?fps=${encodeURIComponent(fps)}`
  },
}

/** Health for a specific address (used by Settings before the address is saved). */
export async function checkHealth(url: string): Promise<Health & { latencyMs: number }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 12_000)
  const t0 = performance.now()
  try {
    const res = await fetch(`${url}/health`, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new BackendError('http', `GET /health returned ${res.status}`, res.status, await res.text().catch(() => ''))
    let raw: Health
    try { raw = await res.json() } catch { throw new BackendError('invalid', 'GET /health did not return JSON') }
    if (!raw || typeof raw !== 'object' || typeof raw.services !== 'object' || !raw.gateway) throw new BackendError('invalid', 'This address answered, but not like a Rennaigan gateway')
    return { ...raw, latencyMs: Math.round(performance.now() - t0) }
  } catch (e) {
    if (e instanceof BackendError) throw e
    if (ctl.signal.aborted) throw new BackendError('timeout', 'GET /health timed out')
    throw new BackendError('unreachable', `${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`)
  } finally { clearTimeout(timer) }
}

/** Live gateway health, refreshed on demand. */
export function useBackendHealth(url: string) {
  const [state, setState] = useState<{ health: (Health & { latencyMs: number }) | null; error: BackendError | null; loading: boolean }>({ health: null, error: null, loading: !!url })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!url) { setState({ health: null, error: null, loading: false }); return }
    let live = true
    setState((s) => ({ ...s, loading: true }))
    checkHealth(url).then(
      (health) => live && setState({ health, error: null, loading: false }),
      (error) => live && setState({ health: null, error: error instanceof BackendError ? error : new BackendError('unreachable', String(error)), loading: false }),
    )
    return () => { live = false }
  }, [url, attempt])
  const refresh = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, refresh }
}

/* ------------------------------------------------------------------- analyze */

export interface AnalyzeOptions {
  signal?: AbortSignal
  onUploadProgress?: (loaded: number, total: number) => void
  onUploaded?: () => void
  mode?: 'public' | 'identity'
  /** Groups files submitted together from the bulk page. */
  batchId?: string
  /** Detector runs can be slow. Default 15 minutes. */
  timeoutMs?: number
}

/** Files above this size go up in chunks: tunnels and proxies commonly cap one request at 100 MB. */
const CHUNKED_ABOVE = 48 * 1024 * 1024

function parseCase(status: number, text: string, what: string): CaseFull {
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new BackendError('invalid', `${what} did not return a case`, status, text) }
  const c = body as Partial<CaseFull> & { detail?: string }
  if (!c || typeof c.id !== 'string' || !Array.isArray(c.findings)) {
    throw new BackendError(typeof c?.detail === 'string' ? 'http' : 'invalid', typeof c?.detail === 'string' ? c.detail : `${what} did not return a case`, status, text)
  }
  return c as CaseFull
}

/** POST /uploads, PUT each chunk, then POST /uploads/:id/analyze. A failed chunk is retried twice. */
async function analyzeFileChunked(url: string, file: File, opts: AnalyzeOptions): Promise<CaseFull> {
  const call = async (path: string, init: RequestInit, what: string) => {
    let res: Response
    try { res = await fetch(`${url}${path}`, { ...init, signal: opts.signal }) } catch (e) {
      if (opts.signal?.aborted) throw new BackendError('aborted', 'Analysis cancelled')
      throw new BackendError('unreachable', `Network error contacting ${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`)
    }
    const text = await res.text()
    if (!res.ok) throw new BackendError('http', `${what} returned ${res.status}`, res.status, text)
    return text
  }
  const json = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const start = JSON.parse(await call('/uploads', { method: 'POST', headers: json, body: JSON.stringify({ name: file.name, size: file.size }) }, 'POST /uploads')) as { upload_id: string; chunk_bytes: number }
  const total = Math.ceil(file.size / start.chunk_bytes)
  for (let i = 0; i < total; i++) {
    const chunk = file.slice(i * start.chunk_bytes, (i + 1) * start.chunk_bytes)
    for (let attempt = 0; ; attempt++) {
      try { await call(`/uploads/${start.upload_id}/${i}`, { method: 'PUT', body: chunk }, `Upload of part ${i + 1}`); break } catch (e) {
        if (attempt >= 2 || !(e instanceof BackendError) || e.kind !== 'unreachable') throw e
      }
    }
    opts.onUploadProgress?.(Math.min((i + 1) * start.chunk_bytes, file.size), file.size)
  }
  opts.onUploaded?.()
  const text = await call(`/uploads/${start.upload_id}/analyze`, { method: 'POST', headers: json, body: JSON.stringify({ mode: opts.mode ?? 'public', batch_id: opts.batchId ?? null }) }, 'POST /analyze')
  return parseCase(200, text, 'POST /analyze')
}

/** POST /analyze with the file as multipart field "file". XHR is used for upload progress. */
export function analyzeFile(url: string, file: File, opts: AnalyzeOptions = {}): Promise<CaseFull> {
  if (file.size > CHUNKED_ABOVE) return analyzeFileChunked(url, file, opts)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('mode', opts.mode ?? 'public')
    if (opts.batchId) form.append('batch_id', opts.batchId)
    xhr.open('POST', `${url}/analyze`)
    xhr.timeout = opts.timeoutMs ?? 15 * 60_000
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onUploadProgress?.(e.loaded, e.total) }
    xhr.upload.onload = () => opts.onUploaded?.()
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new BackendError('http', `POST /analyze returned ${xhr.status}`, xhr.status, xhr.responseText)); return }
      try { resolve(parseCase(xhr.status, xhr.responseText, 'POST /analyze')) } catch (e) { reject(e) }
    }
    xhr.onerror = () => reject(new BackendError('unreachable', `Network error contacting ${hostOf(url)}`))
    xhr.ontimeout = () => reject(new BackendError('timeout', `POST /analyze timed out after ${Math.round(xhr.timeout / 1000)} s`))
    xhr.onabort = () => reject(new BackendError('aborted', 'Analysis cancelled'))
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    if (opts.signal?.aborted) { xhr.abort(); return }
    xhr.send(form)
  })
}
