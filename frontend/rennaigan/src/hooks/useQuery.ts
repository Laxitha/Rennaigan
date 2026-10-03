import { useCallback, useEffect, useState } from 'react'

interface State<T> { data: T | null; error: Error | null; loading: boolean }

/** Minimal async state: loading, error and retry for a promise-returning loader. */
export function useQuery<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loader().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: unknown) => live && setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}
