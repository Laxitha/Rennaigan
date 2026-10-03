"""SyncNet — audio-video lip sync consistency checker.

Setup:
  1. git clone https://github.com/joonson/syncnet_python.git repos/syncnet
  2. cd repos/syncnet && sh download_model.sh
  3. pip install python_speech_features scenedetect

Input: 25 fps video with 16 kHz audio, split into 3-second windows.
Pipeline: run_pipeline.py (face tracking) then run_syncnet.py
Flag when: confidence < 3 or absolute offset > 3 frames (120ms).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.utils import file_sha256
from common.preprocess import get_video_duration

REPO_PATH = Path("repos/syncnet")
CONFIDENCE_THRESHOLD = 3.0
OFFSET_THRESHOLD_FRAMES = 3
WINDOW_SEC = 3.0
STRIDE_SEC = 1.5


def run_syncnet_on_window(video_path: Path, start_sec: float, duration: float) -> dict | None:
    """Run SyncNet pipeline on a video window. Returns {offset, confidence}."""
    if not REPO_PATH.exists():
        raise FileNotFoundError(
            f"SyncNet repo not found at {REPO_PATH}.\n"
            "git clone https://github.com/joonson/syncnet_python.git repos/syncnet"
        )

    with tempfile.TemporaryDirectory(prefix="syncnet_") as tmpdir:
        window_path = Path(tmpdir) / "window.avi"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start_sec), "-t", str(duration),
             "-i", str(video_path), "-r", "25",
             "-vcodec", "libx264","-an", str(window_path),
             "-loglevel", "error"],
            check=True, capture_output=True,
        )

        audio_path = Path(tmpdir) / "window.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start_sec), "-t", str(duration),
             "-i", str(video_path), "-ar", "16000", "-ac", "1",
             str(audio_path), "-loglevel", "error"],
            check=True, capture_output=True,
        )

        if not window_path.exists() or not audio_path.exists():
            return None

        data_dir = Path(tmpdir) / "data"
        data_dir.mkdir()

        env = os.environ.copy()
        env["PYTHONPATH"] = str(REPO_PATH)

        try:
            subprocess.run(
                [sys.executable, str(REPO_PATH / "run_pipeline.py"),
                 "--videofile", str(window_path),
                 "--reference", "window",
                 "--data_dir", str(data_dir)],
                check=True, capture_output=True, timeout=60, env=env,
            )

            result = subprocess.run(
                [sys.executable, str(REPO_PATH / "run_syncnet.py"),
                 "--videofile", str(window_path),
                 "--reference", "window",
                 "--data_dir", str(data_dir)],
                capture_output=True, text=True, timeout=60, env=env,
            )

            for line in result.stdout.strip().split("\n"):
                if "AV offset" in line and "confidence" in line:
                    parts = line.split(",")
                    offset = int(parts[0].split()[-1])
                    confidence = float(parts[1].split()[-1])
                    return {"offset": offset, "confidence": confidence}

        except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
            return None

    return None


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path

    if not REPO_PATH.exists():
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(
                model="syncnet", score=0.0,
                note=f"SyncNet repo not found at {REPO_PATH}",
            )],
            runtime_s=time.time() - t0,
        )

    try:
        duration = get_video_duration(target)
    except Exception:
        return ModuleResult(module="video", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    findings: list[Finding] = []
    pos = 0.0

    while pos + WINDOW_SEC <= duration:
        result = run_syncnet_on_window(target, pos, WINDOW_SEC)

        if result is not None:
            offset = result["offset"]
            confidence = result["confidence"]

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
