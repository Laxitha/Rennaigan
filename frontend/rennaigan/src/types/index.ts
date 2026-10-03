/**
 * Rennaigan Type Definitions.
 * Includes both gateway backend JSON schemas (backend/gateway.py) and frontend UI interfaces.
 */

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
export type MediaType = 'image' | 'video' | 'audio' | 'screenshot' | 'unknown'
export type ModuleStatus = 'ok' | 'degraded' | 'unavailable' | 'error' | 'not_applicable'
export type FindingKind = 'signal' | 'info' | 'error'
export type Decision = 'confirm' | 'reject' | 'inconclusive'
export type Modality = 'visual' | 'audio' | 'lipsync' | 'temporal' | 'metadata'
export type Severity = 'low' | 'medium' | 'high'
export type Level = 'low' | 'moderate' | 'high'
export type CaseStatus = 'active' | 'processing' | 'review' | 'verified' | 'inconclusive' | 'archived'
export type BulkStatus = 'queued' | 'processing' | 'analyzing' | 'review' | 'complete' | 'inconclusive' | 'failed'
export type Consistency = 'consistent' | 'contradicted' | 'partial' | 'unverified'

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface Finding {
  id: string
  module: string
  model: string
  /** 0 clean, 1 manipulated. */
  score: number
  start: number | null
  end: number | null
  /** [x, y, w, h] in pixels or normalized 0-1 of the source media. */
  region: number[] | null
  note: string
  kind: FindingKind
}

export interface ModuleInfo {
  status: ModuleStatus
  detail: string | null
  url?: string
  elapsed_s?: number | null
  runtime_s?: number | null
  file_sha256?: string | null
  weights_sha256?: Record<string, string>
  findings_count?: number
}

export interface MediaInfo {
  media_type: MediaType
  duration_s: number | null
  width: number | null
  height: number | null
  fps: number | null
  has_audio: boolean | null
}

export interface AuditEntry {
  seq: number
  timestamp: string
  action: string
  detail: string
  actor: string
  input_hash?: string | null
  output_hash?: string | null
  inputHash?: string
  outputHash?: string
  duration_ms?: number | null
  durationMs?: number
  confidence?: number | null
  model?: string
  modelVersion?: string
  extra?: Record<string, string>
  prev_hash?: string
  entry_hash?: string
}

export interface AuditVerification {
  case_id: string
  intact: boolean
  entries: number
  /** Sequence number of the first entry that fails, if any. */
  broken_at: number | null
  problems: Array<{ seq: number | null; problem: string }>
  head_hash: string | null
  result_matches_seal: boolean | null
  verified_at: string
}

export interface Review {
  decision: Decision
  note: string
  analyst: string
  recorded_at: string
}

export interface Artifact {
  name: string
  module: string
  url: string | null
  content_type: string | null
  available: boolean
}

export interface CaseFile {
  name: string
  size_bytes: number
  sha256: string
  content_type: string | null
  media_url: string | null
}

export type VerdictKind = 'real' | 'deepfake' | 'uncertain'

/** The final call on a file. `claude` when the reasoned assessment ran, `fusion` otherwise. */
export interface Verdict {
  verdict: VerdictKind
  /** 0-100: how likely the verdict is correct given the evidence gathered. */
  confidence: number
  source: 'claude' | 'fusion'
  headline: string
}

export interface Assessment {
  verdict: VerdictKind
  confidence: number
  headline: string
  explanation: string
  evidence: Array<{ detector: string; observation: string; direction: 'points_to_manipulation' | 'points_to_authentic' | 'neutral' }>
  caveats: string[]
  recommendation: string
  model: string
  generated_at: string
  similar_cases_used: string[]
}

export interface CaseSummary {
  id: string
  created_at: string
  mode: string
  file: CaseFile
  media: MediaInfo
  trust_score: number | null
  label: string
  label_reason: string | null
  /** Share of the applicable detector weight that produced evidence, 0 to 1. */
  evidence_weight: number
  module_scores: Record<string, number>
  total_findings: number
  runtime_s: number
  review: Review | null
  modules: Record<string, ModuleInfo>
  verdict?: Verdict | null
}

export interface CaseFull extends CaseSummary {
  module_coverage: Record<string, number>
  applicable_modules: string[]
  findings: Finding[]
  artifacts: Artifact[]
  audit: AuditEntry[]
  gateway_version: string
  fusion_verdict?: Verdict | null
  assessment?: Assessment | null
  assessment_error?: string | null
}

