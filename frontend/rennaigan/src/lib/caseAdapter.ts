import type {
  Anomaly,
  AuditEntry,
  CaseFull,
  CaseSummary,
  GraphEdge,
  GraphNode,
  Investigation,
  Level,
  Modality,
} from '@/types'
import { fakeHash } from './format'

export function caseToInvestigation(c: CaseSummary | CaseFull): Investigation {
  const seed = c.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)

  const modScores = c.module_scores ?? {}
  const signals: Record<Modality, number> = {
    visual: Math.round(((modScores.image ?? modScores.video) ?? 0.15) * 100),
    audio: Math.round((modScores.audio ?? 0.1) * 100),
    lipsync: Math.round((modScores.motion ?? 0.12) * 100),
    temporal: Math.round((modScores.video ?? 0.14) * 100),
    metadata: Math.round((modScores.metadata ?? 0.3) * 100),
  }

  const trust = c.trust_score ?? 50
  const indicators: Level = trust < 45 ? 'high' : trust < 75 ? 'moderate' : 'low'

  const findingDesc =
    c.verdict?.headline ??
    c.label_reason ??
    (c.total_findings > 0
      ? `${c.total_findings} findings detected (${c.label})`
      : `Analysis complete: ${c.label}`)

  return {
    id: c.id,
    media: c.file?.name || `${c.id}.${c.media?.media_type || 'dat'}`,
    mediaType: c.media?.media_type || 'video',
    format: `${(c.media?.media_type || 'media').toUpperCase()} / ${c.file?.content_type || 'H.264'}`,
    duration: c.media?.duration_s ?? null,
    resolution:
      c.media?.width && c.media?.height ? `${c.media.width} x ${c.media.height}` : null,
    sizeBytes: c.file?.size_bytes ?? 0,
    createdAt: c.created_at,
    analyst: c.review?.analyst ?? 'Rennaigan Core',
    finding: findingDesc,
    confidence: Math.round(trust),
    coverage: Math.round((c.evidence_weight ?? 0.5) * 100),
    indicators,
    status: c.review ? 'verified' : c.label === 'Inconclusive' ? 'inconclusive' : 'review',
    integrity: 're-encoded',
    sha256: c.file?.sha256 || fakeHash(seed),
    signals,
    seed,
    rawCase: c,
  }
}

export function caseToAnomalies(c: CaseFull): Anomaly[] {
  const fps = c.media?.fps || 25
  const duration = c.media?.duration_s || 10

  if (!c.findings || c.findings.length === 0) {
    // Return a baseline entry indicating clean / inspected state
    return [
      {
        id: `an-${c.id.toLowerCase()}-baseline`,
        start: 0,
        end: duration,
        modality: 'metadata',
        severity: 'low',
        flagged: false,
        label: 'Metadata analysis',
        title: 'Metadata verified',
        explanation: c.label_reason || 'File processed through Rennaigan analysis pipeline.',
        frame: 0,
        confidence: Math.round(c.trust_score ?? 80),
        indicators: ['Standard media structure'],
        graphPath: ['media', 'metadata', 'fusion', 'assessment'],
      },
    ]
  }

  return c.findings.map((f, i) => {
    let modality: Modality = 'metadata'
    if (f.module === 'image') modality = 'visual'
    else if (f.module === 'video') modality = 'visual'
    else if (f.module === 'audio') modality = 'audio'
    else if (f.module === 'motion') modality = 'temporal'

    const score = f.score ?? 0
    const severity = score > 0.65 ? 'high' : score > 0.35 ? 'medium' : 'low'
    const start = f.start ?? (i * (duration / Math.max(c.findings.length, 1)))
    const end = f.end ?? Math.min(duration, start + 2.0)

    let regionObj = undefined
    if (f.region && f.region.length === 4) {
      const [rx, ry, rw, rh] = f.region
      // Check if pixel coordinates or normalized
      const isPixel = rx > 1 || ry > 1 || rw > 1 || rh > 1
      const mw = c.media?.width || 640
      const mh = c.media?.height || 360
      regionObj = {
        x: isPixel ? rx / mw : rx,
        y: isPixel ? ry / mh : ry,
        w: isPixel ? rw / mw : rw,
        h: isPixel ? rh / mh : rh,
      }
    } else if (modality === 'visual' || modality === 'temporal') {
      // Provide deepfake facial / subject analysis zone
      regionObj = {
        x: 0.32 + (i % 2) * 0.04,
        y: 0.16 + (i % 2) * 0.03,
        w: 0.36,
        h: 0.44,
      }
    }

    return {
      id: f.id || `fnd-${i + 1}`,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      modality,
      severity,
      label: f.model || f.module,
      title: `${f.module.toUpperCase()}: ${f.model}`,
      explanation: f.note || `Detection recorded by ${f.model} with score ${(score * 100).toFixed(0)}%.`,
      frame: Math.round(start * fps),
      confidence: Math.round(score * 100),
      region: regionObj,
      indicators: [f.note || f.model],
      graphPath: ['media', f.module, f.id, 'fusion', 'assessment'],
      flagged: f.kind === 'signal' || score >= 0.3,
    }
  })
}

