"""Motion smoothness — detect unnatural jerk in landmark trajectories.

Signal: normalized landmark trajectories (nose, eyes, mouth, jaw)
Smoothing: Savitzky-Golay, window 7, order 2
Metric: jerk (3rd derivative), flag above median + 4*MAD, not at scene cuts.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import savgol_filter

from common.schema import Finding

FPS = 25
SAVGOL_WINDOW = 7
SAVGOL_ORDER = 2
JERK_MAD_THRESHOLD = 4.0
TRACKED_LANDMARKS = [1, 33, 263, 61, 291, 152, 10]  # nose, eyes, mouth corners, chin, forehead


def compute_jerk(
    all_landmarks: list[np.ndarray | None],
    scene_cuts: set[int] | None = None,
) -> list[Finding]:
    """Detect unnatural motion jerk across frames."""
    if scene_cuts is None:
        scene_cuts = set()

    n = len(all_landmarks)
    if n < SAVGOL_WINDOW + 3:
        return []

    trajectories = {idx: [] for idx in TRACKED_LANDMARKS}
    valid_frames = []

    for i, lm in enumerate(all_landmarks):
        if lm is None:
            for idx in TRACKED_LANDMARKS:
                trajectories[idx].append(np.array([np.nan, np.nan]))
            valid_frames.append(False)
        else:
            for idx in TRACKED_LANDMARKS:
                trajectories[idx].append(lm[idx])
            valid_frames.append(True)

    all_jerks = np.zeros(n)
    count = 0

    for idx in TRACKED_LANDMARKS:
        traj = np.array(trajectories[idx])
        for dim in range(2):
            signal = traj[:, dim]
            valid = ~np.isnan(signal)
            if valid.sum() < SAVGOL_WINDOW:
                continue

            signal_clean = np.interp(
                np.arange(n),
                np.where(valid)[0],
                signal[valid],
            )

            smoothed = savgol_filter(signal_clean, SAVGOL_WINDOW, SAVGOL_ORDER)
            if len(smoothed) < 4:
                continue
            jerk = np.abs(np.diff(smoothed, n=3))
            jerk = np.concatenate([jerk, [0, 0, 0]])
            all_jerks[:len(jerk)] += jerk
            count += 1

    if count == 0:
        return []

    all_jerks /= count
    median_jerk = np.median(all_jerks)
    mad = np.median(np.abs(all_jerks - median_jerk))
    if mad < 1e-8:
        return []

    threshold = median_jerk + JERK_MAD_THRESHOLD * mad

    findings = []
    for i in range(n):
        if i in scene_cuts:
            continue
        if not valid_frames[i]:
            continue
        if all_jerks[i] > threshold:
            findings.append(Finding(
                model="motion_smoothness",
                score=min(float(all_jerks[i] / (threshold * 2)), 1.0),
                start=i / FPS,
                end=(i + 1) / FPS,
                note=f"jerk_spike={all_jerks[i]:.4f}",
            ))

    return findings
