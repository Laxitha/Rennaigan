"""Shared MediaPipe Face Mesh landmarks for all motion checks.

478 points with refine_landmarks=True.
All distances normalized by inter-ocular distance (points 33 and 263).
"""

from __future__ import annotations

import cv2
import numpy as np

MP_FACE_MESH = None

LEFT_EYE_INNER = 33
RIGHT_EYE_INNER = 263

# Eye landmarks for blink detection
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

# Head pose landmarks
POSE_A_INDICES = [1, 33, 263, 61, 291, 152]  # nose, eye corners, mouth corners, chin
POSE_B_INDICES = [10, 234, 454, 152, 1]      # face outline + nose

# 3D model points for solvePnP (generic face model, mm)
FACE_3D_MODEL = np.array([
    [0.0, 0.0, 0.0],         # nose tip (1)
    [-65.5, -5.0, -52.0],    # left eye inner (33)
    [65.5, -5.0, -52.0],     # right eye inner (263)
    [-44.0, 48.0, -40.0],    # left mouth corner (61)
    [44.0, 48.0, -40.0],     # right mouth corner (291)
    [0.0, 63.0, -35.0],      # chin (152)
], dtype=np.float64)


def get_face_mesh():
    global MP_FACE_MESH
    if MP_FACE_MESH is not None:
        return MP_FACE_MESH

    import mediapipe as mp
    MP_FACE_MESH = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return MP_FACE_MESH


def get_landmarks(frame_rgb: np.ndarray) -> np.ndarray | None:
    """Return (478, 2) array of normalized landmark coordinates, or None."""
    mesh = get_face_mesh()
    result = mesh.process(frame_rgb)

    if not result.multi_face_landmarks:
        return None

    face = result.multi_face_landmarks[0]
    h, w = frame_rgb.shape[:2]
    pts = np.array([(lm.x * w, lm.y * h) for lm in face.landmark])
    return pts


def inter_ocular_distance(landmarks: np.ndarray) -> float:
    left = landmarks[LEFT_EYE_INNER]
    right = landmarks[RIGHT_EYE_INNER]
    return float(np.linalg.norm(left - right))


def normalize_landmarks(landmarks: np.ndarray) -> np.ndarray:
    iod = inter_ocular_distance(landmarks)
    if iod < 1e-6:
        return landmarks
    return landmarks / iod


def eye_aspect_ratio(landmarks: np.ndarray, eye_indices: list[int]) -> float:
    pts = landmarks[eye_indices]
    v1 = np.linalg.norm(pts[1] - pts[5])
    v2 = np.linalg.norm(pts[2] - pts[4])
    h = np.linalg.norm(pts[0] - pts[3])
    if h < 1e-6:
        return 0.0
    return float((v1 + v2) / (2.0 * h))
