"""SBI (SelfBlendedImages) face-swap detector wrapper.

Setup:
  1. git clone https://github.com/mapooon/selfblendedimages.git repos/sbi
  2. Download weights: EfficientNet-B4 checkpoint → weights/sbi.tar
  3. pip install retinaface-pytorch torchvision
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/sbi.tar")
MODEL = None


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: Replace with actual SBI model loading
    # from selfblendedimages repo:
    #   from src.model import Detector
    #   MODEL = Detector()
    #   MODEL.load_state_dict(torch.load(WEIGHTS_PATH, map_location="cpu"))
    #   MODEL.eval()
    raise NotImplementedError(
        "Clone SBI repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def detect_faces(image: np.ndarray) -> list[dict]:
    """Detect faces using RetinaFace; returns list of {box, score}."""
    try:
        from retinaface import RetinaFace
        detections = RetinaFace.detect_faces(image)
        faces = []
        for key, val in detections.items():
            x1, y1, x2, y2 = val["facial_area"]
            faces.append({
                "box": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
                "confidence": float(val["score"]),
            })
        return faces
    except Exception:
        return []


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

    faces = detect_faces(img)
    findings: list[Finding] = []

    model = load_model()

    for face in faces:
        x, y, w, h = face["box"]
        crop = img[y : y + h, x : x + w]
        crop_pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        crop_resized = crop_pil.resize((224, 224))

        # TODO: preprocess and run model inference
        # tensor = transform(crop_resized).unsqueeze(0)
        # with torch.no_grad():
        #     score = torch.sigmoid(model(tensor)).item()
        score = 0.0  # placeholder

        findings.append(Finding(
            model="sbi",
            score=score,
            region=[x, y, w, h],
            note="face_swap_detection",
        ))

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"sbi": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
