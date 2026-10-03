"""SyncNet — audio-video lip sync consistency checker.

Setup:
  1. git clone https://github.com/joonson/syncnet_python.git repos/syncnet
  2. Run download_model.sh to get weights
  3. pip install python_speech_features

Input: 25 fps video with 16 kHz audio, split into 3-second windows.
Commands: run_pipeline.py (face tracking) then run_syncnet.py,
  both with --videofile, --reference, --data_dir.
Flag when: confidence < 3 or absolute offset > 3 frames (120ms).
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.utils import file_sha256
from common.preprocess import get_video_duration

CONFIDENCE_THRESHOLD = 3.0
OFFSET_THRESHOLD_FRAMES = 3
WINDOW_SEC = 3.0
STRIDE_SEC = 1.5


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path

    try:
        duration = get_video_duration(target)
    except Exception:
        return ModuleResult(module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    findings: list[Finding] = []
    pos = 0.0

    while pos + WINDOW_SEC <= duration:
        # TODO: extract 3s window and run SyncNet
        # 1. ffmpeg -ss {pos} -t 3 -i video25.mp4 window.mp4
        # 2. run_pipeline.py --videofile window.mp4 --reference ... --data_dir ...
        # 3. run_syncnet.py --videofile window.mp4 --reference ... --data_dir ...
        # 4. Parse output for offset and confidence

        offset = 0  # placeholder
        confidence = 10.0  # placeholder

        if confidence < CONFIDENCE_THRESHOLD or abs(offset) > OFFSET_THRESHOLD_FRAMES:
            score = 1.0 - min(confidence / 10.0, 1.0)
            findings.append(Finding(
                model="syncnet",
                score=score,
                start=pos,
                end=pos + WINDOW_SEC,
                note=f"av_offset={offset}frames, confidence={confidence:.2f}",
            ))

        pos += STRIDE_SEC

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"syncnet": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
