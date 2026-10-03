"""AI-generated video check: the UnivFD image detector applied to sampled frames.

The face detectors look for swaps and reenactment in real footage; they say nothing about a
video that was generated outright. This fills that gap. Video compression removes part of what
UnivFD relies on, so the per-frame scores are combined with a median, which a few odd frames
cannot move.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256

MAX_FRAMES = 16


def analyze(file_path: Path, frames_dir: Path, timestamps: list[float]) -> ModuleResult:
    from image.univfd_detector import TRANSFORM, WEIGHTS_PATH, load_model

    t0 = time.time()
    sha = file_sha256(file_path)
    files = sorted(frames_dir.glob("*.jpg"))
    if not files:
        return ModuleResult(module="video", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="univfd_video", score=0.0, note="no_frames: no frame could be decoded")])

    picks = sorted(set(np.linspace(0, len(files) - 1, min(MAX_FRAMES, len(files))).round().astype(int).tolist()))
    clip_model, fc, device = load_model()
    batch = torch.stack([TRANSFORM(Image.open(files[i]).convert("RGB")) for i in picks]).to(device)
    with torch.no_grad():
        scores = torch.sigmoid(fc(clip_model.encode_image(batch))).flatten().cpu().numpy()

    top = int(np.argmax(scores))
    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=[Finding(
            model="univfd_video",
            score=float(np.median(scores)),
            note=(f"ai_generated_frames: median of {len(picks)} frames, {float((scores >= 0.5).mean()):.0%} at or above 0.5, "
                  f"highest {scores[top]:.2f} at {timestamps[picks[top]]:.1f} s"),
        )],
        weights_sha256={"univfd": weights_sha256(WEIGHTS_PATH)},
        runtime_s=time.time() - t0,
    )
