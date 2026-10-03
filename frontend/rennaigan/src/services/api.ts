/**
 * Rennaigan Data Access Layer.
 * Connects directly to the live Python gateway (services/backend.ts).
 * All data is computed and returned live from the ML pipeline and SQLite store.
 */
import { gateway } from './backend'
import {
  caseToAnomalies,
  caseToAudit,
  caseToGraph,
  caseToInvestigation,
} from '@/lib/caseAdapter'
import type { Anomaly, AuditEntry, CaseFull, Investigation, ReviewItem } from '@/types'

export class NotFoundError extends Error {
  readonly id: string
  constructor(id: string) {
    super(`Investigation ${id} was not found`)
    this.id = id
  }
}

export const api = {
  /** Overview stats and recent cases */
  overview: async () => {
    try {
      const res = await gateway.cases()
      if (res && res.cases && res.cases.length > 0) {
        const cases = res.cases
        const mapped = cases.map(caseToInvestigation)
        const counts = {
          active: cases.filter((c) => !c.review && c.label !== 'Clean').length,
          processing: 0,
          review: cases.filter(
            (c) => !c.review && (c.label === 'Review recommended' || c.label === 'Inconclusive'),
          ).length,
          verified: cases.filter((c) => !!c.review).length,
        }
        return {
          counts,
          active: mapped[0] ?? null,
          recent: mapped.slice(0, 10),
        }
      }
    } catch (e) {
      console.warn('Gateway unavailable or error loading overview:', e)
    }
    return {
      counts: { active: 0, processing: 0, review: 0, verified: 0 },
      active: null,
      recent: [],
    }
  },

  /** All investigations list */
  investigations: async (): Promise<Investigation[]> => {
    try {
      const res = await gateway.cases()
      if (res && res.cases && res.cases.length > 0) {
        return res.cases.map(caseToInvestigation)
      }
    } catch (e) {
      console.warn('Gateway unavailable or error loading investigations:', e)
    }
    return []
  },

  /** Single case by ID. If empty or 'latest', returns the most recent case */
  investigation: async (id?: string): Promise<Investigation> => {
    const targetId = (!id || id === 'latest') ? undefined : id
    if (!targetId) {
      const list = await gateway.cases()
      if (list && list.cases && list.cases.length > 0) {
        const full = await gateway.case(list.cases[0].id)
        return caseToInvestigation(full)
      }
      throw new NotFoundError('latest')
    }

    try {
      const caseFull = await gateway.case(targetId)
      if (caseFull && caseFull.id) {
        return caseToInvestigation(caseFull)
      }
    } catch {
      // Not found
    }
    throw new NotFoundError(targetId)
  },

  /** Raw full case by ID */
  caseFull: async (id?: string): Promise<CaseFull | null> => {
    try {
      const targetId = (!id || id === 'latest') ? undefined : id
      if (!targetId) {
        const list = await gateway.cases()
        if (list && list.cases && list.cases.length > 0) {
          return await gateway.case(list.cases[0].id)
        }
        return null
      }
      return await gateway.case(targetId)
    } catch {
      return null
    }
  },

  /** Anomalies for a case */
  anomalies: async (id?: string): Promise<Anomaly[]> => {
    try {
      const caseData = await api.caseFull(id)
      if (caseData) {
        return caseToAnomalies(caseData)
      }
    } catch {
      // Empty
    }
    return []
  },

  /** Audit trail for a case */
  audit: async (id?: string): Promise<AuditEntry[]> => {
    try {
      const caseData = await api.caseFull(id)
      if (caseData && caseData.audit) {
        return caseToAudit(caseData)
      }
    } catch {
      // Empty
    }
    return []
  },

  /** Evidence graph for a case */
  graph: async (id?: string) => {
    try {
      const caseData = await api.caseFull(id)
      if (caseData) {
        return caseToGraph(caseData)
      }
    } catch {
      // Empty
    }
    return null
  },

  /** Verification claims derived from case */
  claims: async (id?: string) => {
    try {
      const caseData = await api.caseFull(id)
      if (caseData) {
        return (caseData.findings || []).map((f, i) => ({
          id: `CLM-${caseData.id}-${i + 1}`,
          claim: f.note || `${f.module} detection (${f.model})`,
          finding: f.model,
          modality: f.module,
          status: f.score > 0.5 ? ('unsupported' as const) : ('verified' as const),
          source: `${f.module} analysis module`,
          evidenceCount: 1,
        }))
      }
    } catch {
      // Empty
    }
    return []
  },

  /** Review queue */
  reviewQueue: async (): Promise<ReviewItem[]> => {
    try {
      const res = await gateway.cases()
      if (res && res.cases && res.cases.length > 0) {
        const pendingCases = res.cases.filter((c) => !c.review)
        const queue: ReviewItem[] = []

        for (const c of pendingCases.slice(0, 15)) {
          queue.push({
            id: `REV-${c.id}`,
            investigationId: c.id,
            finding: c.label_reason || `${c.total_findings} findings detected (${c.label})`,
            modality: c.media?.media_type === 'audio' ? 'audio' : 'visual',
            confidence: Math.round(c.trust_score ?? 50),
            frame: 0,
            timecode: 0,
            explanation: c.label_reason || `Evaluation outcome: ${c.label}. Review recommended.`,
            region: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
            supporting: Object.keys(c.modules || {}),
          })
        }
        return queue
      }
    } catch {
      // Empty
    }
    return []
  },

  /** Record review decision on gateway */
  recordReview: async (id: string, decision: 'confirm' | 'reject' | 'inconclusive', note: string, analyst: string) => {
    return gateway.review(id, { decision, note, analyst })
  },

  /** Delete a case */
  deleteCase: async (id: string) => {
    return gateway.deleteCase(id)
  },

  /** Dissect a video case into frames at custom FPS */
  dissectVideo: async (id: string, opts?: { fps?: number; max_frames?: number; start_s?: number; end_s?: number; quality?: number }) => {
    return gateway.dissect(id, opts)
  },

  /** Direct URL for downloading all dissected frames as a ZIP archive */
  framesZipUrl: (id: string, fps = 2.0) => {
    return gateway.framesZipUrl(id, fps)
  },
}
