"""TruFor — image editing/splicing detector with localization.

Setup:
  1. git clone https://github.com/grip-unina/TruFor.git repos/trufor
  2. Download weights per their README → weights/trufor/
  3. License: non-commercial (fine for hackathon)
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_DIR = Path("weights/trufor")
MODEL = None


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: Replace with actual TruFor loading
    # Add repos/trufor to sys.path, then:
    #   from test_docker import TruFor
    #   MODEL = TruFor(WEIGHTS_DIR)
    raise NotImplementedError(
        "Clone TruFor repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    img = cv2.imread(str(file_path))
    if img is None:
        return ModuleResult(
            module="image",
            file_sha256=sha,
            findings=[],
            runtime_s=time.time() - t0,
        )

    model = load_model()

    # TODO: run inference
    # integrity_score, localization_map = model.predict(img)
    integrity_score = 0.0  # placeholder
    localization_map = np.zeros(img.shape[:2], dtype=np.float32)

    heatmap_path = str(file_path.with_suffix(".trufor_heatmap.png"))
    heatmap_vis = cv2.applyColorMap(
        (localization_map * 255).astype(np.uint8), cv2.COLORMAP_JET
    )
    cv2.imwrite(heatmap_path, heatmap_vis)

    findings = [Finding(
        model="trufor",
        score=integrity_score,
        note="splicing_editing_detection",
    )]

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        artifacts={"heatmap": heatmap_path},
        weights_sha256={"trufor": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
