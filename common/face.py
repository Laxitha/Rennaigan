"""Shared face detection and embedding using InsightFace buffalo_l.

Provides detection boxes, 5-point landmarks, and 512-d ArcFace embeddings.
"""

from __future__ import annotations

import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np

FACE_APP = None

DET_SIZE = (640, 640)
DET_THRESH = 0.5
MIN_FACE_PX = 64
CROP_MARGIN = 1.3


def get_face_app():
    global FACE_APP
    if FACE_APP is not None:
        return FACE_APP

    from insightface.app import FaceAnalysis
    FACE_APP = FaceAnalysis(name="buffalo_l", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
    FACE_APP.prepare(ctx_id=0, det_size=DET_SIZE)
    return FACE_APP


YUNET_PATH = Path("weights/face_detection_yunet_2023mar.onnx")
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET = None
YUNET_LOCK = threading.Lock()


def detect_faces_yunet(image: np.ndarray, det_thresh: float = 0.6, max_side: int | None = None) -> list[dict]:
    """OpenCV YuNet face boxes. No identity embedding.

    With `max_side`, the detector runs on a copy scaled down to that long side and the boxes are
    mapped back: its cost grows with the pixel count. Small or borderline faces can be missed
    on the smaller copy, so this is for callers that only need the main face.
    """
    global YUNET
    h, w = image.shape[:2]
    scale = min(1.0, max_side / max(h, w, 1)) if max_side else 1.0
    small = cv2.resize(image, (max(int(round(w * scale)), 1), max(int(round(h * scale)), 1)), interpolation=cv2.INTER_AREA) if scale < 1.0 else image
    with YUNET_LOCK:  # one detector object, set to the image size before each call
        if YUNET is None:
            if not YUNET_PATH.exists():
                YUNET_PATH.parent.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(YUNET_URL, YUNET_PATH)
            YUNET = cv2.FaceDetectorYN.create(str(YUNET_PATH), "", (320, 320), det_thresh, 0.3, 50)
        YUNET.setInputSize((small.shape[1], small.shape[0]))
        _, found = YUNET.detect(small)
    results = []
    for row in found if found is not None else []:
        x, y, bw, bh = (int(round(v / scale)) for v in row[:4])
        if min(bw, bh) < MIN_FACE_PX:
            continue
        results.append({
            "box": [max(x, 0), max(y, 0), bw, bh],
            "score": float(row[14]),
            "landmarks": (row[4:14].reshape(5, 2) / scale).tolist(),
            "embedding": None,
        })
    return results


def detect_faces(image: np.ndarray, det_thresh: float = DET_THRESH, embeddings: bool = False) -> list[dict]:
    """Detect faces. Returns list of dicts with box, landmarks, embedding.

    Boxes come from YuNet, which takes a few milliseconds on a CPU. InsightFace is far slower
    and is only run when `embeddings` are needed (identity drift), and only if YuNet saw a face.
    """
    if not embeddings:
        return detect_faces_yunet(image)
    if not detect_faces_yunet(image):
        return []  # nothing to embed; skip the much slower InsightFace pass
    results = _detect_faces_insightface(image, det_thresh)
    return results if results else detect_faces_yunet(image)


def _detect_faces_insightface(image: np.ndarray, det_thresh: float) -> list[dict]:
    app = get_face_app()
    faces = app.get(image)

    results = []
    for face in faces:
        bbox = face.bbox.astype(int)
        x1, y1, x2, y2 = bbox
        w, h = x2 - x1, y2 - y1

        if min(w, h) < MIN_FACE_PX:
            continue
        if face.det_score < det_thresh:
            continue

        results.append({
            "box": [int(x1), int(y1), int(w), int(h)],
            "score": float(face.det_score),
            "landmarks": face.kps.tolist() if face.kps is not None else None,
            "embedding": face.embedding.tolist() if face.embedding is not None else None,
        })

    return results


def crop_face(image: np.ndarray, box: list[int], margin: float = CROP_MARGIN) -> np.ndarray:
    """Crop face with margin, clamped to image bounds."""
    x, y, w, h = box
    cx, cy = x + w / 2, y + h / 2
    new_w, new_h = w * margin, h * margin

    x1 = max(0, int(cx - new_w / 2))
    y1 = max(0, int(cy - new_h / 2))
    x2 = min(image.shape[1], int(cx + new_w / 2))
    y2 = min(image.shape[0], int(cy + new_h / 2))

    return image[y1:y2, x1:x2]


def get_largest_face(faces: list[dict]) -> dict | None:
    if not faces:
        return None
    return max(faces, key=lambda f: f["box"][2] * f["box"][3])


def any_face(frames: list[np.ndarray]) -> bool:
    """Quick check whether any of a few frames shows a face, before running face-based detectors."""
    return any(detect_faces_yunet(frame) for frame in frames)
