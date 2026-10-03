"""Video forensics module: face-swap scoring, AI-generated frames, lip motion, and lip sync.

Frames and a constant-frame-rate sample clip are prepared once and shared. The four detectors
then run side by side. Cost is bounded for long uploads: frame detectors see up to 180 frames
spread over the whole video, and the frame-by-frame detectors see evenly spaced windows.
"""

from __future__ import annotations

import shutil
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import budget
from common.sampling import build_sample, coverage_note, extract_frames, plan, probe_duration, to_source_time, window_bounds
from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256

from . import aigen_frames, frame_scorer, lipforensics_detector, syncnet_detector


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
        with ThreadPoolExecutor(2) as pool:
            frames_job = pool.submit(extract_frames, file_path, frames_dir, duration, max_frames=plan_["max_frames"])
            sample_job = pool.submit(build_sample, file_path, sample, windows)
            timestamps = frames_job.result()
            try:
                sample_job.result()
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

        def run(name: str):
            started = time.time()
            try:
                return name, jobs[name](), time.time() - started
            except Exception as exc:
                return name, exc, time.time() - started

        with ThreadPoolExecutor(len(jobs)) as pool:
            outcomes = list(pool.map(run, jobs))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    findings, artifacts, weights, timings = [], {}, {}, {"prepare": round(prepared, 2)}
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
