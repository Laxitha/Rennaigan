"""Frame-level face-swap scoring — reuses SBI on sampled video frames.

Extracts frames at a configurable FPS, runs SBI face detection on each,
smooths per-face scores, and converts to time intervals.
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

SAMPLE_FPS = 3


def extract_frames(video_path: Path, fps: int = SAMPLE_FPS) -> list[tuple[float, Path]]:
    tmpdir = Path(tempfile.mkdtemp(prefix="tf_frames_"))
    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        str(tmpdir / "frame_%05d.jpg"),
        "-y", "-loglevel", "error",
    ]
    subprocess.run(cmd, check=True)

    frames = []
    for i, f in enumerate(sorted(tmpdir.glob("frame_*.jpg"))):
        timestamp = i / fps
        frames.append((timestamp, f))
    return frames


def smooth_scores(timestamps: list[float], scores: list[float], window: int = 5) -> list[float]:
    if len(scores) < window:
        return scores
    kernel = np.ones(window) / window
    return np.convolve(scores, kernel, mode="same").tolist()


def scores_to_intervals(
    timestamps: list[float], scores: list[float], threshold: float = 0.5
) -> list[tuple[float, float, float]]:
    intervals = []
    start = None
    seg_scores = []

    for ts, sc in zip(timestamps, scores):
        if sc >= threshold:
            if start is None:
                start = ts
            seg_scores.append(sc)
        else:
            if start is not None:
                intervals.append((start, ts, float(np.mean(seg_scores))))
                start = None
                seg_scores = []

    if start is not None:
        intervals.append((start, timestamps[-1], float(np.mean(seg_scores))))

    return intervals


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    frames = extract_frames(file_path)
    if not frames:
        return ModuleResult(
            module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0
        )

    timestamps = []
    raw_scores = []

    for ts, frame_path in frames:
        # TODO: import and call sbi_detector on each frame
        # from image.sbi_detector import detect_faces, load_model
        # faces = detect_faces(cv2.imread(str(frame_path)))
        # max_score = max(face_scores) if face_scores else 0.0
        max_score = 0.0  # placeholder
        timestamps.append(ts)
        raw_scores.append(max_score)

    smoothed = smooth_scores(timestamps, raw_scores)
    intervals = scores_to_intervals(timestamps, smoothed, threshold=0.5)

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

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        runtime_s=time.time() - t0,
    )
