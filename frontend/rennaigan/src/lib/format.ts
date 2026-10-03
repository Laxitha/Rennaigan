/** 11.08 -> "00:11.08" */
export function tc(seconds: number, withCs = true) {
  // work in whole centiseconds so 4.21 never prints as 4.20
  const total = Math.round(Math.max(0, seconds) * 100)
  const m = Math.floor(total / 6000)
  const whole = Math.floor((total % 6000) / 100)
  const cs = total % 100
  const base = `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}`
  return withCs ? `${base}.${String(cs).padStart(2, '0')}` : base
}

export function shortHash(hash: string, head = 8, tail = 6) {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' })
export const fmtDate = (iso: string) => dateFmt.format(new Date(iso))
export const fmtTime = (iso: string) => `${timeFmt.format(new Date(iso))} UTC`
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`

export function bytes(n: number) {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** Deterministic PRNG so demo data is stable between renders and sessions. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function fakeHash(seed: number, length = 64) {
  const r = mulberry32(seed)
  let out = ''
  for (let i = 0; i < length; i++) out += Math.floor(r() * 16).toString(16)
  return out
}
