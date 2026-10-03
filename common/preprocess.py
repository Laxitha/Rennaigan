"""Shared preprocessing — decode upload once into frames, 25fps video, and 16kHz audio."""

from __future__ import annotations

import subprocess
from pathlib import Path


def preprocess_media(input_path: Path, work_dir: Path) -> dict[str, Path]:
    """Run the shared FFmpeg preprocessing pipeline.

    Returns dict with keys: frames_dir, video25, audio16k, keyframes_dir
    """
    frames_dir = work_dir / "frames"
    keyframes_dir = work_dir / "keyframes"
    frames_dir.mkdir(parents=True, exist_ok=True)
    keyframes_dir.mkdir(parents=True, exist_ok=True)

    video25 = work_dir / "video25.mp4"
    audio16k = work_dir / "audio16k.wav"

    commands = [
        # 1. Sampled frames at 3 fps
        ["ffmpeg", "-i", str(input_path), "-vf", "fps=3", "-q:v", "2",
         str(frames_dir / "%05d.jpg"), "-y", "-loglevel", "error"],
        # 2. Constant 25 fps for lip-sync, LipForensics, motion
        ["ffmpeg", "-i", str(input_path), "-r", "25", "-c:v", "libx264",
         "-crf", "18", "-c:a", "aac", str(video25), "-y", "-loglevel", "error"],
        # 3. 16kHz mono audio
        ["ffmpeg", "-i", str(input_path), "-vn", "-ac", "1", "-ar", "16000",
         "-sample_fmt", "s16", str(audio16k), "-y", "-loglevel", "error"],
        # 4. Keyframes for reverse search
        ["ffmpeg", "-i", str(input_path), "-vf", "select='gt(scene,0.3)'",
         "-vsync", "vfr", str(keyframes_dir / "%04d.jpg"), "-y", "-loglevel", "error"],
    ]

    results = {}
    for cmd in commands:
        try:
            subprocess.run(cmd, check=True, timeout=120)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass

    results["frames_dir"] = frames_dir
    results["video25"] = video25
    results["audio16k"] = audio16k
    results["keyframes_dir"] = keyframes_dir

    return results


def get_video_duration(file_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(file_path)],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())
