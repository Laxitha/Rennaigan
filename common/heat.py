"""Render a 0..1 map as heat on black, for screen-blending over the source image in the UI."""

from __future__ import annotations

import cv2
import numpy as np


def save_heat(heat: np.ndarray, path: str, max_side: int = 1600) -> str:
    """`heat` is HxW in [0, 1]. 0 stays black (transparent when screen-blended)."""
    m = np.clip(heat.astype(np.float32), 0.0, 1.0)
    scale = max_side / max(m.shape)
    if scale < 1:
        m = cv2.resize(m, (int(m.shape[1] * scale), int(m.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    # black -> red -> yellow -> white, in BGR order for OpenCV
    bgr = np.stack([np.clip(m * 3 - 2, 0, 1), np.clip(m * 3 - 1, 0, 1), np.clip(m * 3, 0, 1)], axis=2)
    cv2.imwrite(path, (bgr * 255).astype(np.uint8))
    return path
