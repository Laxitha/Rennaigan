"""ECAPA-TDNN — speaker verification via SpeechBrain.

Setup:
  pip install speechbrain

Only applies in KYC mode when a reference recording of the claimed
speaker exists. Compares test audio against reference.
"""

from __future__ import annotations

import time
from pathlib import Path

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

MODEL = None


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    try:
        from speechbrain.inference.speaker import SpeakerRecognition
        MODEL = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="weights/ecapa_cache",
        )
        return MODEL
    except ImportError:
        raise NotImplementedError("pip install speechbrain")


def analyze(file_path: Path, reference_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    if reference_path is None:
        return ModuleResult(
            module="audio",
            file_sha256=sha,
            findings=[Finding(
                model="ecapa",
                score=0.0,
                note="no_reference_audio_provided",
            )],
            runtime_s=time.time() - t0,
        )

    model = load_model()
    score, prediction = model.verify_files(str(reference_path), str(file_path))
    similarity = float(score.item())
    is_same = bool(prediction.item())

    mismatch_score = 1.0 - similarity if not is_same else 0.0

    findings = [Finding(
        model="ecapa",
        score=mismatch_score,
        note=f"speaker_match={is_same}, similarity={similarity:.3f}",
    )]

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        runtime_s=time.time() - t0,
    )
