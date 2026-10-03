#!/usr/bin/env python3
"""Measure the pipeline on files whose truth is known, and suggest thresholds.

    python scripts/evaluate.py --gateway http://127.0.0.1:8010 --real samples/real --fake samples/fake

Every file in the two folders is analysed through the gateway. The report shows how often the
final verdict is right, and for each detector how well its score separates real from fake
(AUC: 0.5 is chance, 1.0 is perfect) and the threshold that separates them best on this set.
With few files these numbers are rough: treat a threshold from fewer than about 30 files per
class as a hint, not a setting.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.fusion import _model_score  # noqa: E402
from backend.media import ALLOWED_EXT  # noqa: E402


def analyse(client: httpx.Client, gateway: str, path: Path) -> dict | None:
    with open(path, "rb") as f:
        res = client.post(f"{gateway}/analyze", files={"file": (path.name, f)}, timeout=1800)
    try:
        case = res.json()
    except ValueError:
        case = {}
    if "id" not in case:
        print(f"  failed  {path.name}: HTTP {res.status_code} {str(case.get('detail', res.text))[:120]}")
        return None
    return case


def detector_scores(case: dict) -> dict[str, float]:
    groups = defaultdict(list)
    for f in case["findings"]:
        if f["kind"] != "error" and not (f["score"] == 0 and f["note"].startswith("no_")):
            groups[f"{f['module']}/{f['model']}"].append(f)
    return {name: _model_score(fs)[0] for name, fs in groups.items()}


def auc(real: list[float], fake: list[float]) -> float:
    """Probability that a random fake scores above a random real file."""
    wins = sum((f > r) + 0.5 * (f == r) for f in fake for r in real)
    return wins / (len(real) * len(fake))


def best_threshold(real: list[float], fake: list[float]) -> tuple[float, float]:
    """Threshold with the highest balanced accuracy, and that accuracy."""
    best = (0.5, 0.0)
    for t in sorted(set(real + fake)):
        balanced = (np.mean([f >= t for f in fake]) + np.mean([r < t for r in real])) / 2
        if balanced > best[1]:
            best = (float(t), float(balanced))
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gateway", default="http://127.0.0.1:8010")
    parser.add_argument("--real", type=Path, required=True, help="folder of genuine files")
    parser.add_argument("--fake", type=Path, required=True, help="folder of manipulated or generated files")
    parser.add_argument("--out", type=Path, default=Path("evaluation.json"))
    args = parser.parse_args()
    gateway = args.gateway.rstrip("/")

    rows = []
    with httpx.Client() as client:
        for truth, folder in (("real", args.real), ("fake", args.fake)):
            for path in sorted(p for p in folder.rglob("*") if p.suffix.lower().lstrip(".") in ALLOWED_EXT):
                case = analyse(client, gateway, path)
                if case is None:
                    continue
                # A gateway from before verdicts existed only has the label.
                verdict = case.get("verdict") or {
                    "verdict": {"Low risk": "real", "High manipulation indicators": "deepfake"}.get(case["label"], "uncertain"),
                    "confidence": 0, "source": "label"}
                rows.append({"file": path.name, "truth": truth, "media": case["media"]["media_type"], "case": case["id"],
                             "verdict": verdict["verdict"], "confidence": verdict["confidence"], "source": verdict["source"],
                             "trust": case["trust_score"], "evidence": case["evidence_weight"], "runtime_s": case["runtime_s"],
                             "detectors": detector_scores(case)})
                print(f"  {truth:<4} {path.name[:38]:<38} -> {verdict['verdict']:<9} {verdict['confidence']:>3}%  trust {case['trust_score']}  {case['runtime_s']:.0f} s")

    if not rows:
        sys.exit("No file could be analysed.")
    print(f"\n=== Verdicts ({len(rows)} files)")
    correct = decided = 0
    for truth, right in (("real", "real"), ("fake", "deepfake")):
        mine = [r for r in rows if r["truth"] == truth]
        counts = {v: sum(r["verdict"] == v for r in mine) for v in ("real", "deepfake", "uncertain")}
        correct += counts[right]
        decided += counts["real"] + counts["deepfake"]
        print(f"  truly {truth:<4} ({len(mine)}): called real {counts['real']}, deepfake {counts['deepfake']}, uncertain {counts['uncertain']}")
    print(f"  correct: {correct}/{len(rows)} of all files, {correct}/{decided} of the files given a firm verdict")

    print("\n=== Detectors (score on real vs fake files)")
    names = sorted({n for r in rows for n in r["detectors"]})
    summary = {}
    for name in names:
        real = [r["detectors"][name] for r in rows if r["truth"] == "real" and name in r["detectors"]]
        fake = [r["detectors"][name] for r in rows if r["truth"] == "fake" and name in r["detectors"]]
        if not real or not fake:
            print(f"  {name:<24} only seen on one class (real {len(real)}, fake {len(fake)})")
            continue
        threshold, balanced = best_threshold(real, fake)
        summary[name] = {"auc": round(auc(real, fake), 3), "threshold": round(threshold, 3), "balanced_accuracy": round(balanced, 3),
                         "n_real": len(real), "n_fake": len(fake)}
        print(f"  {name:<24} AUC {summary[name]['auc']:.2f}  real median {np.median(real):.2f}  fake median {np.median(fake):.2f}"
              f"  best threshold {threshold:.2f} ({balanced:.0%} balanced accuracy)  n={len(real)}+{len(fake)}")

    args.out.write_text(json.dumps({"files": rows, "detectors": summary}, indent=1))
    print(f"\nFull results written to {args.out}")


if __name__ == "__main__":
    main()
