"""Audio forensics module: synthetic-voice detection, and speaker verification in identity mode."""

from __future__ import annotations

import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256

from . import ecapa_detector, voice_detector


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    all_findings = []
    all_artifacts = {}
    all_weights = {}

    for detector in [voice_detector, ecapa_detector]:
        try:
            result = detector.analyze(file_path)
            all_findings.extend(result.findings)
            all_artifacts.update(result.artifacts)
            all_weights.update(result.weights_sha256)
        except NotImplementedError:
            pass
        except Exception as e:
            all_findings.append(Finding(
                model=detector.__name__.split(".")[-1].replace("_detector", ""),
                score=0.0,
                note=f"error: {e}",
            ))

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=all_findings,
        artifacts=all_artifacts,
        weights_sha256=all_weights,
        runtime_s=time.time() - t0,
    )


def warmup() -> None:
    try:
        voice_detector.load_model()
    except Exception:
        pass  # reported at analysis time


app = create_app("audio", analyze, warmup)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)
