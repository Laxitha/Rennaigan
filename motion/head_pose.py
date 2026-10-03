"""Head-pose agreement — compare pose from central features vs whole head outline.

Method: OpenCV solvePnP with generic 3D face model.
Flag: mean yaw/pitch/roll difference > 10 degrees for >= 0.5s.
"""

from __future__ import annotations

import cv2
import numpy as np

from common.schema import Finding
from .landmarks import POSE_A_INDICES, POSE_B_INDICES, FACE_3D_MODEL

FPS = 25
DISAGREEMENT_THRESHOLD_DEG = 10.0
MIN_DURATION_SEC = 0.5

# 3D model points for pose B (outline)
FACE_3D_OUTLINE = np.array([
    [0.0, -77.0, -12.0],     # top of head (10)
    [-73.0, 0.0, -55.0],     # left cheek (234)
    [73.0, 0.0, -55.0],      # right cheek (454)
    [0.0, 63.0, -35.0],      # chin (152)
    [0.0, 0.0, 0.0],         # nose tip (1)
], dtype=np.float64)


def estimate_pose(landmarks_2d: np.ndarray, indices: list[int],
                  model_3d: np.ndarray, frame_shape: tuple) -> np.ndarray | None:
    """Returns [yaw, pitch, roll] in degrees, or None on failure."""
    h, w = frame_shape[:2]
    focal = float(w)
    center = (w / 2.0, h / 2.0)
    camera_matrix = np.array([
        [focal, 0, center[0]],
        [0, focal, center[1]],
        [0, 0, 1],
    ], dtype=np.float64)

    pts_2d = landmarks_2d[indices].astype(np.float64)

    if len(pts_2d) != len(model_3d):
        return None

    # The iterative solver needs six points to start from scratch; EPnP works from four.
    flags = cv2.SOLVEPNP_ITERATIVE if len(pts_2d) >= 6 else cv2.SOLVEPNP_EPNP
    try:
        success, rvec, tvec = cv2.solvePnP(model_3d, pts_2d, camera_matrix, np.zeros(4), flags=flags)
    except cv2.error:
        return None

    if not success:
        return None

    rmat, _ = cv2.Rodrigues(rvec)
    angles = cv2.decomposeProjectionMatrix(
        np.hstack((rmat, tvec.reshape(3, 1)))
    )[6]

    return angles.flatten()[:3]


def analyze_head_pose(
    all_landmarks: list[np.ndarray | None],
    frame_shape: tuple,
) -> list[Finding]:
    """Check pose agreement across frames."""
    disagreements = []

    for i, lm in enumerate(all_landmarks):
        if lm is None:
            disagreements.append(None)
            continue

        pose_a = estimate_pose(lm, POSE_A_INDICES, FACE_3D_MODEL, frame_shape)
        pose_b = estimate_pose(lm, POSE_B_INDICES, FACE_3D_OUTLINE, frame_shape)

        if pose_a is None or pose_b is None:
            disagreements.append(None)
            continue

        diff = np.abs(pose_a - pose_b)
        disagreements.append(float(np.mean(diff)))

    findings = []
    start = None
    for i, d in enumerate(disagreements):
        if d is not None and d > DISAGREEMENT_THRESHOLD_DEG:
            if start is None:
                start = i
        else:
            if start is not None:
                duration = (i - start) / FPS
                if duration >= MIN_DURATION_SEC:
                    findings.append(Finding(
                        model="head_pose",
                        score=min(float(np.mean([
                            x for x in disagreements[start:i] if x is not None
                        ])) / 30.0, 1.0),
                        start=start / FPS,
                        end=i / FPS,
                        note="pose_disagreement_central_vs_outline",
                    ))
                start = None

    return findings
