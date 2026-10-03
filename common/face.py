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


def detect_faces_yunet(image: np.ndarray, det_thresh: float = 0.6) -> list[dict]:
    """OpenCV YuNet face boxes. No identity embedding."""
    global YUNET
    h, w = image.shape[:2]
    with YUNET_LOCK:  # one detector object, set to the image size before each call
        if YUNET is None:
            if not YUNET_PATH.exists():
                YUNET_PATH.parent.mkdir(parents=True, exist_ok=True)
                urllib.request.urlretrieve(YUNET_URL, YUNET_PATH)
            YUNET = cv2.FaceDetectorYN.create(str(YUNET_PATH), "", (320, 320), det_thresh, 0.3, 50)
        YUNET.setInputSize((w, h))
        _, found = YUNET.detect(image)
    results = []
    for row in found if found is not None else []:
        x, y, bw, bh = (int(v) for v in row[:4])
        if min(bw, bh) < MIN_FACE_PX:
            continue
        results.append({
            "box": [max(x, 0), max(y, 0), bw, bh],
            "score": float(row[14]),
            "landmarks": row[4:14].reshape(5, 2).tolist(),
            "embedding": None,
        })
    return results


def detect_faces(image: np.ndarray, det_thresh: float = DET_THRESH) -> list[dict]:
    """Detect faces. Returns list of dicts with box, landmarks, embedding.

    InsightFace is used first because it also gives identity embeddings. When it finds
    nothing, YuNet is tried, so one detector missing a face does not hide it from SBI.
    """
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
