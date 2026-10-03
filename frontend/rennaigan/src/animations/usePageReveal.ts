import type { RefObject } from 'react'
import { revealIn, useGSAP } from '@/lib/motion'

/**
 * Staggered entrance for everything marked data-reveal inside scope.
 * Re-runs when deps change (for example when async data arrives).
 */
export function usePageReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useGSAP(() => {
    const nodes = scope.current?.querySelectorAll('[data-reveal]:not([data-revealed])')
    if (!nodes?.length) return
    nodes.forEach((n) => n.setAttribute('data-revealed', ''))
    revealIn(nodes)
  }, { scope, dependencies: deps })
}
