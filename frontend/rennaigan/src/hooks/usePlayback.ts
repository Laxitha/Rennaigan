import { useCallback, useEffect, useRef, useState } from 'react'

/** Simulated or media-driven playback clock. */
export function usePlayback(duration: number, fps = 25, isExternalClock = false) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const timeRef = useRef(0)
  // Read through a ref so seek stays stable and never clamps against a stale duration.
  const durationRef = useRef(duration)
  durationRef.current = duration

  const seek = useCallback((t: number) => {
    const next = Math.min(durationRef.current, Math.max(0, t))
    timeRef.current = next
    setTime(next)
  }, [])

  const syncTime = useCallback((t: number) => {
    const next = Math.min(durationRef.current, Math.max(0, t))
    timeRef.current = next
    setTime(next)
  }, [])

  useEffect(() => {
    if (!playing || isExternalClock) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const next = timeRef.current + dt * rate
      if (next >= duration) {
        timeRef.current = duration
        setTime(duration)
        setPlaying(false)
        return
      }
      timeRef.current = next
      setTime(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, rate, duration, isExternalClock])

  const play = useCallback(() => {
    if (timeRef.current >= duration) seek(0)
    setPlaying(true)
  }, [duration, seek])
  const pause = useCallback(() => setPlaying(false), [])
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play])
  const step = useCallback((frames: number) => {
    setPlaying(false)
    seek(Math.round(timeRef.current * fps + frames) / fps)
  }, [fps, seek])

  return { time, timeRef, playing, rate, setRate, seek, syncTime, play, pause, toggle, step, frame: Math.floor(time * fps) }
}

