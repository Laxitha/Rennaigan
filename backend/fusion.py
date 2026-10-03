"""Cross-module fusion into a trust score.

Each detector inside a module targets a different manipulation, so a module's score is its
strongest detector. Modules are then averaged by their configured weight, scaled by how much
of the module actually ran. Modules that could not run contribute nothing and lower the
evidence weight instead of counting as "clean".
"""

from __future__ import annotations

import numpy as np

from common.fusion import calibrate_score


def _model_score(scores: list[float]) -> float:
    # Many per-clip findings from one detector: the 90th percentile resists single outliers.
    return float(np.percentile(scores, 90)) if len(scores) >= 5 else max(scores)


def module_score(findings: list[dict], mode: str) -> tuple[float, dict | None]:
    """Strongest detector score in a module, and the finding behind it."""
    by_model: dict[str, list[dict]] = {}
    for f in findings:
        if f["kind"] == "error":
            continue
        if f["model"] == "ecapa" and mode != "identity":
            continue
        by_model.setdefault(f["model"], []).append(f)
    best, top = 0.0, None
    for group in by_model.values():
        score = _model_score([f["score"] for f in group])
        if score > best:
            best, top = score, max(group, key=lambda f: f["score"])
    return best, top


def fuse(runs: dict[str, dict], applicable: list[str], mode: str, cfg: dict) -> dict:
    weights = cfg["module_weights"].get(mode) or cfg["module_weights"]["public"]
    fusion_cfg, labels = cfg["fusion"], cfg["labels"]

    scores: dict[str, float] = {}
    coverage: dict[str, float] = {}
    top: tuple[float, str, dict] | None = None
    for module in applicable:
        run = runs.get(module)
        cov = run["coverage"] if run and run["info"]["status"] in ("ok", "degraded") else 0.0
        coverage[module] = round(cov, 2)
        if cov <= 0:
            continue
        raw, finding = module_score(run["findings"], mode)
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
