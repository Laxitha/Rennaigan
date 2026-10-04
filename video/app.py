"""Video forensics module: face-swap scoring, AI-generated frames, lip motion, and lip sync.

Frames and a constant-frame-rate sample clip are prepared once and shared. The four detectors
then run side by side. Cost is bounded for long uploads: frame detectors see up to 180 frames
spread over the whole video, and the frame-by-frame detectors see evenly spaced windows.
"""

from __future__ import annotations

import shutil
import tempfile

import cv2
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import budget
from common.face import any_face
from common.sampling import build_sample, coverage_note, extract_frames, plan, probe_duration, to_source_time, window_bounds
from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256

from . import aigen_frames, frame_scorer, lipforensics_detector, syncnet_detector


LIP_SYNC_TRIGGER = 0.6  # the level at which fusion treats another detector as agreeing


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)
    duration = probe_duration(file_path)
    plan_ = budget.get()
    windows = plan(duration, plan_["window_s"], plan_["max_windows"])

    work = Path(tempfile.mkdtemp(prefix="rg_video_"))
    try:
        frames_dir = work / "frames"
        frames_dir.mkdir()
        sample = work / "sample25.mp4"
        timestamps = extract_frames(file_path, frames_dir, duration, max_frames=plan_["max_frames"])
        # A spread of frames with no face: the face-based detectors have nothing to examine,
        # and the constant-frame-rate sample clip they would need is not built.
        files = sorted(frames_dir.glob("*.jpg"))
        probe = [cv2.imread(str(f)) for f in files[::max(1, len(files) // 12)]]
        has_face = any_face([f for f in probe if f is not None])
        if has_face:
            try:
                build_sample(file_path, sample, windows)
            except Exception:
                sample = None  # the detectors fall back to preparing their own input
        prepared = time.time() - t0
        breaks = frozenset(start for start, _ in window_bounds(windows, 25)[1:])

        jobs = {
            "sbi_video": lambda: frame_scorer.analyze(file_path, frames_dir, timestamps),
            "aigen_video": lambda: aigen_frames.analyze(file_path, frames_dir, timestamps, plan_["aigen_frames"]),
            "lipforensics": lambda: lipforensics_detector.analyze(file_path, sample, breaks),
            "syncnet": lambda: syncnet_detector.analyze(file_path, sample),
        }
        if not plan_["lip_sync"]:
            del jobs["syncnet"]
        if not plan_["lip_motion"]:
            del jobs["lipforensics"]

        skipped = []
        if not has_face:
            for name, note in (("sbi_video", "no_face_detected"), ("lipforensics", "no_mouth_track"), ("syncnet", "no_face_track")):
                if jobs.pop(name, None):
                    skipped.append(Finding(model=name, score=0.0, note=f"{note}: no face in the sampled frames"))

        def run(name: str):
            started = time.time()
            try:
                return name, jobs[name](), time.time() - started
            except Exception as exc:
                return name, exc, time.time() - started

        # Lip sync is the most expensive check, and on its own it cannot decide a verdict
        # (voice-over and off-screen speakers are out of sync in genuine videos): fusion only
        # counts it when another detector has flagged the file. So it runs only in that case,
        # after the others, instead of competing with them for the CPU on every upload.
        first = [name for name in jobs if name != "syncnet"]
        with ThreadPoolExecutor(max(len(first), 1)) as pool:
            outcomes = list(pool.map(run, first))
        if "syncnet" in jobs:
            flagged = any(
                f.score >= LIP_SYNC_TRIGGER and (f.note.startswith(("clip_level", "video_level")) or "interval" in f.note.split(":")[0])
                for _, result, _ in outcomes if not isinstance(result, Exception) for f in result.findings)
            if flagged:
                outcomes.append(run("syncnet"))
            else:
                skipped.append(Finding(model="syncnet", score=0.0,
                                       note="no_lip_sync_needed: not run, because no other detector flagged this video and lip sync alone cannot decide"))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    findings, artifacts, weights, timings = list(skipped), {}, {}, {"prepare": round(prepared, 2)}
    for name, result, seconds in outcomes:
        timings[name] = round(seconds, 2)
        if isinstance(result, Exception):
            findings.append(Finding(model=name, score=0.0, note=f"error: {result}"))
            continue
        for f in result.findings:
            # lip-motion clips are timed inside the sample clip; report them in source time
            if name == "lipforensics" and sample is not None and f.start is not None:
                f.start, f.end = to_source_time(f.start, windows), to_source_time(f.end, windows)
            findings.append(f)
        artifacts.update(result.artifacts)
        weights.update(result.weights_sha256)

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        artifacts=artifacts,
        weights_sha256=weights,
        runtime_s=time.time() - t0,
        timings=timings,
        note=" ".join(n for n in (coverage_note(duration, windows), budget.REDUCED_NOTE if plan_["reduced"] else "") if n),
    )


def warmup() -> None:
    from image import aigen_detector, sbi_detector
    for load in (sbi_detector.load_model, aigen_detector.load_model, lipforensics_detector.load_model):
        try:
            load()
        except Exception:
            pass  # reported per detector at analysis time


app = create_app("video", analyze, warmup)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
