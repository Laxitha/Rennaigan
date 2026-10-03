import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)
// Replay timelines target panels that only exist for some anomaly types.
gsap.config({ nullTargetWarn: false })

/** Motion tokens. Every animation in the app reads timing and easing from here. */
export const EASE = {
  out: 'expo.out',
  soft: 'power3.out',
  inOut: 'power3.inOut',
  spring: 'back.out(1.5)',
  none: 'none',
} as const

export const DUR = { fast: 0.18, base: 0.32, slow: 0.56, cinematic: 0.9 } as const

/** Mutable runtime state written by the preferences provider. */
export const motionState = { reduced: false, intensity: 1 }

/** Duration that collapses to zero when motion is reduced. */
export const d = (seconds: number) => (motionState.reduced ? 0 : seconds)
/** Travel distance scaled by the user's animation intensity. */
export const dist = (px: number) => (motionState.reduced ? 0 : px * motionState.intensity)

/**
 * Entrance animations hide content first, so content must never depend on the
 * animation frame ticker running. If frames are throttled (occluded window,
 * background tab, embedded preview) this jumps the animation to its end state.
 * Rendering via progress() is synchronous and needs no ticker.
 */
export function ensureFinished<T extends gsap.core.Animation>(anim: T, afterMs?: number): T {
  const budget = afterMs ?? Math.ceil((anim.totalDuration() + 0.6) * 1000)
  setTimeout(() => { if (anim.progress() < 1 && !anim.paused()) anim.progress(1) }, budget)
  return anim
}

/** gsap.fromTo with the throttled-frames safeguard. Use for any entrance that starts hidden. */
export function fromToSafe(targets: gsap.TweenTarget, from: gsap.TweenVars, to: gsap.TweenVars) {
  return ensureFinished(gsap.fromTo(targets, from, to))
}

export function revealIn(targets: gsap.TweenTarget, vars: gsap.TweenVars = {}) {
  return ensureFinished(gsap.fromTo(
    targets,
    { autoAlpha: 0, y: dist(14) },
    {
      autoAlpha: 1, y: 0, duration: DUR.slow, ease: EASE.out, stagger: 0.045, clearProps: 'transform', ...vars,
      ...(motionState.reduced ? { duration: 0, stagger: 0, delay: 0 } : null),
    },
  ))
}

export { gsap, useGSAP }
