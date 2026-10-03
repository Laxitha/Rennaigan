"""Image forensics module — runs SBI, UnivFD, and TruFor."""

from __future__ import annotations

import time
from pathlib import Path

from common.schema import ModuleResult
from common.service import create_app
from common.utils import file_sha256

from . import sbi_detector, univfd_detector, trufor_detector


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    all_findings = []
    all_artifacts = {}
    all_weights = {}

    detectors = [
        sbi_detector,
        univfd_detector,
        trufor_detector,
    ]

    for detector in detectors:
        try:
            result = detector.analyze(file_path)
            all_findings.extend(result.findings)
            all_artifacts.update(result.artifacts)
            all_weights.update(result.weights_sha256)
        except NotImplementedError:
            pass
        except Exception as e:
            all_findings.append(
                __import__("common.schema", fromlist=["Finding"]).Finding(
                    model=detector.__name__.split(".")[-1].replace("_detector", ""),
                    score=0.0,
                    note=f"error: {e}",
                )
            )

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=all_findings,
        artifacts=all_artifacts,
        weights_sha256=all_weights,
        runtime_s=time.time() - t0,
    )


app = create_app("image", analyze)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
