"""LipForensics — lip-based deepfake detector.

Setup:
  1. git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
  2. Download weights:
     lipforensics_ff.pth → repos/lipforensics/models/weights/lipforensics_ff.pth
     (Google Drive: https://drive.google.com/file/d/1wfZnxZpyNd5ouJs0LjVls7zU0N_W73L7)
  3. pip install face_alignment torchvision

Architecture:
  - ResNet18 spatial features + Multi-scale Temporal CNN
  - Class: Lipreading, loaded via get_model() factory
  - Forward: model(x, lengths) where x=(batch,1,frames,88,88)
  - Input: grayscale mouth crops, center-cropped from 96→88px
  - Normalization: mean=0.421, std=0.165
  - Checkpoint key: "model"
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

WEIGHTS_PATH = Path("repos/lipforensics/models/weights/lipforensics_ff.pth")
WEIGHTS_ALT_PATH = Path("weights/lipforensics_ff.pth")
REPO_PATH = Path("repos/lipforensics")
MODEL = None
DEVICE = None
CLIP_LENGTH = 25
STRIDE = 25
CROP_SIZE = 96
MOUTH_SIZE = 88
THRESHOLD = 0.5

MOUTH_LANDMARKS = list(range(48, 68))
STABLE_POINTS = [33, 36, 39, 42, 45]

GRAY_MEAN = 0.421
GRAY_STD = 0.165


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    weights_path = WEIGHTS_PATH if WEIGHTS_PATH.exists() else WEIGHTS_ALT_PATH
    if not weights_path.exists():
        raise FileNotFoundError(
            f"LipForensics weights not found.\n"
            f"Download lipforensics_ff.pth to {WEIGHTS_PATH} or {WEIGHTS_ALT_PATH}"
        )
    if not REPO_PATH.exists():
        raise FileNotFoundError(
            f"LipForensics repo not found at {REPO_PATH}.\n"
            "git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics"
        )

    sys.path.insert(0, str(REPO_PATH))

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    from models.spatiotemporal_net import get_model
    MODEL = get_model(
        weights_forgery_path=str(weights_path),
        device=str(DEVICE),
    )
    MODEL.eval()
    return MODEL


def extract_mouth_crops(video_path: Path) -> list[np.ndarray]:
    """Extract aligned grayscale mouth crops from 25fps video.

    Returns list of arrays, each (clip_length, 96, 96) — one per 1-second clip.
    Center-cropping to 88x88 happens at inference time.
    """
    try:
        import face_alignment
    except ImportError:
        raise FileNotFoundError("pip install face_alignment")

    fa = face_alignment.FaceAlignment(
        face_alignment.LandmarksType.TWO_D,
        device="cuda" if torch.cuda.is_available() else "cpu",
        flip_input=False,
    )

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return []

    all_mouths = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        landmarks = fa.get_landmarks(frame)
        if landmarks is None or len(landmarks) == 0:
            all_mouths.append(None)
            continue

        lm = landmarks[0]
        mouth_pts = lm[MOUTH_LANDMARKS]
        cx, cy = mouth_pts.mean(axis=0).astype(int)
        half_size = CROP_SIZE // 2

        y1 = max(0, cy - half_size)
        y2 = min(gray.shape[0], cy + half_size)
        x1 = max(0, cx - half_size)
        x2 = min(gray.shape[1], cx + half_size)

        mouth_crop = gray[y1:y2, x1:x2]
        if mouth_crop.size == 0:
            all_mouths.append(None)
            continue

        mouth_crop = cv2.resize(mouth_crop, (CROP_SIZE, CROP_SIZE))
        all_mouths.append(mouth_crop)

    cap.release()

    clips = []
    for start in range(0, len(all_mouths) - CLIP_LENGTH + 1, STRIDE):
        clip_frames = all_mouths[start:start + CLIP_LENGTH]
        if any(f is None for f in clip_frames):
            continue
        clip = np.stack(clip_frames, axis=0).astype(np.float32) / 255.0
        clips.append(clip)

    return clips


def preprocess_clip(clip: np.ndarray) -> torch.Tensor:
    """Convert (T, 96, 96) grayscale clip to model input (1, 1, T, 88, 88)."""
    t, h, w = clip.shape
    offset = (CROP_SIZE - MOUTH_SIZE) // 2
    cropped = clip[:, offset:offset + MOUTH_SIZE, offset:offset + MOUTH_SIZE]

    normalized = (cropped - GRAY_MEAN) / GRAY_STD

    tensor = torch.from_numpy(normalized).float()
    return tensor.unsqueeze(0).unsqueeze(0)  # (1, 1, T, 88, 88)


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path

    try:
        model = load_model()
    except FileNotFoundError as e:
        return ModuleResult(
            module="video", file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    try:
        clips = extract_mouth_crops(target)
    except FileNotFoundError as e:
        return ModuleResult(
            module="video", file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    if not clips:
        return ModuleResult(
            module="video", file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note="no_mouth_crops_extracted")],
            runtime_s=time.time() - t0,
        )

    findings: list[Finding] = []
    for i, clip in enumerate(clips):
        tensor = preprocess_clip(clip).to(DEVICE)
        lengths = [CLIP_LENGTH]

        with torch.no_grad():
            logits = model(tensor, lengths)
            score = torch.sigmoid(logits).item()

        start_sec = i * (STRIDE / 25.0)
        end_sec = start_sec + (CLIP_LENGTH / 25.0)

        findings.append(Finding(
            model="lipforensics",
            score=score,
            start=start_sec,
            end=end_sec,
            note="lip_deepfake_detected" if score >= THRESHOLD else "lip_appears_genuine",
        ))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"lipforensics": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
