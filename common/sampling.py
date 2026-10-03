"""Bounded-cost analysis of long videos.

Detectors that need every frame (lip motion, lip sync, facial motion) cannot run over a
10-minute upload in reasonable time. Instead they examine evenly spaced windows, so the cost is
fixed while every part of the video still has a chance of being looked at. A short video is one
window covering all of it.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

Window = tuple[float, float]  # (start in the source video, length), in seconds


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def has_audio(path: Path) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    return bool(out.stdout.strip())


def plan(duration: float, window_s: float = 8.0, max_windows: int = 5) -> list[Window]:
    """Windows to examine. Videos up to window_s * max_windows long are covered completely."""
    budget = window_s * max_windows
    if duration <= 0:
        return [(0.0, budget)]
    if duration <= budget:
        return [(0.0, duration)]
    segment = duration / max_windows
    return [(round(k * segment + (segment - window_s) / 2, 3), window_s) for k in range(max_windows)]


def coverage_note(duration: float, windows: list[Window]) -> str:
    examined = sum(length for _, length in windows)
    if len(windows) == 1:
        return ""
    return (f"Long video: frame-level motion and lip checks examined {examined:.0f} s of {duration:.0f} s "
            f"in {len(windows)} evenly spaced windows.")


def to_source_time(t: float, windows: list[Window]) -> float:
    """Map a time in the concatenated sample clip back to the source video."""
    elapsed = 0.0
    for start, length in windows:
        if t <= elapsed + length or (start, length) == windows[-1]:
            return round(start + min(max(t - elapsed, 0.0), length), 3)
        elapsed += length
    return round(t, 3)


def window_bounds(windows: list[Window], fps: float) -> list[tuple[int, int]]:
    """Frame ranges of each window inside the concatenated sample clip."""
    bounds, frame = [], 0
    for _, length in windows:
        n = int(round(length * fps))
        bounds.append((frame, frame + n))
        frame += n
    return bounds


def build_sample(src: Path, dest: Path, windows: list[Window], *, fps: int = 25, max_height: int = 720, audio: bool = True) -> Path:
    """Write the windows, joined end to end, as one constant-frame-rate clip."""
    audio = audio and has_audio(src)
    encode = ["-vf", f"scale=-2:'min({max_height},ih)'", "-r", str(fps), "-c:v", "libx264", "-preset", "ultrafast",
              "-crf", "20", "-pix_fmt", "yuv420p"]
    encode += ["-c:a", "aac", "-ar", "16000", "-ac", "1"] if audio else ["-an"]
    base = ["ffmpeg", "-y", "-loglevel", "error"]

    if len(windows) == 1:
        start, length = windows[0]
        subprocess.run(base + ["-ss", f"{start}", "-t", f"{length}", "-i", str(src)] + encode + [str(dest)],
                       check=True, capture_output=True, timeout=600)
        return dest

    with tempfile.TemporaryDirectory(prefix="rg_sample_") as tmp:
        parts = []
        for i, (start, length) in enumerate(windows):
            part = Path(tmp) / f"part{i:02d}.mp4"
            # -ss before -i seeks by keyframe, so a 10-minute file is not decoded from the start
            # an exact frame count per window keeps window_bounds() aligned with the joined clip
            subprocess.run(base + ["-ss", f"{start}", "-t", f"{length}", "-i", str(src)] + encode
                           + ["-frames:v", str(int(round(length * fps))), str(part)],
                           check=True, capture_output=True, timeout=600)
            parts.append(part)
        listing = Path(tmp) / "parts.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(base + ["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(dest)],
                       check=True, capture_output=True, timeout=600)
    return dest


def extract_frames(src: Path, out_dir: Path, duration: float, *, max_frames: int = 180, max_fps: float = 3.0,
                   max_height: int = 720) -> list[float]:
    """Write up to max_frames JPEGs spread over the whole video. Returns each frame's time.

    Long videos use keyframes only: the decoder skips everything else, and keyframes are the
    least compressed frames, which is what the artifact detectors want.
    """
    scale = f"scale=-2:'min({max_height},ih)'"
    base = ["ffmpeg", "-y", "-loglevel", "error"]

    if duration > 120:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time",
             "-of", "csv=p=0", str(src)], capture_output=True, text=True, timeout=300)
        times = [float(x) for x in probe.stdout.replace(",", "").split() if x.replace(".", "", 1).isdigit()]
        if len(times) >= 40:
            subprocess.run(base + ["-skip_frame", "nokey", "-i", str(src), "-vsync", "0", "-vf", scale, "-q:v", "2",
                                   str(out_dir / "k%05d.jpg")], capture_output=True, timeout=600)
            files = sorted(out_dir.glob("k*.jpg"))
            if len(files) == len(times):
                step = max(1, -(-len(files) // max_frames))
                kept = []
                for i, (f, t) in enumerate(zip(files, times)):
                    if i % step == 0:
                        f.rename(out_dir / f"{len(kept) + 1:05d}.jpg")
                        kept.append(t)
                    else:
                        f.unlink()
                return kept
            for f in files:
                f.unlink()

    fps = min(max_fps, max_frames / duration) if duration > 0 else max_fps
    subprocess.run(base + ["-i", str(src), "-vf", f"fps={fps:.5f},{scale}", "-frames:v", str(max_frames), "-q:v", "2",
                           str(out_dir / "%05d.jpg")], capture_output=True, timeout=900)
    return [round(i / fps, 3) for i in range(len(list(out_dir.glob("*.jpg"))))]
