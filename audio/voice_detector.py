"""Synthetic-voice detector: a wav2vec 2.0 XLS-R classifier from Hugging Face.

Setup: pip install transformers scipy. The model downloads on first use.

  Gustking/wav2vec2-large-xlsr-deepfake-audio-classification  (Apache-2.0)

Chosen by measurement on 16 human recordings (LibriVox, speeches, spoken articles) and 15
synthetic ones (AI voices, text-to-speech): AUC 0.95, against four other public models and
the SSL-AASIST model used before, which scored neighbouring windows of one genuine reading
at 0.07 and 0.998. This model's raw scores sit low: 0.25 separated the two groups best, so
scores are shifted to put that point at 0.5.

The file is scored in 5-second windows. The file-level score is the median over windows;
runs of consecutive high windows are reported as intervals.
"""

from __future__ import annotations

import math
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import torch
from scipy.io import wavfile

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

MODEL_ID = "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification"
MODEL = None
DEVICE = None

SAMPLE_RATE = 16000
WINDOW = 5 * SAMPLE_RATE
MAX_SECONDS = 900
MAX_WINDOWS = 120
BATCH_SIZE = 8
RAW_DECISION_POINT = 0.25   # raw score that best separated human from synthetic speech
SILENCE_RMS = 0.004
THRESHOLD = 0.5


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID)
    model = AutoModelForAudioClassification.from_pretrained(MODEL_ID).eval().to(DEVICE)
    fake = [i for i, label in model.config.id2label.items() if str(label).lower() in ("fake", "spoof", "synthetic")]
    if len(fake) != 1:
        raise RuntimeError(f"{MODEL_ID}: cannot tell which output means synthetic from labels {model.config.id2label}")
    MODEL = (extractor, model, fake[0])
    return MODEL


def calibrate(raw: float) -> float:
    """Shift the score in logit space so the measured decision point maps to 0.5."""
    raw = min(max(raw, 1e-6), 1 - 1e-6)
    shift = math.log(RAW_DECISION_POINT / (1 - RAW_DECISION_POINT))
    return 1.0 / (1.0 + math.exp(-(math.log(raw / (1 - raw)) - shift)))


def load_audio(path: Path) -> np.ndarray:
    """Mono 16 kHz float audio. ffmpeg handles video containers and compressed formats."""
    with tempfile.TemporaryDirectory(prefix="voice_") as tmp:
        wav = Path(tmp) / "audio16k.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-vn", "-t", str(MAX_SECONDS),
             "-ar", str(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16", str(wav)],
            check=True, capture_output=True, timeout=300,
        )
        _, samples = wavfile.read(str(wav))
    return samples.astype(np.float32) / 32768.0


def analyze(file_path: Path, audio_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    audio = load_audio(audio_path or file_path)
    if len(audio) < SAMPLE_RATE:
        return ModuleResult(module="audio", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="voice", score=0.0, note="no_speech: less than a second of audio")])

    extractor, model, fake_index = load_model()

    # Long recordings: widen the spacing so the work stays bounded.
    stride = max(WINDOW, len(audio) // MAX_WINDOWS)
    starts = [s for s in range(0, max(len(audio) - WINDOW // 2, 1), stride)]
    windows = [(s, audio[s:s + WINDOW]) for s in starts]
    voiced = [(s, w) for s, w in windows if float(np.sqrt(np.mean(w ** 2))) >= SILENCE_RMS]

    findings: list[Finding] = []
    for i in range(0, len(voiced), BATCH_SIZE):
        batch = voiced[i:i + BATCH_SIZE]
        inputs = extractor([w for _, w in batch], sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
        with torch.no_grad():
            probs = torch.softmax(model(**{k: v.to(DEVICE) for k, v in inputs.items()}).logits, dim=-1)[:, fake_index].cpu().tolist()
        for (start, w), raw in zip(batch, probs):
            score = calibrate(float(raw))
            findings.append(Finding(
                model="voice", score=score, start=round(start / SAMPLE_RATE, 2), end=round((start + len(w)) / SAMPLE_RATE, 2),
                note="synthetic_speech_detected" if score >= THRESHOLD else "speech_appears_genuine",
            ))

    if not findings:
        return ModuleResult(module="audio", file_sha256=sha, runtime_s=time.time() - t0,
                            findings=[Finding(model="voice", score=0.0, note="no_speech: the audio is silent")])

    # A stretch of consecutive flagged windows is local evidence the file-level median would hide.
    run: list[Finding] = []
    for f in findings + [None]:
        if f is not None and f.score >= 0.8 and (not run or abs(f.start - run[-1].end) < stride / SAMPLE_RATE):
            run.append(f)
            continue
        if len(run) >= 2:
            findings.append(Finding(model="voice", score=float(np.mean([r.score for r in run])), start=run[0].start, end=run[-1].end,
                                    note=f"synthetic_speech_interval: {len(run)} consecutive windows flagged"))
        run = [f] if f is not None and f.score >= 0.8 else []

    scores = [f.score for f in findings if f.note in ("synthetic_speech_detected", "speech_appears_genuine")]
    findings.append(Finding(
        model="voice", score=float(np.median(scores)),
        note=f"clip_level: median over {len(scores)} five-second windows, {sum(s >= THRESHOLD for s in scores) / len(scores):.0%} flagged",
    ))

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"voice": MODEL_ID},
        runtime_s=time.time() - t0,
    )
