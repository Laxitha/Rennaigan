"""How much work the detectors do, by hardware.

With a GPU the full analysis runs. Without one, the frame-by-frame models take minutes per
second of video, so a reduced plan is used and the case says so: fewer sampled frames, shorter
windows, and the two heaviest checks (lip sync and optical flow) are skipped.
"""

from __future__ import annotations

import functools
import os


@functools.lru_cache(maxsize=1)
def has_gpu() -> bool:
    if os.environ.get("RENNAIGAN_REDUCED") == "1":
        return False
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def get() -> dict:
    if has_gpu():
        return {"reduced": False, "max_frames": 180, "aigen_frames": 16, "window_s": 8.0, "max_windows": 5,
                "lip_sync": True, "optical_flow": True}
    return {"reduced": True, "max_frames": 36, "aigen_frames": 6, "window_s": 6.0, "max_windows": 2,
            "lip_sync": False, "optical_flow": False}


REDUCED_NOTE = "No GPU on this machine: reduced analysis (fewer frames, shorter windows, lip sync and optical flow skipped)."
