"""SyncNet — audio-video lip sync consistency checker.

Setup:
  1. git clone https://github.com/joonson/syncnet_python.git repos/syncnet
  2. Download weights per their README → weights/syncnet.model
  3. pip install python_speech_features
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/syncnet.model")
WINDOW_SEC = 2.5
STRIDE_SEC = 1.0
CONFIDENCE_THRESHOLD = 3.0


def load_model():
    # TODO: Replace with actual SyncNet loading
    # import sys
    # sys.path.insert(0, "repos/syncnet")
    # from SyncNetModel import S as SyncNetModel
    # model = SyncNetModel()
    # model.loadParameters(str(WEIGHTS_PATH))
    # model.eval()
    # return model
    raise NotImplementedError(
        "Clone SyncNet repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def get_video_duration(video_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    try:
        duration = get_video_duration(file_path)
    except Exception:
        return ModuleResult(
            module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0
        )

    model = load_model()
    findings: list[Finding] = []

    # Slide windows across the video
    pos = 0.0
    while pos + WINDOW_SEC <= duration:
        # TODO: extract window, run SyncNet
        # offset, confidence = run_syncnet_window(model, file_path, pos, WINDOW_SEC)
        offset = 0.0  # placeholder
        confidence = 10.0  # placeholder (high = in sync)

        if confidence < CONFIDENCE_THRESHOLD:
            findings.append(Finding(
                model="syncnet",
                score=1.0 - min(confidence / 10.0, 1.0),
                start=pos,
                end=pos + WINDOW_SEC,
                note=f"low_sync_confidence={confidence:.2f}",
            ))

        pos += STRIDE_SEC

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"syncnet": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
