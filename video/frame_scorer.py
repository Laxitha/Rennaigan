"""Frame-level face-swap scoring — reuses SBI on sampled video frames.

Extracts frames at 3 fps, runs SBI on the largest face per frame,
smooths with rolling median, converts to timed intervals with hysteresis.
Clip-level score = median of the smoothed scores of frames with a face; sustained
high stretches are reported separately as intervals.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.sampling import extract_frames, probe_duration
from common.utils import file_sha256

SAMPLE_FPS = 3
MAX_FRAMES = 180
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


def analyze(file_path: Path, frames_dir: Path | None = None, timestamps: list[float] | None = None) -> ModuleResult:
    """Score sampled frames with the face-swap detector.

    `frames_dir` and `timestamps` come from the video module, which extracts the frames once
    for every frame-based detector. Standalone, the frames are extracted here.
    """
    t0 = time.time()
    sha = file_sha256(file_path)

    work = None
    if frames_dir is None:
        work = Path(tempfile.mkdtemp(prefix="tf_video_"))
        frames_dir = work
        timestamps = extract_frames(file_path, work, probe_duration(file_path), max_frames=MAX_FRAMES, max_fps=SAMPLE_FPS)

    try:
        frame_files = sorted(frames_dir.glob("*.jpg"))
        from image.sbi_detector import analyze_image

        times: list[float] = []
        raw_scores: list[float] = []
        faces_seen = 0
        for frame_path, ts in zip(frame_files, timestamps or []):
            img = cv2.imread(str(frame_path))
            if img is None:
                continue
            # A missing weight file or dependency propagates: scoring it as 0 would read as "clean".
            face_findings = analyze_image(img)
            faces_seen += bool(face_findings)
            times.append(ts)
            raw_scores.append(max((f.score for f in face_findings), default=0.0))
    finally:
        if work is not None:
            shutil.rmtree(work, ignore_errors=True)

    if not times or faces_seen == 0:
        return ModuleResult(module="video", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="sbi_video", score=0.0, note="no_face_detected: no sampled frame contained a face to score")])

    smoothed = smooth_scores(raw_scores)
    findings = [
        Finding(model="sbi_video", score=avg_score, start=start, end=end, note="face_swap_interval")
        for start, end, avg_score in scores_to_intervals(times, smoothed)
    ]
    # Frames without a face score 0, so the clip score is taken over frames that had one.
    with_face = [s for s, r in zip(smoothed, raw_scores) if r > 0] or smoothed
    findings.append(Finding(
        model="sbi_video",
        score=float(np.median(with_face)),
        note=f"clip_level: median over {len(with_face)} frames with a face ({len(times)} sampled)",
    ))

    # Per-frame scores, so the UI and reviewers can see where in the clip the signal sits.
    scores_path = file_path.with_suffix(".frame_scores.json")
    scores_path.write_text(json.dumps({
        "frames": [{"t": round(t, 3), "score": round(r, 4), "smoothed": round(float(m), 4)}
                   for t, r, m in zip(times, raw_scores, smoothed)],
    }))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        artifacts={"frame_scores": str(scores_path)},
        runtime_s=time.time() - t0,
    )
