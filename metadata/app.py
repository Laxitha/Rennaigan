"""Metadata forensics module — exiftool, ffprobe, c2patool analysis."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256


EDITING_SOFTWARE = (
    "photoshop", "gimp", "lightroom", "affinity", "pixelmator", "snapseed", "facetune", "picsart", "canva", "paint.net",
    "premiere", "after effects", "final cut", "davinci", "capcut", "imovie", "filmora", "audacity", "audition",
    "faceapp", "reface", "deepfacelab", "faceswap", "midjourney", "stable diffusion", "dall", "firefly",
)


def run_cmd(cmd: list[str]) -> dict | None:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return json.loads(result.stdout) if result.stdout.strip() else None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return None


def run_exiftool(file_path: Path) -> tuple[dict | None, list[Finding]]:
    data = run_cmd(["exiftool", "-j", str(file_path)])
    if not data:
        return None, []

    meta = data[0] if isinstance(data, list) else data
    findings: list[Finding] = []

    # Only real editors count. Encoder and muxer tags (Lavf, a camera's firmware name) are on
    # almost every file and say nothing about editing.
    software = str(meta.get("Software", "") or meta.get("CreatorTool", ""))
    if any(name in software.lower() for name in EDITING_SOFTWARE):
        findings.append(Finding(
            model="exiftool",
            score=0.3,
            note=f"editing_software_detected: {software}",
        ))

    create_date = meta.get("CreateDate", "")
    modify_date = meta.get("ModifyDate", "")
    if create_date and modify_date and create_date > modify_date:
        findings.append(Finding(
            model="exiftool",
            score=0.6,
            note=f"creation_after_modification: created={create_date} modified={modify_date}",
        ))

    gps = meta.get("GPSLatitude") or meta.get("GPSPosition")
    if not gps and not meta.get("FileName", "").lower().endswith((".mp4", ".mov", ".avi")):
        pass  # not suspicious for images

    stripped_keys = {"EXIF", "XMP", "IPTC", "ICC_Profile"}
    present = {k for k in meta if any(k.startswith(s) for s in stripped_keys)}
    if not present and meta.get("FileType") in ("JPEG", "PNG", "TIFF"):
        findings.append(Finding(
            model="exiftool",
            score=0.4,
            note="metadata_stripped: no EXIF/XMP/IPTC found",
        ))

    return meta, findings


def run_ffprobe(file_path: Path) -> tuple[dict | None, list[Finding]]:
    data = run_cmd([
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(file_path),
    ])
    if not data:
        return None, []

    findings: list[Finding] = []
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    for vs in video_streams:
        stream_duration = float(vs.get("duration", 0) or 0)
        container_duration = float(fmt.get("duration", 0) or 0)
        if stream_duration and container_duration:
            if abs(stream_duration - container_duration) > 1.0:
                findings.append(Finding(
                    model="ffprobe",
                    score=0.5,
                    note=f"duration_mismatch: stream={stream_duration:.1f}s container={container_duration:.1f}s",
                ))

    encoder = fmt.get("tags", {}).get("encoder", "")
    if encoder:
        findings.append(Finding(
            model="ffprobe",
            score=0.2,
            note=f"encoder_detected: {encoder}",
        ))

    nb_streams = int(fmt.get("nb_streams", 0))
    is_still = "image2" in fmt.get("format_name", "") or fmt.get("format_name", "").endswith("_pipe")
    if nb_streams > 0 and not audio_streams and video_streams and not is_still:
        findings.append(Finding(
            model="ffprobe",
            score=0.3,
            note="video_has_no_audio_stream",
        ))

    return data, findings


def run_c2patool(file_path: Path) -> tuple[dict | None, list[Finding]]:
    data = run_cmd(["c2patool", str(file_path)])
    findings: list[Finding] = []

    if data is None:
        findings.append(Finding(
            model="c2patool",
            score=0.0,
            note="no_c2pa_manifest",
        ))
        return None, findings

    findings.append(Finding(
        model="c2patool",
        score=0.0,
        note="c2pa_manifest_present",
    ))
    return data, findings


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    all_findings: list[Finding] = []
    raw_metadata = {}

    exif_data, exif_findings = run_exiftool(file_path)
    all_findings.extend(exif_findings)
    if exif_data:
        raw_metadata["exiftool"] = exif_data

    ffprobe_data, ffprobe_findings = run_ffprobe(file_path)
    all_findings.extend(ffprobe_findings)
    if ffprobe_data:
        raw_metadata["ffprobe"] = ffprobe_data

    c2pa_data, c2pa_findings = run_c2patool(file_path)
    all_findings.extend(c2pa_findings)
    if c2pa_data:
        raw_metadata["c2pa"] = c2pa_data

    meta_dump_path = str(file_path.with_suffix(".metadata.json"))
    with open(meta_dump_path, "w") as f:
        json.dump(raw_metadata, f, indent=2, default=str)

    return ModuleResult(
        module="metadata",
        file_sha256=sha,
        findings=all_findings,
        artifacts={"raw_metadata": meta_dump_path},
        runtime_s=time.time() - t0,
    )


app = create_app("metadata", analyze)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
