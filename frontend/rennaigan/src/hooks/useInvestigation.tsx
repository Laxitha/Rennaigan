import type { ReactNode } from 'react'
import { api, NotFoundError } from '@/services/api'
import { explainError, hostOf, useBackendUrl } from '@/services/backend'
import { ErrorState, ForensicLoader, GlassButton, GlassPanel } from '@/components/glass'
import type { Investigation } from '@/types'
import { useQuery } from './useQuery'

/**
 * Loads one investigation and returns a `gate` to render while it is loading or missing.
 */
export function useInvestigation(id: string, _view?: string): { investigation: Investigation | null; gate: ReactNode | null } {
  const { data, loading, error, retry } = useQuery(() => api.investigation(id), [id])
  const backendUrl = useBackendUrl()
  if (loading) return { investigation: null, gate: <ForensicLoader /> }
  if (error || !data) {
    const missing = !error || error instanceof NotFoundError
    const problem = explainError(error)
    return {
      investigation: null,
      gate: (
        <GlassPanel>
          {missing ? (
            <ErrorState
              title="Investigation not found"
              body={`The backend at ${hostOf(backendUrl) || 'the configured address'} has no case ${id}.`}
              cause="Cases are stored on the backend that analysed them. If you switched between Colab and the local backend, or started a new Colab runtime, this case is on the other one."
              onRetry={retry}
              secondary={<GlassButton to="/cases">All cases</GlassButton>}
            />
          ) : (
            <ErrorState
              title={problem.title}
              body={`${problem.body} Case ${id} could not be loaded, which does not mean it is gone.`}
              cause={problem.cause}
              details={problem.details}
              onRetry={retry}
              secondary={<GlassButton to="/settings">Check the gateway address</GlassButton>}
            />
          )}
        </GlassPanel>
      ),
    }
  }

  // All investigations (both gateway real cases and sample cases) are fully accessible.
  return { investigation: data, gate: null }
}
