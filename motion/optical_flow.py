"""Optical flow consistency — RAFT face vs background ring comparison.

Model: torchvision raft_large (raft_small if slow)
Regions: face box vs 1.6x ring around it
Metric: residual jitter z-score > 3 for >= 0.4s
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import torch
from torchvision.models.optical_flow import raft_large, Raft_Large_Weights

from common.schema import Finding

RAFT_MODEL = None
RAFT_TRANSFORMS = None
RING_SCALE = 1.6
JITTER_ZSCORE_THRESHOLD = 3.0
MIN_DURATION_SEC = 0.4
FPS = 25


def load_raft():
    global RAFT_MODEL, RAFT_TRANSFORMS
    if RAFT_MODEL is not None:
        return RAFT_MODEL, RAFT_TRANSFORMS

    weights = Raft_Large_Weights.DEFAULT
    RAFT_MODEL = raft_large(weights=weights)
    RAFT_MODEL.eval()
    if torch.cuda.is_available():
        RAFT_MODEL = RAFT_MODEL.cuda()
    RAFT_TRANSFORMS = weights.transforms()
    return RAFT_MODEL, RAFT_TRANSFORMS


def make_divisible(frame: np.ndarray) -> np.ndarray:
    """Resize so H and W are divisible by 8."""
    h, w = frame.shape[:2]
    new_h = (h // 8) * 8
    new_w = (w // 8) * 8
    if new_h != h or new_w != w:
        frame = cv2.resize(frame, (new_w, new_h))
    return frame


def compute_flow(frame1: np.ndarray, frame2: np.ndarray) -> np.ndarray:
    """Compute optical flow between two BGR frames. Returns (H, W, 2)."""
    model, transforms = load_raft()
    device = next(model.parameters()).device

    f1 = make_divisible(frame1)
    f2 = make_divisible(frame2)

    t1 = torch.from_numpy(cv2.cvtColor(f1, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().unsqueeze(0)
    t2 = torch.from_numpy(cv2.cvtColor(f2, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().unsqueeze(0)

    t1, t2 = transforms(t1, t2)
    t1, t2 = t1.to(device), t2.to(device)

    with torch.no_grad():
        flows = model(t1, t2, num_flow_updates=12)
        flow = flows[-1][0].permute(1, 2, 0).cpu().numpy()

    return flow


def flow_residual(frame1: np.ndarray, frame2: np.ndarray, box: list[int]) -> float | None:
    """Median flow inside the face box minus the median in the ring around it."""
    flow = compute_flow(frame1, frame2)
    h, w = flow.shape[:2]

    x, y, fw, fh = box
    sx, sy = w / frame1.shape[1], h / frame1.shape[0]
    fx1, fy1 = int(x * sx), int(y * sy)
    fx2, fy2 = int((x + fw) * sx), int((y + fh) * sy)

    cx, cy = (fx1 + fx2) / 2, (fy1 + fy2) / 2
    rw, rh = (fx2 - fx1) * RING_SCALE, (fy2 - fy1) * RING_SCALE
    rx1, ry1 = max(0, int(cx - rw / 2)), max(0, int(cy - rh / 2))
    rx2, ry2 = min(w, int(cx + rw / 2)), min(h, int(cy + rh / 2))

    face_mask = np.zeros((h, w), dtype=bool)
    face_mask[max(fy1, 0):fy2, max(fx1, 0):fx2] = True
    ring_mask = np.zeros((h, w), dtype=bool)
    ring_mask[ry1:ry2, rx1:rx2] = True
    ring_mask[face_mask] = False
    if face_mask.sum() < 10 or ring_mask.sum() < 10:
        return None

    flow_mag = np.linalg.norm(flow, axis=-1)
    return float(np.median(flow_mag[face_mask]) - np.median(flow_mag[ring_mask]))


def analyze_flow_consistency(residuals: list[float], timestamps: list[float]) -> list[Finding]:
    """Flag stretches where the face moves against its surroundings.

    `residuals` are flow_residual() values for frame pairs taken at `timestamps` (seconds).
    """
    if len(residuals) < 10:
        return []

    diffs = np.diff(np.array(residuals))
    mad = np.median(np.abs(diffs - np.median(diffs)))
    if mad < 1e-6:
        return []
    z_scores = np.abs(diffs - np.median(diffs)) / (mad * 1.4826)

    findings = []
    start = None
    for j in range(len(z_scores) + 1):
        high = j < len(z_scores) and z_scores[j] > JITTER_ZSCORE_THRESHOLD
        if high and start is None:
            start = j
        elif not high and start is not None:
            end = min(j, len(timestamps) - 1)
            if timestamps[end] - timestamps[start] >= MIN_DURATION_SEC:
                findings.append(Finding(
                    model="optical_flow",
                    score=min(float(np.max(z_scores[start:j])) / 10.0, 1.0),
                    start=timestamps[start],
                    end=timestamps[end],
                    note="flow_inconsistency_face_vs_background",
                ))
            start = None
    return findings
