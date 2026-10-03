"""Shared MediaPipe Face Mesh landmarks for all motion checks.

478 points with refine_landmarks=True.
All distances normalized by inter-ocular distance (points 33 and 263).
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

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


TASK_MODEL = Path("weights/face_landmarker.task")
TASK_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"


def get_face_mesh():
    """Returns ("legacy", FaceMesh) or ("tasks", FaceLandmarker). Both give the same 478 points.

    Newer MediaPipe releases dropped `mp.solutions`; the Tasks API replaces it and needs a
    model file, downloaded on first use.
    """
    global MP_FACE_MESH
    if MP_FACE_MESH is not None:
        return MP_FACE_MESH

    import mediapipe as mp
    if hasattr(mp, "solutions"):
        MP_FACE_MESH = ("legacy", mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ))
        return MP_FACE_MESH

    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    if not TASK_MODEL.exists():
        TASK_MODEL.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(TASK_MODEL_URL, TASK_MODEL)
    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(TASK_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.5,
    )
    MP_FACE_MESH = ("tasks", vision.FaceLandmarker.create_from_options(options))
    return MP_FACE_MESH


def get_landmarks(frame_rgb: np.ndarray) -> np.ndarray | None:
    """Return a (478, 2) array of landmark pixel coordinates, or None when no face is found."""
    kind, mesh = get_face_mesh()
    h, w = frame_rgb.shape[:2]

    if kind == "legacy":
        result = mesh.process(frame_rgb)
        if not result.multi_face_landmarks:
            return None
        points = result.multi_face_landmarks[0].landmark
    else:
        import mediapipe as mp
        result = mesh.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(frame_rgb)))
        if not result.face_landmarks:
            return None
        points = result.face_landmarks[0]

    return np.array([(lm.x * w, lm.y * h) for lm in points])


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
