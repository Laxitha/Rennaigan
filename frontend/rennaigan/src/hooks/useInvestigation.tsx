import type { ReactNode } from 'react'
import { api } from '@/services/api'
import { ErrorState, ForensicLoader, GlassButton, GlassPanel } from '@/components/glass'
import type { Investigation } from '@/types'
import { useQuery } from './useQuery'

/**
 * Loads one investigation and returns a `gate` to render while it is loading or missing.
 */
export function useInvestigation(id: string, _view?: string): { investigation: Investigation | null; gate: ReactNode | null } {
  const { data, loading, error } = useQuery(() => api.investigation(id), [id])
  if (loading) return { investigation: null, gate: <ForensicLoader /> }
  if (error || !data) {
    return {
      investigation: null,
      gate: (
        <GlassPanel>
          <ErrorState
            title="Investigation not found"
            body={`No investigation with ID ${id} exists in this workspace.`}
            secondary={<GlassButton to="/cases">All cases</GlassButton>}
          />
        </GlassPanel>
      ),
    }
  }

  // All investigations (both gateway real cases and sample cases) are fully accessible.
  return { investigation: data, gate: null }
}
