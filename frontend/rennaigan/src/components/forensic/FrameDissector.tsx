import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  FilmStrip,
  SlidersHorizontal,
  DownloadSimple,
  Play,
  X,
  WarningCircle,
  Sparkle,
  BoundingBox,
} from '@phosphor-icons/react'
import { api } from '@/services/api'
import { absUrl, useBackendUrl } from '@/services/backend'
import { GlassButton, GlassPanel } from '@/components/glass'
import type { DissectedFrame, VideoDissectionResult } from '@/types'

interface FrameDissectorProps {
  caseId: string
  sourceFps?: number | null
  durationS?: number | null
  onSeek?: (seconds: number) => void
  currentTime?: number
}

const FPS_PRESETS = [
  { label: '0.5 FPS', value: 0.5, desc: '1 frame every 2s' },
  { label: '1.0 FPS', value: 1.0, desc: '1 frame / sec' },
  { label: '2.0 FPS', value: 2.0, desc: 'Dense sampling' },
  { label: '5.0 FPS', value: 5.0, desc: 'Standard forensic' },
  { label: '10.0 FPS', value: 10.0, desc: 'High frequency' },
  { label: '24.0 FPS', value: 24.0, desc: 'Cinema / Native' },
]

export function FrameDissector({
  caseId,
  sourceFps = 24.0,
  durationS = 10.0,
  onSeek,
  currentTime = 0,
}: FrameDissectorProps) {
  const backendUrl = useBackendUrl()
  const [fps, setFps] = useState<number>(2.0)
  const [maxFrames, setMaxFrames] = useState<number>(120)
  const [dissection, setDissection] = useState<VideoDissectionResult | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFrame, setSelectedFrame] = useState<DissectedFrame | null>(null)
  const [filterFacesOnly, setFilterFacesOnly] = useState<boolean>(false)
  const [viewMode, setViewMode] = useState<'grid' | 'filmstrip'>('grid')

  const effectiveDuration = dissection?.video_info.duration_s ?? durationS ?? 10
  const estimatedFrames = useMemo(() => {
    return Math.min(maxFrames, Math.max(1, Math.round(effectiveDuration * fps)))
  }, [effectiveDuration, fps, maxFrames])

  const handleDissect = useCallback(async () => {
    if (!caseId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.dissectVideo(caseId, {
        fps,
        max_frames: maxFrames,
        quality: 85,
      })
      setDissection(res)
      if (res.frames && res.frames.length > 0) {
        setSelectedFrame(res.frames[0])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dissect video frames')
    } finally {
      setLoading(false)
    }
  }, [caseId, fps, maxFrames])

  // Auto-run once at default 2 FPS on initial load if not dissected yet
  useEffect(() => {
    if (caseId && !dissection && !loading && !error) {
      handleDissect()
    }
  }, [caseId])

  const displayedFrames = useMemo(() => {
    if (!dissection?.frames) return []
    if (filterFacesOnly) {
      return dissection.frames.filter((f) => f.faces_count > 0)
    }
    return dissection.frames
  }, [dissection, filterFacesOnly])

  const activeIndex = useMemo(() => {
    if (!dissection?.frames || dissection.frames.length === 0) return -1
    // Find closest frame to currentTime
    let closestIdx = 0
    let minDiff = Math.abs(dissection.frames[0].timestamp_s - currentTime)
    for (let i = 1; i < dissection.frames.length; i++) {
      const diff = Math.abs(dissection.frames[i].timestamp_s - currentTime)
      if (diff < minDiff) {
        minDiff = diff
        closestIdx = i
      }
    }
    return closestIdx
  }, [dissection, currentTime])

  const zipDownloadUrl = useMemo(() => {
    return api.framesZipUrl(caseId, fps)
  }, [caseId, fps])

  return (
    <div className="space-y-4">
      {/* Control Card */}
      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          {/* Top row: Title and stats */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                <FilmStrip size={20} weight="bold" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white tracking-wide">
                  Temporal Frame Dissection
                </h3>
                <p className="text-xs text-neutral-400">
                  Configure extraction FPS rate to dissect frames for micro-anomaly inspection
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-300 font-mono">
                Source: {dissection?.video_info.source_fps ?? sourceFps ?? 24} FPS
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-300 font-mono">
                Duration: {effectiveDuration.toFixed(1)}s
              </span>
              {dissection && (
                <span className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-medium">
                  {dissection.frames.length} frames dissected
                </span>
              )}
            </div>
          </div>

          {/* Middle row: FPS Presets & Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5">
                <SlidersHorizontal size={14} className="text-red-400" />
                Dissection Extraction Rate:
                <span className="font-mono font-bold text-red-400 text-sm ml-1">{fps.toFixed(1)} FPS</span>
              </label>
              <span className="text-xs text-neutral-400 font-mono">
                Estimated output: ~{estimatedFrames} frames
              </span>
            </div>

            {/* Presets */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {FPS_PRESETS.map((p) => {
                const active = fps === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setFps(p.value)}
                    className={`px-3 py-2 rounded-lg text-left transition-all border ${
                      active
                        ? 'bg-red-500/20 border-red-500/50 text-white shadow-sm shadow-red-500/20'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="font-mono text-xs font-semibold">{p.label}</div>
                    <div className="text-[10px] text-neutral-400 truncate">{p.desc}</div>
                  </button>
                )
              })}
            </div>

            {/* Continuous Slider & Settings */}
            <div className="flex items-center gap-4 pt-1">
              <input
                type="range"
                min="0.5"
                max="30.0"
                step="0.5"
                value={fps}
                onChange={(e) => setFps(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-neutral-400">Max frames:</span>
                <select
                  value={maxFrames}
                  onChange={(e) => setMaxFrames(parseInt(e.target.value, 10))}
                  className="bg-neutral-900 border border-white/10 text-neutral-200 text-xs rounded px-2 py-1 font-mono"
                >
                  <option value={30}>30 frames</option>
                  <option value={60}>60 frames</option>
                  <option value={120}>120 frames</option>
                  <option value={240}>240 frames</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <GlassButton
                variant="primary"
                onClick={handleDissect}
                disabled={loading}
                className="!px-4 !py-2 text-xs font-semibold flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Extracting Frames ({fps.toFixed(1)} FPS)...
                  </>
                ) : (
                  <>
                    <Sparkle size={15} weight="bold" />
                    Dissect Video ({fps.toFixed(1)} FPS)
                  </>
                )}
              </GlassButton>

              {dissection && dissection.frames.length > 0 && (
                <a
                  href={zipDownloadUrl}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-neutral-800/80 hover:bg-neutral-700/80 border border-white/10 text-xs text-neutral-200 transition-colors"
                >
                  <DownloadSimple size={15} />
                  Download Frames (.ZIP)
                </a>
              )}
            </div>

            {dissection && dissection.frames.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterFacesOnly(!filterFacesOnly)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                    filterFacesOnly
                      ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <BoundingBox size={14} />
                  Faces Only ({dissection.frames.filter((f) => f.faces_count > 0).length})
                </button>

                <div className="flex rounded-md border border-white/10 bg-neutral-900 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`px-2 py-1 text-xs rounded ${
                      viewMode === 'grid' ? 'bg-white/10 text-white font-medium' : 'text-neutral-400'
                    }`}
                  >
                    Grid View
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('filmstrip')}
                    className={`px-2 py-1 text-xs rounded ${
                      viewMode === 'filmstrip' ? 'bg-white/10 text-white font-medium' : 'text-neutral-400'
                    }`}
                  >
                    Filmstrip Reel
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <WarningCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </GlassPanel>

      {/* Frame Gallery / Filmstrip View */}
      {dissection && displayedFrames.length > 0 && (
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-neutral-400 font-mono">
              Showing {displayedFrames.length} frames at {dissection.dissection.effective_fps} FPS effective
              (step interval: {dissection.dissection.actual_interval_frames} source frames)
            </span>
            <span className="text-[11px] text-neutral-400">
              Click any frame to jump the video player to that exact timestamp
            </span>
          </div>

          {viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 max-h-[520px] overflow-y-auto pr-1">
              {displayedFrames.map((frame) => {
                const isCurrent = activeIndex === frame.index
                const isSelected = selectedFrame?.index === frame.index
                const frameUrl = absUrl(backendUrl, frame.url) || frame.url

                return (
                  <div
                    key={frame.index}
                    onClick={() => {
                      setSelectedFrame(frame)
                      onSeek?.(frame.timestamp_s)
                    }}
                    className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-all bg-neutral-900/60 ${
                      isSelected
                        ? 'border-red-500 ring-2 ring-red-500/30'
                        : isCurrent
                        ? 'border-emerald-500/70 shadow-sm shadow-emerald-500/20'
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video bg-black/60 relative overflow-hidden">
                      <img
                        src={frameUrl}
                        alt={`Frame ${frame.timecode}`}
                        loading="lazy"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                      />
                      {/* Face detection badge */}
                      {frame.faces_count > 0 && (
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-red-600/80 text-[10px] font-mono text-white flex items-center gap-1 shadow">
                          <BoundingBox size={10} />
                          {frame.faces_count}
                        </div>
                      )}
                      {/* Play overlay button on hover */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="p-1.5 rounded-full bg-red-500 text-white shadow-lg">
                          <Play size={14} weight="fill" />
                        </div>
                      </div>
                    </div>

                    {/* Frame Meta */}
                    <div className="p-2 text-[11px] font-mono space-y-0.5">
                      <div className="flex items-center justify-between text-neutral-300">
                        <span className="font-semibold text-white">{frame.timecode}</span>
                        <span className="text-neutral-400">#{frame.frame_number}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-neutral-400">
                        <span>{frame.timestamp_s.toFixed(2)}s</span>
                        <span>sharp: {frame.sharpness.toFixed(0)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Filmstrip View */
            <div className="flex items-center gap-2 overflow-x-auto pb-3 pt-1 scrollbar-thin">
              {displayedFrames.map((frame) => {
                const isCurrent = activeIndex === frame.index
                const isSelected = selectedFrame?.index === frame.index
                const frameUrl = absUrl(backendUrl, frame.url) || frame.url

                return (
                  <div
                    key={frame.index}
                    onClick={() => {
                      setSelectedFrame(frame)
                      onSeek?.(frame.timestamp_s)
                    }}
                    className={`shrink-0 w-36 rounded-lg border overflow-hidden cursor-pointer transition-all bg-neutral-900 ${
                      isSelected
                        ? 'border-red-500 ring-2 ring-red-500/40'
                        : isCurrent
                        ? 'border-emerald-500'
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="aspect-video bg-black/60 relative">
                      <img
                        src={frameUrl}
                        alt={`Frame ${frame.timecode}`}
                        loading="lazy"
                        className="w-full h-full object-contain"
                      />
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/70 text-[9px] font-mono text-white">
                        {frame.timecode}
                      </span>
                    </div>
                    <div className="p-1.5 text-[10px] font-mono flex items-center justify-between text-neutral-400">
                      <span>#{frame.frame_number}</span>
                      {frame.faces_count > 0 && (
                        <span className="text-red-400 font-semibold">{frame.faces_count} face</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassPanel>
      )}

      {/* Frame Detail Inspector Modal / Overlay */}
      {selectedFrame && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-white/15 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white font-mono">
                  Frame #{selectedFrame.frame_number} ({selectedFrame.timecode})
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-neutral-300 font-mono">
                  {selectedFrame.timestamp_s.toFixed(3)}s
                </span>
                {selectedFrame.faces_count > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-mono">
                    {selectedFrame.faces_count} face{selectedFrame.faces_count > 1 ? 's' : ''} detected
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={absUrl(backendUrl, selectedFrame.url) || '#'}
                  download={selectedFrame.filename}
                  className="px-2.5 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-neutral-200 transition-colors flex items-center gap-1.5"
                >
                  <DownloadSimple size={14} />
                  Download Frame
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedFrame(null)}
                  className="p-1 rounded text-neutral-400 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body: Frame Canvas */}
            <div className="relative bg-black flex-1 min-h-[350px] max-h-[60vh] flex items-center justify-center p-2 overflow-hidden">
              <div className="relative max-h-full max-w-full">
                <img
                  src={absUrl(backendUrl, selectedFrame.url) || ''}
                  alt={`Frame ${selectedFrame.timecode}`}
                  className="max-h-[58vh] max-w-full object-contain mx-auto"
                />

                {/* Face bounding boxes if any */}
                {selectedFrame.face_boxes &&
                  selectedFrame.face_boxes.map((box, i) => {
                    const [bx, by, bw, bh] = box
                    // Scaled relative to frame width and height
                    const left = `${(bx / selectedFrame.width) * 100}%`
                    const top = `${(by / selectedFrame.height) * 100}%`
                    const w = `${(bw / selectedFrame.width) * 100}%`
                    const h = `${(bh / selectedFrame.height) * 100}%`

                    return (
                      <div
                        key={i}
                        style={{ left, top, width: w, height: h }}
                        className="absolute border-2 border-red-500 bg-red-500/10 pointer-events-none"
                      >
                        <span className="absolute -top-5 left-0 px-1 py-0.2 rounded bg-red-600 text-[10px] text-white font-mono">
                          Face {i + 1}
                        </span>
                      </div>
                    )
                  })}
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between bg-neutral-950/60 text-xs">
              <div className="text-neutral-400 font-mono space-x-4">
                <span>Resolution: {selectedFrame.width}x{selectedFrame.height}</span>
                <span>Sharpness: {selectedFrame.sharpness.toFixed(1)}</span>
                <span>File: {selectedFrame.filename}</span>
              </div>

              <div className="flex items-center gap-2">
                <GlassButton
                  variant="primary"
                  onClick={() => {
                    onSeek?.(selectedFrame.timestamp_s)
                    setSelectedFrame(null)
                  }}
                  className="!px-3 !py-1 text-xs flex items-center gap-1.5"
                >
                  <Play size={13} weight="fill" />
                  Jump Video Player Here
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
