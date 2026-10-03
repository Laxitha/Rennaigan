"""Score fusion and calibration.

Trust Score = 100 * (1 - weighted average of calibrated module scores).
Strong-signal cap: any module > 0.9 caps Trust Score at 30.
Coverage < 50% → "Inconclusive".
Labels: 70-100 Low risk · 40-69 Review recommended · 0-39 High manipulation indicators.
"""

from __future__ import annotations

import yaml
import numpy as np
from pathlib import Path

from .schema import ModuleResult

DEFAULT_WEIGHTS_PUBLIC = {
    "image": 0.35,
    "audio": 0.25,
    "motion": 0.15,
    "video": 0.15,    # identity drift + ecapa share this in identity check mode
    "metadata": 0.10,
}

DEFAULT_WEIGHTS_IDENTITY = {
    "image": 0.25,
    "audio": 0.10,
    "motion": 0.20,
    "video": 0.35,    # identity drift + ecapa
    "metadata": 0.10,
}


def load_config(config_path: str = "config.yaml") -> dict:
    path = Path(config_path)
    if path.exists():
        with open(path) as f:
            return yaml.safe_load(f) or {}
    return {}


def calibrate_score(raw_score: float, temperature: float = 1.0) -> float:
    """Temperature-scale a probability in logit space. T=1 leaves it unchanged."""
    if temperature <= 0:
        return raw_score
    p = min(max(float(raw_score), 1e-6), 1.0 - 1e-6)
    logit = np.log(p / (1.0 - p))
    return float(1.0 / (1.0 + np.exp(-logit / temperature)))


def fuse_results(
    results: list[ModuleResult],
    mode: str = "public",
    config: dict | None = None,
) -> dict:
    """Fuse results from all modules into a final verdict.

    Args:
        results: list of ModuleResult from each module
        mode: "public" or "identity" (KYC)
        config: optional config with temperatures and thresholds
    """
    if config is None:
        config = load_config()

    weights = DEFAULT_WEIGHTS_IDENTITY if mode == "identity" else DEFAULT_WEIGHTS_PUBLIC

    temperatures = config.get("temperatures", {})
    module_scores = {}
    all_findings = []
    all_artifacts = {}
    coverage = {}

    for r in results:
        all_findings.extend([f.model_dump() for f in r.findings])
        all_artifacts.update(r.artifacts)

        scores = [f.score for f in r.findings if f.score > 0]
        if scores:
            raw = float(np.mean(scores))
            temp = temperatures.get(r.module, 1.0)
            module_scores[r.module] = calibrate_score(raw, temp)
        else:
            module_scores[r.module] = 0.0

        # Estimate coverage from findings
        total = len(r.findings)
        meaningful = len([f for f in r.findings if "no_" not in f.note and "error" not in f.note])
        coverage[r.module] = meaningful / total if total > 0 else 0.0

    # Weighted average using only modules that ran
    active_modules = {m: w for m, w in weights.items() if m in module_scores}
    if not active_modules:
        return _build_result(100.0, "Inconclusive", all_findings, all_artifacts, results, module_scores, coverage)

    total_weight = sum(active_modules.values())
    weighted_score = sum(
        module_scores[m] * (w / total_weight)
        for m, w in active_modules.items()
    )

    trust_score = 100.0 * (1.0 - weighted_score)

    # Strong-signal cap
    if any(s > 0.9 for s in module_scores.values()):
        trust_score = min(trust_score, 30.0)

    # Coverage check
    avg_coverage = np.mean(list(coverage.values())) if coverage else 0.0
    if avg_coverage < 0.5:
        label = "Inconclusive"
    elif trust_score >= 70:
        label = "Low risk"
    elif trust_score >= 40:
        label = "Review recommended"
    else:
        label = "High manipulation indicators"

    return _build_result(trust_score, label, all_findings, all_artifacts, results, module_scores, coverage)


def _build_result(
    trust_score, label, findings, artifacts, results, module_scores, coverage,
) -> dict:
    return {
        "trust_score": round(trust_score, 1),
        "label": label,
        "module_scores": {k: round(v, 4) for k, v in module_scores.items()},
        "module_coverage": {k: round(v, 2) for k, v in coverage.items()},
        "modules_responded": [r.module for r in results],
        "total_findings": len(findings),
        "findings": findings,
        "artifacts": artifacts,
    }
