"""AI-generated video check: the AI-image detector applied to sampled frames.

The face detectors look for swaps and reenactment in real footage; they say nothing about a
video that was generated outright. This fills that gap. Video compression removes part of what
the classifiers rely on, so the per-frame scores are combined with a median, which a few odd
frames cannot move.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

MAX_FRAMES = 16


def analyze(file_path: Path, frames_dir: Path, timestamps: list[float], max_frames: int = MAX_FRAMES) -> ModuleResult:
    from image.aigen_detector import score_images

    t0 = time.time()
    sha = file_sha256(file_path)
    files = sorted(frames_dir.glob("*.jpg"))
    if not files:
        return ModuleResult(module="video", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="aigen_video", score=0.0, note="no_frames: no frame could be decoded")])

    picks = sorted(set(np.linspace(0, len(files) - 1, min(max_frames, len(files))).round().astype(int).tolist()))
    scores = np.array([r["score"] for r in score_images([Image.open(files[i]).convert("RGB") for i in picks])])

    top = int(np.argmax(scores))
    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=[Finding(
            model="aigen_video",
            score=float(np.median(scores)),
            note=(f"clip_level: ai_generated_frames, median of {len(picks)} frames, {float((scores >= 0.5).mean()):.0%} at or above 0.5, "
                  f"highest {scores[top]:.2f} at {timestamps[picks[top]]:.1f} s"),
        )],
        runtime_s=time.time() - t0,
    )
