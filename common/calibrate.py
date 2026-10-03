"""Temperature scaling calibration.

Run on labeled real/fake samples to calibrate each module's scores.
Target: ~5% false positive rate on real samples.

Usage:
  python -m common.calibrate --module image --real-dir samples/real --fake-dir samples/fake
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import minimize_scalar


def fit_temperature(logits: np.ndarray, labels: np.ndarray) -> float:
    """Fit temperature T so sigmoid(logit/T) gives calibrated probabilities.

    Args:
        logits: raw model scores (higher = more fake)
        labels: 1 = fake, 0 = real
    """
    def nll(T):
        p = 1.0 / (1.0 + np.exp(-logits / T))
        p = np.clip(p, 1e-6, 1 - 1e-6)
        return -np.mean(labels * np.log(p) + (1 - labels) * np.log(1 - p))

    result = minimize_scalar(nll, bounds=(0.05, 20), method="bounded")
    return float(result.x)


def find_threshold(scores: np.ndarray, labels: np.ndarray, fpr_target: float = 0.05) -> float:
    """Find threshold for target false positive rate on real samples."""
    real_scores = scores[labels == 0]
    if len(real_scores) == 0:
        return 0.5
    threshold = float(np.percentile(real_scores, 100 * (1 - fpr_target)))
    return threshold


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Calibrate module thresholds")
    parser.add_argument("--module", required=True, choices=["image", "video", "audio", "motion", "metadata"])
    parser.add_argument("--scores-file", required=True, help="JSON file with {path: score, ...} for each sample")
    parser.add_argument("--labels-file", required=True, help="JSON file with {path: 0|1, ...} for each sample")
    parser.add_argument("--fpr", type=float, default=0.05, help="Target false positive rate")
    args = parser.parse_args()

    with open(args.scores_file) as f:
        scores_dict = json.load(f)
    with open(args.labels_file) as f:
        labels_dict = json.load(f)

    common_keys = sorted(set(scores_dict) & set(labels_dict))
    scores = np.array([scores_dict[k] for k in common_keys])
    labels = np.array([labels_dict[k] for k in common_keys])

    temperature = fit_temperature(scores, labels)
    threshold = find_threshold(scores, labels, args.fpr)

    print(f"Module: {args.module}")
    print(f"Temperature: {temperature:.4f}")
    print(f"Threshold (FPR={args.fpr}): {threshold:.4f}")
    print(f"Samples: {len(common_keys)} ({int(labels.sum())} fake, {int((1-labels).sum())} real)")

    calibrated = 1.0 / (1.0 + np.exp(-scores / temperature))
    print(f"Calibrated mean (real): {calibrated[labels==0].mean():.4f}")
    print(f"Calibrated mean (fake): {calibrated[labels==1].mean():.4f}")
