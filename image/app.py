"""Image forensics module: SBI (face swap), UnivFD (AI-generated) and TruFor (splicing), side by side."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256

from . import sbi_detector, trufor_detector, univfd_detector

DETECTORS = {"sbi": sbi_detector, "univfd": univfd_detector, "trufor": trufor_detector}


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    def run(name: str):
        started = time.time()
        try:
            return name, DETECTORS[name].analyze(file_path), time.time() - started
        except Exception as exc:
            return name, exc, time.time() - started

    with ThreadPoolExecutor(len(DETECTORS)) as pool:
        outcomes = list(pool.map(run, DETECTORS))

    findings, artifacts, weights, timings = [], {}, {}, {}
    for name, result, seconds in outcomes:
        timings[name] = round(seconds, 2)
        if isinstance(result, Exception):
            findings.append(Finding(model=name, score=0.0, note=f"error: {result}"))
            continue
        findings.extend(result.findings)
        artifacts.update(result.artifacts)
        weights.update(result.weights_sha256)

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        artifacts=artifacts,
        weights_sha256=weights,
        runtime_s=time.time() - t0,
        timings=timings,
    )


def warmup() -> None:
    from common.face import get_face_app
    for load in (get_face_app, sbi_detector.load_model, univfd_detector.load_model, trufor_detector.load_model):
        try:
            load()
        except Exception:
            pass  # reported per detector at analysis time


app = create_app("image", analyze, warmup)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