export interface ServiceHealth {
  ok: boolean
  url: string
  latency_ms: number
}

export interface Health {
  status: 'ok' | 'degraded' | 'down'
  services: Record<string, ServiceHealth>
  services_up: number
  services_total: number
  tools: Record<string, boolean>
  gateway: { version: string; cases: number; keep_media: boolean }
  rag: { enabled: boolean; retriever: string }
}

export interface GatewayInfo {
  version: string
  modules: Record<string, { url: string; detectors: string[] }>
  modules_for_media: Record<string, string[]>
  thresholds: Record<string, number>
  temperatures: Record<string, number>
  module_weights: Record<string, Record<string, number>>
  fusion: Record<string, number>
  labels: Record<string, number[]>
  preprocessing: Record<string, number>
  weights_sha256: Record<string, string>
}

export interface RagStatus {
  enabled: boolean
  retriever: string
  documents_indexed: number
  cases: number
}

export interface RagHit {
  score: number
  id: string
  case_id: string
  kind: string
  text: string
  metadata: Record<string, unknown>
}

/* ----------------------------------------------------------------- UI Types */

export interface Investigation {
  id: string
  media: string
  mediaType: MediaType
  format: string
  duration: number | null
  resolution: string | null
  sizeBytes: number
  createdAt: string
  analyst: string
  finding: string
  /** Confidence in the listed finding, 0-100. Never a verdict on authenticity. */
  confidence: number
  /** Share of the media the available evidence covers, 0-100. */
  coverage: number
  indicators: Level
  status: CaseStatus
  integrity: 'intact' | 're-encoded' | 'stripped'
  sha256: string
  signals: Record<Modality, number>
  seed: number
  rawCase?: CaseSummary | CaseFull
}

export interface Anomaly {
  id: string
  start: number
  end: number
  modality: Modality
  severity: Severity
  label: string
  title: string
  explanation: string
  frame: number
  confidence: number
  region?: Region
  indicators: string[]
  /** Node ids in the evidence graph that support this anomaly. */
  graphPath: string[]
  flagged: boolean
}

export type GraphKind = 'media' | 'modality' | 'feature' | 'anomaly' | 'external' | 'finding' | 'fusion' | 'assessment'

export interface GraphNode {
  id: string
  label: string
  kind: GraphKind
  x: number
  y: number
  detail: string
  ref: string
  weight?: number
}

export interface GraphEdge {
  from: string
  to: string
}

export interface Source {
  id: string
  publisher: string
  kind: string
  title: string
  retrievedAt: string
  stance: 'supports' | 'contradicts' | 'neutral'
  excerpt: string
  reliability: Level
}

export interface Claim {
  id: string
  text: string
  origin: string
  timecode: number
  consistency: Consistency
  confidence: number
  summary: string
  sources: Source[]
}

export interface ReviewItem {
  id: string
  investigationId: string
  finding: string
  modality: Modality
  confidence: number
  frame: number
  timecode: number
  explanation: string
  region: Region
  supporting: string[]
}

export interface ModelSignal {
  modality: Modality
  label: string
  detector: string
  precision: number
  recall: number
  evaluatedOn: number
}

export interface ModelVersion {
  version: string
  releasedAt: string
  note: string
  status: 'deployed' | 'retired' | 'candidate'
}

export interface KnowledgeArticle {
  id: string
  title: string
  category: string
  updatedAt: string
  summary: string
}

export interface BulkItem {
  id: string
  name: string
  type: MediaType | 'unsupported'
  sizeBytes: number
  status: BulkStatus
  progress: number
  indicators: Level | null
  evidence: number | null
  caseId?: string
  /** Why the file failed, in plain words. */
  error?: string
}

export interface DissectedFrame {
  index: number
  frame_number: number
  timestamp_s: number
  timecode: string
  filename: string
  url: string
  width: number
  height: number
  sharpness: number
  faces_count: number
  face_boxes: number[][]
}

export interface VideoDissectionResult {
  case_id: string
  video_info: {
    source_fps: number
    total_frames: number
    duration_s: number
    width: number
    height: number
    resolution: string
  }
  dissection: {
    requested_fps: number
    actual_interval_frames: number
    effective_fps: number
    extracted_count: number
    start_s: number
    end_s: number
    max_frames: number
  }
  frames: DissectedFrame[]
}

