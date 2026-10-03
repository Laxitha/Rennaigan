"""SBI (SelfBlendedImages) face-swap detector.

Setup:
  1. git clone https://github.com/mapooon/selfblendedimages.git repos/sbi
  2. Download weights: FFc23.tar (compressed video, best for social media) → weights/sbi/FFc23.tar
     Or FFraw.tar for raw video
  3. pip install efficientnet_pytorch

Input: face crop 380x380, ImageNet normalization.
Output: P(fake) per face.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from common.schema import Finding, ModuleResult
from common.utils import file_sha256
from common.face import detect_faces, crop_face

WEIGHTS_PATH = Path("weights/sbi/FFc23.tar")
MODEL = None
DEVICE = None
THRESHOLD = 0.5
INPUT_SIZE = 380

TRANSFORM = transforms.Compose([
    transforms.Resize((INPUT_SIZE, INPUT_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"SBI weights not found at {WEIGHTS_PATH}.\n"
            "Download FFc23.tar and place in weights/sbi/"
        )

    from efficientnet_pytorch import EfficientNet

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    MODEL = EfficientNet.from_name("efficientnet-b4", num_classes=1)
    ckpt = torch.load(str(WEIGHTS_PATH), map_location=DEVICE)

    if "model" in ckpt:
        MODEL.load_state_dict(ckpt["model"])
    elif "state_dict" in ckpt:
        MODEL.load_state_dict(ckpt["state_dict"])
    else:
        state = {k.replace("module.", ""): v for k, v in ckpt.items()}
        MODEL.load_state_dict(state)

    MODEL.eval()
    MODEL = MODEL.to(DEVICE)
    return MODEL


def analyze_image(image: np.ndarray, file_path: Path | None = None) -> list[Finding]:
    """Score all faces in a single image. Used by both image and video modules."""
    faces = detect_faces(image)
    if not faces:
        return []

    model = load_model()
    findings: list[Finding] = []

    crops = []
    boxes = []
    for face in faces:
        crop = crop_face(image, face["box"])
        crop_pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        crops.append(TRANSFORM(crop_pil))
        boxes.append(face["box"])

    batch = torch.stack(crops).to(DEVICE)
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16, enabled=DEVICE.type == "cuda"):
        logits = model(batch)
        scores = torch.sigmoid(logits).squeeze(-1).cpu().tolist()

    if isinstance(scores, float):
        scores = [scores]

    for score, box in zip(scores, boxes):
        findings.append(Finding(
            model="sbi",
            score=score,
            region=box,
            note="face_swap_detection",
        ))

    return findings


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    img = cv2.imread(str(file_path))
    if img is None:
        return ModuleResult(module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    findings = analyze_image(img, file_path)

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"sbi": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
