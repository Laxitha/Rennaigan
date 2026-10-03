"""TruFor — image editing/splicing detector with localization.

Setup:
  1. git clone https://github.com/grip-unina/TruFor.git repos/trufor
  2. cd repos/trufor && pip install -r requirements.txt
  3. Download weights per their README → weights/trufor/
     - trufor.pth.tar (main model)
     - noiseprint.pth (Noiseprint++ extractor)
  4. License: non-commercial

Architecture:
  - SegFormer backbone + Noiseprint++ noise residual
  - Outputs integrity score (0-1) and per-pixel localization map
  - Score near 1.0 = likely manipulated
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_DIR = Path("weights/trufor")
REPO_PATH = Path("repos/trufor")
MODEL = None
DEVICE = None


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    trufor_weights = WEIGHTS_DIR / "trufor.pth.tar"
    if not trufor_weights.exists():
        raise FileNotFoundError(
            f"TruFor weights not found at {trufor_weights}.\n"
            "Download trufor.pth.tar from the TruFor repo releases."
        )
    if not REPO_PATH.exists():
        raise FileNotFoundError(
            f"TruFor repo not found at {REPO_PATH}.\n"
            "git clone https://github.com/grip-unina/TruFor.git repos/trufor"
        )

    sys.path.insert(0, str(REPO_PATH / "test_docker"))
    sys.path.insert(0, str(REPO_PATH))

    from trufor import TruFor as TruForModel

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    MODEL = TruForModel(WEIGHTS_DIR, device=DEVICE)
    return MODEL


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

    try:
        model = load_model()
    except FileNotFoundError as e:
        return ModuleResult(
            module="image",
            file_sha256=sha,
            findings=[Finding(model="trufor", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    result = model.run(img_rgb)

    integrity_score = float(result.get("score", 0.0))
    localization_map = result.get("map", np.zeros(img.shape[:2], dtype=np.float32))

    if isinstance(localization_map, torch.Tensor):
        localization_map = localization_map.cpu().numpy()
    localization_map = localization_map.squeeze()

    if localization_map.shape != img.shape[:2]:
        localization_map = cv2.resize(localization_map, (img.shape[1], img.shape[0]))

    heatmap_path = str(file_path.with_suffix(".trufor_heatmap.png"))
    norm_map = ((localization_map - localization_map.min()) /
                (localization_map.max() - localization_map.min() + 1e-8) * 255)
    heatmap_vis = cv2.applyColorMap(norm_map.astype(np.uint8), cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(img, 0.6, heatmap_vis, 0.4, 0)
    cv2.imwrite(heatmap_path, overlay)

    findings = [Finding(
        model="trufor",
        score=integrity_score,
        note="splicing_editing_detection",
    )]

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        artifacts={"trufor_heatmap": heatmap_path},
        weights_sha256={"trufor": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
