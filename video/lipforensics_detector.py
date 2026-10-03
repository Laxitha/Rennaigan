"""LipForensics — lip-based deepfake detector.

Setup:
  1. git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
  2. Download weights: lipforensics_ff.pth from the README link → weights/lipforensics_ff.pth
  3. pip install face_alignment (or dlib with cmake)

Input: work/video25.mp4 (25 fps)
Preprocessing: face landmarks → aligned grayscale mouth crops, 88x88
Clip length: 25 frames (1s), stride 25
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

WEIGHTS_PATH = Path("weights/lipforensics_ff.pth")
REPO_PATH = Path("repos/lipforensics")
MODEL = None
DEVICE = None
CLIP_LENGTH = 25
STRIDE = 25
MOUTH_SIZE = 88
THRESHOLD = 0.5

MOUTH_LANDMARKS = list(range(48, 68))
STABLE_POINTS = [33, 36, 39, 42, 45]


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"LipForensics weights not found at {WEIGHTS_PATH}.\n"
            "Download lipforensics_ff.pth from the LipForensics repo."
        )

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if REPO_PATH.exists():
        sys.path.insert(0, str(REPO_PATH))

    from preprocessing.transform import warp
    from models.spatiotemporal_net import get_model

    MODEL = get_model()
    ckpt = torch.load(str(WEIGHTS_PATH), map_location=DEVICE)
    if "model_state_dict" in ckpt:
        MODEL.load_state_dict(ckpt["model_state_dict"])
    elif "state_dict" in ckpt:
        MODEL.load_state_dict(ckpt["state_dict"])
    else:
        MODEL.load_state_dict(ckpt)

    MODEL.eval()
    MODEL = MODEL.to(DEVICE)
    return MODEL


def extract_mouth_crops(video_path: Path) -> list[np.ndarray]:
    """Extract aligned grayscale mouth crops from 25fps video.

    Returns list of arrays, each (25, 88, 88) — one per 1-second clip.
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
        mouth_w = int((mouth_pts[:, 0].max() - mouth_pts[:, 0].min()) * 1.5)
        mouth_h = int((mouth_pts[:, 1].max() - mouth_pts[:, 1].min()) * 1.5)
        half_size = max(mouth_w, mouth_h) // 2

        y1 = max(0, cy - half_size)
        y2 = min(gray.shape[0], cy + half_size)
        x1 = max(0, cx - half_size)
        x2 = min(gray.shape[1], cx + half_size)

        mouth_crop = gray[y1:y2, x1:x2]
        if mouth_crop.size == 0:
            all_mouths.append(None)
            continue

        mouth_crop = cv2.resize(mouth_crop, (MOUTH_SIZE, MOUTH_SIZE))
        all_mouths.append(mouth_crop)

    cap.release()

    clips = []
    valid_mouths = [(i, m) for i, m in enumerate(all_mouths) if m is not None]

    for start in range(0, len(all_mouths) - CLIP_LENGTH + 1, STRIDE):
        clip_frames = all_mouths[start:start + CLIP_LENGTH]
        if any(f is None for f in clip_frames):
            continue
        clip = np.stack(clip_frames, axis=0).astype(np.float32) / 255.0
        clips.append(clip)

    return clips


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path

    try:
        model = load_model()
    except FileNotFoundError as e:
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    try:
        clips = extract_mouth_crops(target)
    except FileNotFoundError as e:
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    if not clips:
        return ModuleResult(
            module="video",
            file_sha256=sha,
            findings=[Finding(model="lipforensics", score=0.0, note="no_mouth_crops_extracted")],
            runtime_s=time.time() - t0,
        )

    findings: list[Finding] = []
    for i, clip in enumerate(clips):
        tensor = torch.from_numpy(clip).unsqueeze(0).unsqueeze(0).float().to(DEVICE)
        with torch.no_grad():
            output = model(tensor)
            score = torch.sigmoid(output).item()

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
