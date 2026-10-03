import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { motionState } from '@/lib/motion'

export interface Prefs {
  motion: 'system' | 'reduced' | 'full'
  density: 'comfortable' | 'compact'
  /** 0.4 to 1. Scales travel distance of UI motion. */
  intensity: number
  /** Matrix rain, 3D and backdrop blur. */
  effects: boolean
}

const DEFAULTS: Prefs = { motion: 'system', density: 'comfortable', intensity: 1, effects: true }
const KEY = 'rennaigan.prefs.v1'

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

interface Ctx { prefs: Prefs; set: (patch: Partial<Prefs>) => void; reduced: boolean }
const PrefsContext = createContext<Ctx | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load)
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setSystemReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const reduced = prefs.motion === 'reduced' || (prefs.motion === 'system' && systemReduced)

  // Written during render so child effects in the same commit already see the new values.
  motionState.reduced = reduced
  motionState.intensity = prefs.intensity

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = prefs.density
    root.dataset.effects = prefs.effects ? 'on' : 'off'
    root.dataset.motion = prefs.motion === 'system' ? 'system' : prefs.motion
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* storage unavailable */ }
  }, [prefs])

  const set = useCallback((patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch })), [])
  const value = useMemo(() => ({ prefs, set, reduced }), [prefs, set, reduced])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs() {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used inside PrefsProvider')
  return ctx
}
