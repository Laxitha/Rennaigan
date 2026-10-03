"""Identity drift — ArcFace embedding consistency across frames.

Model: InsightFace buffalo_l, 512-d embeddings at 3 fps.
Metric: cosine distance from clip median embedding.
Flag: distance > 0.35 for >= 2 consecutive samples.
KYC mode: cosine similarity < 0.4 to reference photo = identity mismatch.
"""

from __future__ import annotations

import numpy as np

from common.schema import Finding

DRIFT_THRESHOLD = 0.35
MIN_CONSECUTIVE = 2
KYC_SIMILARITY_THRESHOLD = 0.4


def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    if norm < 1e-8:
        return 1.0
    return 1.0 - float(np.dot(a, b) / norm)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return 1.0 - cosine_distance(a, b)


def analyze_identity_drift(
    embeddings: list[np.ndarray | None],
    fps: float = 3.0,
    reference_embedding: np.ndarray | None = None,
) -> list[Finding]:
    """Check identity consistency across frames."""
    valid = [e for e in embeddings if e is not None]
    if len(valid) < 3:
        return []

    median_emb = np.median(np.array(valid), axis=0)
    findings = []

    # Drift from clip's own median
    distances = []
    for i, emb in enumerate(embeddings):
        if emb is None:
            distances.append(None)
        else:
            distances.append(cosine_distance(np.array(emb), median_emb))

    consecutive = 0
    start = None
    for i, d in enumerate(distances):
        if d is not None and d > DRIFT_THRESHOLD:
            if consecutive == 0:
                start = i
            consecutive += 1
        else:
            if consecutive >= MIN_CONSECUTIVE and start is not None:
                findings.append(Finding(
                    model="identity_drift",
                    score=min(float(np.mean([
                        x for x in distances[start:start + consecutive] if x is not None
                    ])), 1.0),
                    start=start / fps,
                    end=(start + consecutive) / fps,
                    note="face_identity_inconsistency",
                ))
            consecutive = 0
            start = None

    if consecutive >= MIN_CONSECUTIVE and start is not None:
        findings.append(Finding(
            model="identity_drift",
            score=min(float(np.mean([
                x for x in distances[start:start + consecutive] if x is not None
            ])), 1.0),
            start=start / fps,
            end=(start + consecutive) / fps,
            note="face_identity_inconsistency",
        ))

    # KYC: compare to reference
    if reference_embedding is not None:
        ref = np.array(reference_embedding)
        sims = [cosine_similarity(np.array(e), ref) for e in valid]
        avg_sim = float(np.mean(sims))
        if avg_sim < KYC_SIMILARITY_THRESHOLD:
            findings.append(Finding(
                model="identity_drift",
                score=1.0 - avg_sim,
                note=f"identity_mismatch_vs_reference, avg_similarity={avg_sim:.3f}",
            ))

    return findings
