"""Shared face detection and embedding using InsightFace buffalo_l.

Provides detection boxes, 5-point landmarks, and 512-d ArcFace embeddings.
"""

from __future__ import annotations

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


def detect_faces(image: np.ndarray, det_thresh: float = DET_THRESH) -> list[dict]:
    """Detect faces with InsightFace. Returns list of dicts with box, landmarks, embedding."""
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
