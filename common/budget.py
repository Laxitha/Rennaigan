"""How much work the detectors do, by hardware.

With a GPU the full analysis runs. Without one, the frame-by-frame models take minutes per
second of video, so a reduced plan is used and the case says so: fewer sampled frames, shorter
windows, and the heaviest checks (lip motion, lip sync and optical flow) are skipped.
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
        return {"reduced": False, "max_frames": 96, "aigen_frames": 16, "window_s": 6.0, "max_windows": 4,
                "lip_motion": True, "lip_sync": True, "optical_flow": True, "voice_windows": 48}
    return {"reduced": True, "max_frames": 16, "aigen_frames": 4, "window_s": 6.0, "max_windows": 2,
            "lip_motion": False, "lip_sync": False, "optical_flow": False, "voice_windows": 12}


REDUCED_NOTE = "No GPU on this machine: reduced analysis (fewer frames, shorter windows, lip motion, lip sync and optical flow skipped)."
