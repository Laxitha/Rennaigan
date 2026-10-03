"""SyncNet — checks that the audio matches the lip movement of each tracked face.

Setup:
  1. git clone https://github.com/joonson/syncnet_python.git repos/syncnet
  2. cd repos/syncnet && sh download_model.sh
  3. pip install python_speech_features scenedetect

Runs the repo's own two scripts on the clip: run_pipeline.py (scene detection, face tracking,
needs a face visible for at least 4 s) and run_syncnet.py, which logs one "AV offset" and
"Confidence" per face track.

A track is flagged when its confidence is below 3 or its offset exceeds 3 frames (120 ms).
Low confidence also occurs when the tracked person is simply not the one speaking, so this
detector's score is kept below the strong-signal level and never caps the trust score alone.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256

REPO_PATH = Path("repos/syncnet")
MODEL_PATH = REPO_PATH / "data/syncnet_v2.model"
FACE_MODEL_PATH = REPO_PATH / "detectors/s3fd/weights/sfd_face.pth"
CONFIDENCE_THRESHOLD = 3.0
OFFSET_THRESHOLD_FRAMES = 3
MAX_SECONDS = 60
RESULT = re.compile(r"AV offset:\s*(-?\d+).*?Confidence:\s*(-?[\d.]+)", re.S)


def _has_audio(path: Path) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=30,
    )
    return bool(json.loads(out.stdout or "{}").get("streams"))


def _run(script: str, video: Path, data_dir: Path) -> str:
    """Run one of the repo's scripts from inside the repo, where it expects its model files."""
    proc = subprocess.run(
        [sys.executable, script, "--videofile", str(video), "--reference", "clip", "--data_dir", str(data_dir)],
        cwd=REPO_PATH, capture_output=True, text=True, timeout=900,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"SyncNet {script} failed: {(proc.stderr or proc.stdout).strip()[-400:]}")
    return proc.stdout + "\n" + proc.stderr


def score_track(offset: int, confidence: float) -> float:
    if confidence < CONFIDENCE_THRESHOLD:
        return round(0.3 + 0.4 * (1.0 - max(confidence, 0.0) / CONFIDENCE_THRESHOLD), 4)  # 0.3 .. 0.7
    if abs(offset) > OFFSET_THRESHOLD_FRAMES:
        return round(min(0.5 + 0.05 * (abs(offset) - OFFSET_THRESHOLD_FRAMES), 0.8), 4)
    return 0.0


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    for required in (MODEL_PATH, FACE_MODEL_PATH):
        if not required.exists():
            raise FileNotFoundError(f"SyncNet file not found: {required}. Run download_model.sh in {REPO_PATH}")

    source = video25_path or file_path
    if not _has_audio(source):
        return ModuleResult(module="video", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="syncnet", score=0.0, note="no_audio_stream: nothing to compare the lips against")])

    with tempfile.TemporaryDirectory(prefix="syncnet_") as tmp:
        clip = Path(tmp) / "clip.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-t", str(MAX_SECONDS), "-r", "25",
             "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "16000", "-ac", "1", str(clip)],
            check=True, capture_output=True, timeout=300,
        )
        data_dir = Path(tmp) / "work"
        _run("run_pipeline.py", clip.resolve(), data_dir.resolve())
        log = _run("run_syncnet.py", clip.resolve(), data_dir.resolve())

    findings: list[Finding] = []
    for i, (offset, confidence) in enumerate(RESULT.findall(log)):
        offset, confidence = int(offset), float(confidence)
        score = score_track(offset, confidence)
        findings.append(Finding(
            model="syncnet", score=score,
            note=f"{'av_out_of_sync' if score else 'av_in_sync'}: face track {i + 1}, offset={offset} frames, confidence={confidence:.2f}",
        ))
    if not findings:
        findings.append(Finding(model="syncnet", score=0.0, note="no_face_track: no face stayed in view for 4 seconds"))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"syncnet": weights_sha256(MODEL_PATH)},
        runtime_s=time.time() - t0,
    )
