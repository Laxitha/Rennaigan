"""LipForensics — lip-based deepfake detector.

Setup:
  1. git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
  2. Download weights per their README → weights/lipforensics.pth
  3. pip install dlib  (needs cmake; or use face_alignment package instead)
  4. Needs older PyTorch — use dedicated conda env / Docker

Preprocessing is the hard part: aligned grayscale mouth crops from
68-point face landmarks. Budget extra time here.
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/lipforensics.pth")
MODEL = None


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: Replace with actual LipForensics loading
    # import sys
    # sys.path.insert(0, "repos/lipforensics")
    # from models import LipForensicsNet
    # MODEL = LipForensicsNet()
    # MODEL.load_state_dict(torch.load(WEIGHTS_PATH, map_location="cpu"))
    # MODEL.eval()
    raise NotImplementedError(
        "Clone LipForensics repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def extract_mouth_crops(video_path: Path) -> np.ndarray | None:
    """Extract aligned grayscale mouth crops from video.

    Returns array of shape (T, 96, 96) or None if face not found.
    This is the preprocessing step that takes the most work.
    """
    # TODO: implement mouth crop extraction
    # 1. Extract frames
    # 2. Detect 68 face landmarks per frame (dlib or face_alignment)
    # 3. Crop mouth region (landmarks 48-67)
    # 4. Align and resize to 96x96 grayscale
    # 5. Stack into (T, 96, 96) array
    return None


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    model = load_model()
    mouth_crops = extract_mouth_crops(file_path)

    if mouth_crops is None:
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(
                model="lipforensics",
                score=0.0,
                note="no_face_detected",
            )],
            runtime_s=time.time() - t0,
        )

    # TODO: run inference on mouth_crops
    # tensor = torch.from_numpy(mouth_crops).unsqueeze(0).unsqueeze(0).float()
    # with torch.no_grad():
    #     score = torch.sigmoid(model(tensor)).item()
    score = 0.0  # placeholder

    findings = [Finding(
        model="lipforensics",
        score=score,
        note="lip_based_deepfake_detection",
    )]

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"lipforensics": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
