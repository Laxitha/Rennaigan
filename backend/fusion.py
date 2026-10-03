"""Cross-module fusion into a trust score.

Each detector inside a module targets a different manipulation, so a module's score is its
strongest detector. Modules are then averaged by their configured weight, scaled by how much
of the module actually ran. Modules that could not run contribute nothing and lower the
evidence weight instead of counting as "clean".
"""

from __future__ import annotations

import numpy as np

from common.fusion import calibrate_score

from .config import MODULE_DETECTORS


def _model_score(findings: list[dict]) -> tuple[float, dict]:
    """One detector's score for the file, and the finding it rests on.

    A detector that scores many windows also reports a file-level aggregate ("clip_level" or
    "video_level") and sustained "interval" findings. Those decide its score: single windows
    are too noisy to, and remain in the case as detail only.
    """
    decisive = [f for f in findings if f["note"].startswith(("clip_level", "video_level")) or "interval" in f["note"].split(":")[0]]
    if decisive:
        top = max(decisive, key=lambda f: f["score"])
        return top["score"], top
    scores = [f["score"] for f in findings]
    top = max(findings, key=lambda f: f["score"])
    # Several unaggregated findings: the 90th percentile resists a single outlier.
    return (float(np.percentile(scores, 90)) if len(scores) >= 5 else top["score"]), top


def soften(score: float, threshold: float) -> float:
    """Scores below a detector's decision threshold mean "classified as genuine".

    These outputs are not calibrated probabilities, so 0.3 is not "30% manipulated". Below the
    threshold the score is pulled toward zero (continuous at the threshold, unchanged above it).
    """
    return score if score >= threshold or threshold <= 0 else score * score / threshold


def _no_data(f: dict) -> bool:
    """A detector saying it had nothing to examine (no face, no speech, no manifest)."""
    return f["score"] == 0.0 and f["note"].startswith("no_")


def module_score(findings: list[dict], mode: str, thresholds: dict | None = None, learned: bool = False) -> tuple[float, dict | None, int]:
    """Strongest detector score in a module, the finding behind it, and how many of its
    detectors had nothing to examine."""
    thresholds = thresholds or {}
    by_model: dict[str, list[dict]] = {}
    for f in findings:
        if f["kind"] == "error":
            continue
        if f["model"] == "ecapa" and mode != "identity":
            continue
        by_model.setdefault(f["model"], []).append(f)
    best, top, empty = 0.0, None, 0
    for group in by_model.values():
        scored = [f for f in group if not _no_data(f)]
        if not scored:
            empty += 1
            continue
        score, finding = _model_score(scored)
        if learned:
            score = soften(score, float(thresholds.get(finding["model"], 0.5)))
        if score > best:
            best, top = score, finding
    return best, top, empty


def fuse(runs: dict[str, dict], applicable: list[str], mode: str, cfg: dict) -> dict:
    weights = cfg["module_weights"].get(mode) or cfg["module_weights"]["public"]
    fusion_cfg, labels = cfg["fusion"], cfg["labels"]

    scores: dict[str, float] = {}
    coverage: dict[str, float] = {}
    top: tuple[float, str, dict] | None = None
    for module in applicable:
        run = runs.get(module)
        cov = run["coverage"] if run and run["info"]["status"] in ("ok", "degraded") else 0.0
        learned = module not in fusion_cfg.get("heuristic_modules", [])
        raw, finding, empty = module_score(run["findings"], mode, cfg["thresholds"], learned) if cov > 0 else (0.0, None, 0)
        # A detector with nothing to examine is not evidence that the file is clean.
        cov = max(0.0, cov - empty / max(len(MODULE_DETECTORS.get(module, [])), 1))
        coverage[module] = round(cov, 2)
        if cov <= 0:
            continue
        if module in fusion_cfg.get("heuristic_modules", []):
            raw = min(raw, float(fusion_cfg.get("heuristic_score_cap", 1.0)))
        scores[module] = calibrate_score(raw, float(cfg["temperatures"].get(module, 1.0))) if raw > 0 else 0.0
        if finding and (top is None or scores[module] > top[0]):
            top = (scores[module], module, finding)

    total_weight = sum(weights.get(m, 0.0) for m in applicable)
    live_weight = sum(weights.get(m, 0.0) * coverage[m] for m in scores)
    evidence_weight = live_weight / total_weight if total_weight else 0.0
    missing = [m for m in applicable if coverage[m] < 1.0]

    result = {
        "module_scores": {m: round(s, 4) for m, s in scores.items()},
        "module_coverage": coverage,
        "evidence_weight": round(evidence_weight, 3),
    }
    if live_weight <= 0:
        return {**result, "trust_score": None, "label": "Inconclusive",
                "label_reason": "No detector produced evidence for this file, so no trust score was computed."}

    weighted = sum(scores[m] * weights.get(m, 0.0) * coverage[m] for m in scores) / live_weight
    trust = 100.0 * (1.0 - weighted)
    capped = any(s >= fusion_cfg["strong_signal_cap"] for s in scores.values())
    if capped:
        trust = min(trust, float(fusion_cfg["strong_signal_max_trust"]))
    trust = round(trust, 1)

    reasons = []
    if top and top[0] >= fusion_cfg["signal_floor"]:
        reasons.append(f"Strongest signal: {top[2]['model']} in the {top[1]} module at {top[0]:.2f} ({top[2]['note'][:120]}).")
    else:
        reasons.append("No detector that ran reported a manipulation signal.")
    if capped:
        reasons.append(f"One module is above {fusion_cfg['strong_signal_cap']}, so the trust score is capped at {fusion_cfg['strong_signal_max_trust']}.")

    if evidence_weight < fusion_cfg["inconclusive_coverage_threshold"]:
        label = "Inconclusive"
        reasons.append(f"Only {evidence_weight:.0%} of the applicable detector weight produced evidence"
                       f" (incomplete: {', '.join(missing)}), which is too little for a verdict.")
    elif trust >= labels["low_risk"][0]:
        label = "Low risk"
    elif trust >= labels["review"][0]:
        label = "Review recommended"
    else:
        label = "High manipulation indicators"
    if label != "Inconclusive" and missing:
        reasons.append(f"Incomplete modules: {', '.join(missing)}.")

    return {**result, "trust_score": trust, "label": label, "label_reason": " ".join(reasons)}
