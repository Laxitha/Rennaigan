"""Blink dynamics — weak signal detector.

Eye aspect ratio threshold: 0.21
Normal: 8-21 blinks/min, 100-400ms duration
Flag: no blinks in 20s+ of visible face, or blinks > 500ms
Weight: low (0.2)
"""

from __future__ import annotations

import numpy as np

from common.schema import Finding
from .landmarks import LEFT_EYE, RIGHT_EYE, eye_aspect_ratio

FPS = 25
EAR_THRESHOLD = 0.21
MIN_BLINK_FRAMES = 2
NORMAL_BLINK_RATE_MIN = 8
NORMAL_BLINK_RATE_MAX = 21
MAX_NO_BLINK_SEC = 20.0
MAX_BLINK_DURATION_MS = 500
MIN_BLINK_DURATION_MS = 100


def analyze_blinks(
    all_landmarks: list[np.ndarray | None],
) -> list[Finding]:
    """Detect abnormal blink patterns."""
    n = len(all_landmarks)
    if n < FPS * 5:  # need at least 5 seconds
        return []

    ears = []
    face_visible = []
    for lm in all_landmarks:
        if lm is None:
            ears.append(None)
            face_visible.append(False)
        else:
            left_ear = eye_aspect_ratio(lm, LEFT_EYE)
            right_ear = eye_aspect_ratio(lm, RIGHT_EYE)
            avg_ear = (left_ear + right_ear) / 2.0
            ears.append(avg_ear)
            face_visible.append(True)

    # Detect blinks
    blinks = []
    in_blink = False
    blink_start = None

    for i, ear in enumerate(ears):
        if ear is None:
            if in_blink:
                blinks.append((blink_start, i - 1))
                in_blink = False
            continue

        if ear < EAR_THRESHOLD:
            if not in_blink:
                in_blink = True
                blink_start = i
        else:
            if in_blink:
                blinks.append((blink_start, i - 1))
                in_blink = False

    findings = []

    # Check for no blinks in long segments
    visible_segments = []
    seg_start = None
    for i, vis in enumerate(face_visible):
        if vis:
            if seg_start is None:
                seg_start = i
        else:
            if seg_start is not None:
                visible_segments.append((seg_start, i))
                seg_start = None
    if seg_start is not None:
        visible_segments.append((seg_start, n))

    for seg_start, seg_end in visible_segments:
        seg_duration = (seg_end - seg_start) / FPS
        if seg_duration < MAX_NO_BLINK_SEC:
            continue

        seg_blinks = [b for b in blinks if b[0] >= seg_start and b[1] <= seg_end]
        if not seg_blinks:
            findings.append(Finding(
                model="blink_dynamics",
                score=0.4,
                start=seg_start / FPS,
                end=seg_end / FPS,
                note=f"no_blinks_in_{seg_duration:.1f}s",
            ))

    # Check for abnormally long blinks
    for start, end in blinks:
        duration_ms = (end - start + 1) / FPS * 1000
        if duration_ms > MAX_BLINK_DURATION_MS:
            findings.append(Finding(
                model="blink_dynamics",
                score=0.3,
                start=start / FPS,
                end=(end + 1) / FPS,
                note=f"long_blink_{duration_ms:.0f}ms",
            ))

    return findings