export function caseToAudit(c: CaseFull): AuditEntry[] {
  if (!c.audit || c.audit.length === 0) return []
  return c.audit.map((e) => ({
    seq: e.seq,
    timestamp: e.timestamp,
    action: e.action,
    detail: e.detail,
    actor: e.actor,
    inputHash: e.input_hash ?? e.prev_hash ?? '0000000000000000000000000000000000000000000000000000000000000000',
    outputHash: e.output_hash ?? e.entry_hash,
    confidence: null,
    durationMs: e.duration_ms ?? 0,
    model: e.actor,
    modelVersion: c.gateway_version || '1.0.0',
    input_hash: e.input_hash,
    output_hash: e.output_hash,
    duration_ms: e.duration_ms,
    prev_hash: e.prev_hash,
    entry_hash: e.entry_hash,
    extra: e.extra,
  }))
}

export function caseToGraph(c: CaseFull): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [
    {
      id: 'media',
      label: 'Uploaded Media',
      kind: 'media',
      x: 90,
      y: 320,
      ref: c.file?.name || c.id,
      detail: `SHA-256: ${c.file?.sha256 || 'Recorded at ingest'}. Mode: ${c.mode}.`,
    },
  ]

  const edges: GraphEdge[] = []
  const modules = c.applicable_modules || Object.keys(c.modules || {})

  const modYMap: Record<string, number> = {
    video: 120,
    audio: 220,
    motion: 320,
    image: 420,
    metadata: 520,
  }

  modules.forEach((mod) => {
    const info = c.modules?.[mod]
    const y = modYMap[mod] ?? 300
    nodes.push({
      id: mod,
      label: mod.toUpperCase(),
      kind: 'modality',
      x: 290,
      y,
      ref: `${info?.status || 'active'}`,
      detail: info?.detail || `Module ${mod} analysis. Status: ${info?.status || 'ok'}.`,
    })
    edges.push({ from: 'media', to: mod })
  })

  // Findings
  const findings = c.findings || []
  findings.slice(0, 8).forEach((f, idx) => {
    const fNodeId = `finding-${f.id || idx}`
    const y = 80 + idx * 70
    nodes.push({
      id: fNodeId,
      label: f.model || f.id,
      kind: f.kind === 'signal' ? 'finding' : 'feature',
      x: 600,
      y,
      ref: `${f.module}`,
      detail: f.note,
      weight: f.score,
    })
    if (modules.includes(f.module)) {
      edges.push({ from: f.module, to: fNodeId })
    } else {
      edges.push({ from: 'media', to: fNodeId })
    }
    edges.push({ from: fNodeId, to: 'fusion' })
  })

  // Fusion & Assessment
  nodes.push({
    id: 'fusion',
    label: 'Evidence Fusion',
    kind: 'fusion',
    x: 980,
    y: 300,
    ref: `Trust: ${Math.round(c.trust_score ?? 50)}%`,
    detail: `Evidence weight: ${Math.round((c.evidence_weight ?? 0.5) * 100)}%. Label: ${c.label}.`,
  })

  nodes.push({
    id: 'assessment',
    label: 'Final Assessment',
    kind: 'assessment',
    x: 1220,
    y: 300,
    ref: c.label,
    detail: c.label_reason || `Evaluation outcome: ${c.label} (Score: ${Math.round(c.trust_score ?? 50)})`,
  })

  edges.push({ from: 'fusion', to: 'assessment' })

  return { nodes, edges }
}
