"""Frame-level face-swap scoring — reuses SBI on sampled video frames.

Extracts frames at 3 fps, runs SBI on the largest face per frame,
smooths with rolling median, converts to timed intervals with hysteresis.
Clip-level score = 90th percentile of smoothed scores.
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

SAMPLE_FPS = 3
SMOOTH_WINDOW = 5
THRESHOLD_HIGH = 0.6
THRESHOLD_LOW = 0.4
MIN_INTERVAL_SEC = 0.5
MERGE_GAP_SEC = 1.0


def smooth_scores(scores: list[float], window: int = SMOOTH_WINDOW) -> list[float]:
    """Rolling median over `window` samples (~1.7s at 3fps)."""
    if len(scores) < window:
        return scores
    result = []
    half = window // 2
    for i in range(len(scores)):
        start = max(0, i - half)
        end = min(len(scores), i + half + 1)
        result.append(float(np.median(scores[start:end])))
    return result


def scores_to_intervals(
    timestamps: list[float],
    scores: list[float],
) -> list[tuple[float, float, float]]:
    """Convert scores to intervals using hysteresis (0.6 on, 0.4 off)."""
    intervals = []
    active = False
    start = 0.0
    seg_scores = []

    for ts, sc in zip(timestamps, scores):
        if not active and sc >= THRESHOLD_HIGH:
            active = True
            start = ts
            seg_scores = [sc]
        elif active and sc < THRESHOLD_LOW:
            if ts - start >= MIN_INTERVAL_SEC:
                intervals.append((start, ts, float(np.mean(seg_scores))))
            active = False
            seg_scores = []
        elif active:
            seg_scores.append(sc)

    if active and timestamps[-1] - start >= MIN_INTERVAL_SEC:
        intervals.append((start, timestamps[-1], float(np.mean(seg_scores))))

    merged = []
    for interval in intervals:
        if merged and interval[0] - merged[-1][1] < MERGE_GAP_SEC:
            prev = merged.pop()
            merged.append((prev[0], interval[1], max(prev[2], interval[2])))
        else:
            merged.append(interval)

    return merged


def analyze(file_path: Path, frames_dir: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    if frames_dir is None:
        from common.preprocess import preprocess_media
        import tempfile
        work = Path(tempfile.mkdtemp(prefix="tf_video_"))
        result = preprocess_media(file_path, work)
        frames_dir = result["frames_dir"]

    frame_files = sorted(frames_dir.glob("*.jpg"))
    if not frame_files:
        return ModuleResult(module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    from image.sbi_detector import analyze_image

    timestamps = []
    raw_scores = []
    no_face_count = 0

    for i, frame_path in enumerate(frame_files):
        ts = i / SAMPLE_FPS
        img = cv2.imread(str(frame_path))
        if img is None:
            continue

        # A missing weight file or dependency propagates: scoring it as 0 would read as "clean".
        face_findings = analyze_image(img)
        max_score = max((f.score for f in face_findings), default=0.0)
        if not face_findings:
            no_face_count += 1

        timestamps.append(ts)
        raw_scores.append(max_score)

    if not timestamps:
        return ModuleResult(module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    smoothed = smooth_scores(raw_scores)
    intervals = scores_to_intervals(timestamps, smoothed)

    clip_score = float(np.percentile(smoothed, 90)) if smoothed else 0.0

    findings = [
        Finding(
            model="sbi_video",
            score=avg_score,
            start=start,
            end=end,
            note="face_swap_interval",
        )
        for start, end, avg_score in intervals
    ]

    coverage = 1.0 - (no_face_count / len(frame_files)) if frame_files else 0.0
    findings.append(Finding(
        model="sbi_video",
        score=clip_score,
        note=f"clip_level_score_p90, visual_coverage={coverage:.2f}",
    ))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        runtime_s=time.time() - t0,
    )
