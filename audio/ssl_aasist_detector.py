"""SSL-AASIST — wav2vec 2.0 XLS-R + AASIST anti-spoofing detector.

Setup:
  1. git clone https://github.com/TakHemlata/SSL_Anti-spoofing.git repos/ssl_aasist
  2. Download XLS-R 300M: https://huggingface.co/facebook/wav2vec2-xls-r-300m
     → weights/xlsr_300m.pt
  3. Download AASIST head weights → weights/ssl_aasist.pth
  4. pip install fairseq  (needs specific version — use dedicated env)
  5. This is the trickiest install — do it FIRST

Audio is scored in ~4-second windows, each becoming a timed finding.
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

XLSR_PATH = Path("weights/xlsr_300m.pt")
AASIST_PATH = Path("weights/ssl_aasist.pth")
MODEL = None

WINDOW_SEC = 4.0
STRIDE_SEC = 2.0
SAMPLE_RATE = 16000


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: Replace with actual SSL-AASIST loading
    # import sys
    # sys.path.insert(0, "repos/ssl_aasist")
    # from model import Model
    # MODEL = Model(XLSR_PATH, AASIST_PATH, device="cpu")
    # MODEL.eval()
    raise NotImplementedError(
        "Clone SSL_Anti-spoofing repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def extract_audio_16k(file_path: Path) -> Path:
    """Extract audio as 16kHz mono WAV."""
    out = Path(tempfile.mktemp(suffix=".wav"))
    subprocess.run(
        ["ffmpeg", "-i", str(file_path), "-ar", "16000", "-ac", "1",
         "-f", "wav", str(out), "-y", "-loglevel", "error"],
        check=True,
    )
    return out


def load_audio(wav_path: Path) -> np.ndarray:
    import soundfile as sf
    audio, sr = sf.read(str(wav_path))
    if sr != SAMPLE_RATE:
        raise ValueError(f"Expected {SAMPLE_RATE}Hz, got {sr}Hz")
    return audio.astype(np.float32)


def save_spectrogram(audio: np.ndarray, output_path: str):
    """Save mel spectrogram as PNG artifact."""
    try:
        import librosa
        import librosa.display
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        S = librosa.feature.melspectrogram(y=audio, sr=SAMPLE_RATE, n_mels=128)
        S_dB = librosa.power_to_db(S, ref=np.max)

        fig, ax = plt.subplots(1, 1, figsize=(10, 4))
        librosa.display.specshow(S_dB, sr=SAMPLE_RATE, x_axis="time",
                                 y_axis="mel", ax=ax)
        ax.set_title("Mel Spectrogram")
        plt.colorbar(ax.collections[0], ax=ax, format="%+2.0f dB")
        plt.tight_layout()
        plt.savefig(output_path, dpi=100)
        plt.close()
    except ImportError:
        pass


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    wav_path = extract_audio_16k(file_path)
    try:
        audio = load_audio(wav_path)
    except Exception as e:
        return ModuleResult(
            module="audio", file_sha256=sha,
            findings=[Finding(model="ssl_aasist", score=0.0, note=f"audio_error: {e}")],
            runtime_s=time.time() - t0,
        )

    model = load_model()

    total_samples = len(audio)
    window_samples = int(WINDOW_SEC * SAMPLE_RATE)
    stride_samples = int(STRIDE_SEC * SAMPLE_RATE)

    findings: list[Finding] = []
    pos = 0

    while pos + window_samples <= total_samples:
        chunk = audio[pos : pos + window_samples]

        # TODO: run inference
        # import torch
        # tensor = torch.from_numpy(chunk).unsqueeze(0)
        # with torch.no_grad():
        #     score = torch.sigmoid(model(tensor)).item()
        score = 0.0  # placeholder

        start_sec = pos / SAMPLE_RATE
        end_sec = (pos + window_samples) / SAMPLE_RATE

        if score > 0.3:
            findings.append(Finding(
                model="ssl_aasist",
                score=score,
                start=start_sec,
                end=end_sec,
                note="synthetic_speech_detection",
            ))

        pos += stride_samples

    spectrogram_path = str(file_path.with_suffix(".spectrogram.png"))
    save_spectrogram(audio, spectrogram_path)

    wav_path.unlink(missing_ok=True)

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        artifacts={"spectrogram": spectrogram_path},
        weights_sha256={"ssl_aasist": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
