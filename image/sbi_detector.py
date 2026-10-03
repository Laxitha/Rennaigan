"""SBI (Self-Blended Images) face-swap detector.

Setup:
  1. Download FFc23.tar (link in the SBI README) to weights/sbi/FFc23.tar
  2. pip install efficientnet_pytorch insightface onnxruntime

Matches the official inference code (repos/sbi/src/inference/inference_image.py):
  - EfficientNet-B4 with 2 outputs, checkpoint key "model", parameters prefixed "net."
  - face crop with a quarter-width margin in total, resized to 380x380, RGB scaled to 0..1
    with no mean/std normalization
  - P(fake) = softmax(logits)[1]
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256
from common.face import detect_faces, crop_face
from common.heat import save_heat

WEIGHTS_PATH = Path("weights/sbi/FFc23.tar")
MODEL = None
DEVICE = None
THRESHOLD = 0.5
INPUT_SIZE = 380
CROP_MARGIN = 1.25


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
    model = EfficientNet.from_name("efficientnet-b4", num_classes=2)
    ckpt = torch.load(str(WEIGHTS_PATH), map_location="cpu", weights_only=False)
    state = ckpt["model"] if "model" in ckpt else ckpt
    model.load_state_dict({k[len("net."):]: v for k, v in state.items() if k.startswith("net.")})

    MODEL = model.eval().to(DEVICE)
    return MODEL


def _prepare(image: np.ndarray, box: list[int]) -> torch.Tensor:
    crop = crop_face(image, box, margin=CROP_MARGIN)
    crop = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), (INPUT_SIZE, INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    return torch.from_numpy(crop).permute(2, 0, 1).float() / 255.0


def analyze_image(image: np.ndarray, file_path: Path | None = None) -> list[Finding]:
    """Score all faces in a single image. Used by both image and video modules."""
    faces = detect_faces(image)
    if not faces:
        return []

    model = load_model()
    batch = torch.stack([_prepare(image, f["box"]) for f in faces]).to(DEVICE)
    with torch.no_grad():
        scores = model(batch).softmax(1)[:, 1].cpu().tolist()

    return [
        Finding(model="sbi", score=float(score), region=face["box"], note="face_swap_detection")
        for score, face in zip(scores, faces)
    ]


def gradcam_heatmap(image: np.ndarray, box: list[int], score: float, output_path: str) -> str:
    """Grad-CAM for the "fake" output on one face, placed back on a full-frame black canvas.

    Intensity is scaled by the face's score, so a face the model considers real stays dark.
    """
    model = load_model()
    x = _prepare(image, box).unsqueeze(0).to(DEVICE)
    with torch.enable_grad():
        feat = model.extract_features(x)
        feat.retain_grad()
        logits = model._fc(model._avg_pooling(feat).flatten(1))
        model.zero_grad()
        (logits[0, 1] - logits[0, 0]).backward()
        weights = feat.grad.mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((weights * feat).sum(dim=1))[0].detach().cpu().numpy()
    model.zero_grad()
    cam = cam / (cam.max() + 1e-8) * float(score)

    # same region crop_face() used, so the map lines up with the pixels the model saw
    x0, y0, w, h = box
    cx, cy = x0 + w / 2, y0 + h / 2
    x1, y1 = max(0, int(cx - w * CROP_MARGIN / 2)), max(0, int(cy - h * CROP_MARGIN / 2))
    x2, y2 = min(image.shape[1], int(cx + w * CROP_MARGIN / 2)), min(image.shape[0], int(cy + h * CROP_MARGIN / 2))
    canvas = np.zeros(image.shape[:2], dtype=np.float32)
    canvas[y1:y2, x1:x2] = cv2.resize(cam, (x2 - x1, y2 - y1), interpolation=cv2.INTER_CUBIC)
    return save_heat(canvas, output_path)


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    img = cv2.imread(str(file_path))
    if img is None:
        return ModuleResult(module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    findings = analyze_image(img, file_path)

    if not findings:
        return ModuleResult(module="image", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="sbi", score=0.0, note="no_face_detected: nothing for the face-swap detector to examine")])

    artifacts = {}
    if findings:
        top = max(findings, key=lambda f: f.score)
        artifacts["sbi_heatmap"] = gradcam_heatmap(img, top.region, top.score, str(file_path.with_suffix(".sbi_heatmap.png")))

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        artifacts=artifacts,
        weights_sha256={"sbi": weights_sha256(WEIGHTS_PATH)},
        runtime_s=time.time() - t0,
    )
