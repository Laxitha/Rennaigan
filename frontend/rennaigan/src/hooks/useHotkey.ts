import { useEffect, useRef } from 'react'

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * combo examples: "mod+k", "space", "arrowleft", "?", "1"
 * "mod" matches Cmd on macOS and Ctrl elsewhere.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, opts: { enabled?: boolean; allowInInputs?: boolean } = {}) {
  const ref = useRef(handler)
  ref.current = handler
  const { enabled = true, allowInInputs = false } = opts

  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]
    const needMod = parts.includes('mod')
    const needShift = parts.includes('shift')
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (needMod !== mod) return
      if (needShift && !e.shiftKey) return
      if (e.altKey) return
      const pressed = e.key === ' ' ? 'space' : e.key.toLowerCase()
      if (pressed !== key) return
      if (!allowInInputs && !needMod && isTyping(e.target)) return
      ref.current(e)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [combo, enabled, allowInInputs])
}
