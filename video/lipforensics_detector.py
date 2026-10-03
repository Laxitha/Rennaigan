"""LipForensics — lip-based deepfake detector.

Setup:
  1. git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
  2. Download weights: lipforensics_ff.pth from the README link → weights/lipforensics_ff.pth
  3. pip install dlib (needs cmake) or face_alignment
  4. Needs older PyTorch — use tf-video conda env

Input: work/video25.mp4 (25 fps)
Preprocessing: face landmarks → aligned grayscale mouth crops, 88x88
Clip length: 25 frames (1s), stride 25
Skip clips where face turns > ~45 degrees.

If alignment preprocessing is still failing by hour 10, drop this and rely on SyncNet.
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/lipforensics_ff.pth")
MODEL = None
CLIP_LENGTH = 25
STRIDE = 25
MOUTH_SIZE = 88
THRESHOLD = 0.5

# Mouth landmark indices for 68-point model
MOUTH_LANDMARKS = list(range(48, 68))


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: uncomment after cloning LipForensics repo
    # import sys
    # sys.path.insert(0, "repos/lipforensics")
    # from models import LipForensicsNet
    # MODEL = LipForensicsNet()
    # MODEL.load_state_dict(torch.load(WEIGHTS_PATH, map_location="cpu"))
    # MODEL.eval()
    # if torch.cuda.is_available():
    #     MODEL = MODEL.cuda()
    raise NotImplementedError("Clone LipForensics repo and download lipforensics_ff.pth.")


def extract_mouth_crops(video_path: Path) -> list[np.ndarray]:
    """Extract aligned grayscale mouth crops from 25fps video.

    Returns list of arrays, each (25, 88, 88) — one per 1-second clip.
    """
    # TODO: implement mouth crop extraction
    # 1. Open video25.mp4 at 25 fps
    # 2. Detect 68-point face landmarks per frame (dlib or face_alignment)
    # 3. Crop mouth region (landmarks 48-67)
    # 4. Align to horizontal using eye corners
    # 5. Resize to 88x88 grayscale
    # 6. Group into 25-frame clips with stride 25
    return []


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path
    model = load_model()
    device = next(model.parameters()).device
    clips = extract_mouth_crops(target)

    if not clips:
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note="no_mouth_crops_extracted")],
            runtime_s=time.time() - t0,
        )

    findings: list[Finding] = []
    for i, clip in enumerate(clips):
        tensor = torch.from_numpy(clip).unsqueeze(0).unsqueeze(0).float().to(device)
        with torch.no_grad():
            score = torch.sigmoid(model(tensor)).item()

        start_sec = i * (STRIDE / 25.0)
        end_sec = start_sec + (CLIP_LENGTH / 25.0)

        if score >= THRESHOLD:
            findings.append(Finding(
                model="lipforensics",
                score=score,
                start=start_sec,
                end=end_sec,
                note="lip_deepfake_detection",
            ))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"lipforensics": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
