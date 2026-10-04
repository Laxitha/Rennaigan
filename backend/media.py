"""Media probing, gateway-made artifacts, and frame dissection. Needs ffmpeg/ffprobe on PATH."""

from __future__ import annotations

import io
import json
import mimetypes
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

try:
    import cv2
except ImportError:  # dissection still works, without face boxes
    cv2 = None

ALLOWED_EXT = {
    "mp4", "mov", "webm", "mkv", "ts", "avi", "m4v",
    "mp3", "wav", "m4a", "flac", "ogg", "aac",
    "jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "heic",
}
IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "heic"}
STILL_CODECS = {"mjpeg", "png", "webp", "bmp", "tiff", "gif", "heic", "hevc_still"}


class UnsupportedMedia(Exception):
    pass


def safe_name(name: str) -> str:
    """Base name with anything outside a conservative character set replaced."""
    name = Path(name.replace("\\", "/")).name
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .")
    return name[:120] or "upload"


def content_type(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def _rate(text: str | None) -> float | None:
    try:
        num, _, den = (text or "").partition("/")
        value = float(num) / float(den or 1)
        return round(value, 3) if value > 0 else None
    except (ValueError, ZeroDivisionError):
        return None


def _run(cmd: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def probe(path: Path, original_name: str) -> dict:
    """Classify the file and read its basic properties. Raises UnsupportedMedia."""
    ext = Path(original_name).suffix.lower().lstrip(".")
    info = {"media_type": "unknown", "duration_s": None, "width": None, "height": None, "fps": None, "has_audio": None}

    data = None
    if shutil.which("ffprobe"):
        try:
            out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], 30)
            data = json.loads(out.stdout) if out.returncode == 0 and out.stdout.strip() else None
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            data = None

    # ffprobe "decodes" arbitrary text through its terminal-art demuxer; that is not media.
    if data and data.get("format", {}).get("format_name") in ("tty", "ansi"):
        data = None

    if data and data.get("streams"):
        fmt = data.get("format", {})
        video = next((s for s in data["streams"] if s.get("codec_type") == "video"
                      and not s.get("disposition", {}).get("attached_pic")), None)
        audio = next((s for s in data["streams"] if s.get("codec_type") == "audio"), None)
        duration = float(fmt.get("duration") or (video or audio or {}).get("duration") or 0) or None
        info["has_audio"] = audio is not None
        if video:
            info["width"], info["height"] = video.get("width"), video.get("height")
            fmt_name = fmt.get("format_name", "")
            still = (ext in IMAGE_EXT or "image2" in fmt_name or fmt_name.endswith("_pipe")
                     or (video.get("codec_name") in STILL_CODECS and not audio and (duration or 0) < 0.2))
            if still:
                info["media_type"] = "image"
                info["has_audio"] = False
            else:
                info["media_type"] = "video"
                info["duration_s"] = round(duration, 3) if duration else None
                info["fps"] = _rate(video.get("avg_frame_rate")) or _rate(video.get("r_frame_rate"))
        elif audio:
            info["media_type"] = "audio"
            info["duration_s"] = round(duration, 3) if duration else None
    elif ext in IMAGE_EXT:
        try:
            with Image.open(path) as img:
                info.update(media_type="image", width=img.width, height=img.height, has_audio=False)
        except Exception:
            pass

    # ffprobe picks the image demuxer from the extension alone, so confirm the pixels decode.
    if info["media_type"] == "image" and ext != "heic":
        try:
            with Image.open(path) as img:
                img.verify()
        except Exception:
            info["media_type"] = "unknown"
    if info["media_type"] in ("image", "video") and not (info["width"] and info["height"]):
        info["media_type"] = "unknown"

    if info["media_type"] == "unknown":
        raise UnsupportedMedia("The file could not be decoded as an image, video or audio file.")
    if info["media_type"] == "image" and re.search(r"screen ?shot|capture|screen", original_name, re.I):
        info["media_type"] = "screenshot"
    return info


# ---------------------------------------------------------------- artifacts

def ela_heatmap(src: Path, dest: Path, quality: int = 90, max_side: int = 1600) -> bool:
    """Error Level Analysis rendered as heat on black, for screen-blending over the image.

    A supporting view of recompression error, not a detector score.
    """
    try:
        with Image.open(src) as img:
            img = img.convert("RGB")
            img.thumbnail((max_side, max_side))
            tmp = dest.with_suffix(".resave.jpg")
            img.save(tmp, "JPEG", quality=quality)
            with Image.open(tmp) as resaved:
                diff = np.abs(np.asarray(img, dtype=np.int16) - np.asarray(resaved.convert("RGB"), dtype=np.int16))
            tmp.unlink(missing_ok=True)
    except Exception:
        return False
    # Average the per-pixel error over a neighbourhood so regions stand out instead of JPEG block speckle.
    level = Image.fromarray(np.clip(diff.max(axis=2) * 8, 0, 255).astype(np.uint8))
    level = np.asarray(level.filter(ImageFilter.GaussianBlur(max(3.0, max(level.size) / 160))), dtype=np.float32)
    floor, peak = float(np.percentile(level, 60)), float(np.percentile(level, 99.8))
    m = np.clip((level - floor) / max(peak - floor, 1e-6), 0.0, 1.0) ** 1.5  # typical error stays transparent
    heat = np.stack([np.clip(m * 3, 0, 1), np.clip(m * 3 - 1, 0, 1), np.clip(m * 3 - 2, 0, 1)], axis=2)
    Image.fromarray((heat * 255).astype(np.uint8)).save(dest)
    return True


def spectrogram(src: Path, dest: Path) -> bool:
    try:
        out = _run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-lavfi",
                    "showspectrumpic=s=1200x300:legend=0:color=magma:scale=log", "-frames:v", "1", str(dest)], 120)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False
    return out.returncode == 0 and dest.exists()


# --------------------------------------------------------------- dissection

def _timecode(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


_cascade = None


def _faces(gray) -> list[list[int]]:
    global _cascade
    if cv2 is None:
        return []
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    min_side = max(40, min(gray.shape[:2]) // 12)
    found = _cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=6, minSize=(min_side, min_side))
    return [[int(x), int(y), int(w), int(h)] for x, y, w, h in found]


def _frame_stats(path: Path) -> tuple[int, int, float, list[list[int]]]:
    if cv2 is not None:
        gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if gray is not None:
            return gray.shape[1], gray.shape[0], float(cv2.Laplacian(gray, cv2.CV_64F).var()), _faces(gray)
    with Image.open(path) as img:
        g = np.asarray(img.convert("L"), dtype=np.float32)
    lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4 * g[1:-1, 1:-1]
    return g.shape[1], g.shape[0], float(lap.var()), []


def dissect(video: Path, out_root: Path, url_prefix: str, media: dict, *, fps: float = 2.0, max_frames: int = 120,
            start_s: float = 0.0, end_s: float | None = None, quality: int = 85) -> tuple[dict, bool]:
    """Extract frames at `fps` and describe each one. Returns (result, was_cached)."""
    duration = float(media.get("duration_s") or 0)
    source_fps = float(media.get("fps") or 25.0)
    fps = min(max(float(fps), 0.1), min(30.0, source_fps))
    max_frames = min(max(int(max_frames), 1), 600)
    start_s = min(max(float(start_s or 0), 0.0), max(duration - 0.01, 0.0))
    end_s = duration if not end_s or end_s <= start_s else min(float(end_s), duration or float(end_s))
    quality = min(max(int(quality), 10), 100)

    key = f"fps{fps:g}_s{start_s:g}_e{end_s:g}_n{max_frames}_q{quality}".replace(".", "p")
    out_dir = out_root / key
    manifest = out_dir / "manifest.json"
    if manifest.exists():
        return json.loads(manifest.read_text()), True

    out_dir.mkdir(parents=True, exist_ok=True)
    qscale = str(round(31 - (quality / 100) * 29))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start_s:.3f}"]
    if end_s:
        cmd += ["-to", f"{end_s:.3f}"]
    cmd += ["-i", str(video), "-vf", f"fps={fps:g}", "-frames:v", str(max_frames), "-q:v", qscale, str(out_dir / "%06d.jpg")]
    out = _run(cmd, 300)
    files = sorted(out_dir.glob("*.jpg"))
    if out.returncode != 0 and not files:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise RuntimeError(f"ffmpeg could not extract frames: {out.stderr.strip()[:300]}")

    frames = []
    for i, path in enumerate(files):
        ts = start_s + i / fps
        width, height, sharpness, boxes = _frame_stats(path)
        frames.append({
            "index": i, "frame_number": int(round(ts * source_fps)), "timestamp_s": round(ts, 3),
            "timecode": _timecode(ts), "filename": path.name, "url": f"{url_prefix}/{key}/{path.name}",
            "width": width, "height": height, "sharpness": round(sharpness, 2),
            "faces_count": len(boxes), "face_boxes": boxes,
        })

    width, height = media.get("width") or 0, media.get("height") or 0
    result = {
        "video_info": {
            "source_fps": source_fps, "total_frames": int(round(duration * source_fps)), "duration_s": duration,
            "width": width, "height": height, "resolution": f"{width}x{height}",
        },
        "dissection": {
            "requested_fps": fps, "actual_interval_frames": max(1, int(round(source_fps / fps))),
            "effective_fps": round(len(frames) / (end_s - start_s), 3) if end_s > start_s else fps,
            "extracted_count": len(frames), "start_s": start_s, "end_s": end_s, "max_frames": max_frames,
        },
        "frames": frames,
    }
    manifest.write_text(json.dumps(result))
    return result, False


def zip_frames(result: dict, frames_root: Path, dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as zf:
        for frame in result["frames"]:
            path = frames_root / Path(frame["url"]).parent.name / frame["filename"]
            if path.exists():
                zf.write(path, f"{frame['index']:06d}_{frame['timecode'].replace(':', '-')}.jpg")
        listing = [{k: f[k] for k in ("index", "frame_number", "timestamp_s", "timecode", "sharpness", "faces_count")} for f in result["frames"]]
        zf.writestr("manifest.json", json.dumps({**result, "frames": listing}, indent=2))
    return dest


def preview_images(path: Path, info: dict, frames: int = 4, max_side: int = 1280, times: list[float] | None = None) -> list[bytes | None]:
    """JPEG previews for a visual review: the image itself, or video frames.

    Video frames are taken at `times` (seconds) when given, else spread evenly. With `times`
    the result has one entry per time, None where that frame could not be read.
    """
    out: list[bytes | None] = []
    try:
        if info["media_type"] in ("image", "screenshot"):
            with Image.open(path) as img:
                img = img.convert("RGB")
                img.thumbnail((max_side, max_side))
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=90)
                out.append(buf.getvalue())
        elif info["media_type"] == "video" and info.get("duration_s"):
            for at in times if times is not None else [info["duration_s"] * (2 * k + 1) / (2 * frames) for k in range(frames)]:
                shot = subprocess.run(
                    ["ffmpeg", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", str(path), "-frames:v", "1",
                     "-vf", f"scale='min({max_side},iw)':-2", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "-"],
                    capture_output=True, timeout=60)
                if shot.returncode == 0 and shot.stdout:
                    out.append(shot.stdout)
                elif times is not None:
                    out.append(None)
    except Exception:
        return []
    return out
