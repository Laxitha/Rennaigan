"""SSL-AASIST — wav2vec 2.0 XLS-R 300M + AASIST anti-spoofing.

Setup:
  1. git clone https://github.com/TakHemlata/SSL_Anti-spoofing.git repos/ssl_aasist
  2. Download XLS-R 300M: xlsr2_300m.pt from fairseq wav2vec2 release → weights/xlsr2_300m.pt
  3. Download AASIST checkpoint (DF model for in-the-wild audio) → weights/ssl_aasist.pth
  4. pip install fairseq  (pins old commit + PyTorch from repo README)
  5. This is the TRICKIEST install — do it FIRST in its own env (tf-audio)

Input: 16kHz mono audio
Window: 64,600 samples (~4.04s), stride 2s (50% overlap)
Shorter clips: pad by repeating the audio.
Output: two-class softmax, spoof-class probability = P(fake).
  Check which index is bona fide in the repo code.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

XLSR_PATH = Path("weights/xlsr2_300m.pt")
AASIST_PATH = Path("weights/ssl_aasist.pth")
MODEL = None

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 64600  # ~4.04s
STRIDE_SAMPLES = SAMPLE_RATE * 2  # 2s overlap
MIN_SPEECH_RATIO = 0.5
THRESHOLD = 0.5


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    # TODO: uncomment after installing fairseq + cloning SSL_Anti-spoofing
    # import sys
    # sys.path.insert(0, "repos/ssl_aasist")
    # from model import Model
    # device = "cuda" if torch.cuda.is_available() else "cpu"
    # MODEL = Model(str(XLSR_PATH), str(AASIST_PATH), device=device)
    # MODEL.eval()
    raise NotImplementedError(
        "Clone SSL_Anti-spoofing and install fairseq. See docstring."
    )


def pad_audio(audio: np.ndarray, target_len: int) -> np.ndarray:
    """Pad short audio by repeating it."""
    if len(audio) >= target_len:
        return audio[:target_len]
    repeats = (target_len // len(audio)) + 1
    return np.tile(audio, repeats)[:target_len]


def analyze(file_path: Path, audio_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = audio_path or file_path
    try:
        audio, sr = sf.read(str(target))
        audio = audio.astype(np.float32)
        if sr != SAMPLE_RATE:
            from common.preprocess import preprocess_media
            import tempfile
            work = Path(tempfile.mkdtemp(prefix="tf_audio_"))
            result = preprocess_media(file_path, work)
            audio, sr = sf.read(str(result["audio16k"]))
            audio = audio.astype(np.float32)
    except Exception as e:
        return ModuleResult(
            module="audio", file_sha256=sha,
            findings=[Finding(model="ssl_aasist", score=0.0, note=f"audio_load_error: {e}")],
            runtime_s=time.time() - t0,
        )

    model = load_model()

    from audio.vad import get_speech_ratio

    findings: list[Finding] = []
    pos = 0

    while pos < len(audio):
        end = pos + WINDOW_SAMPLES
        chunk = audio[pos:end]

        if len(chunk) < WINDOW_SAMPLES:
            chunk = pad_audio(chunk, WINDOW_SAMPLES)

        speech_ratio = get_speech_ratio(chunk, SAMPLE_RATE)
        start_sec = pos / SAMPLE_RATE
        end_sec = min(end, len(audio)) / SAMPLE_RATE

        if speech_ratio < MIN_SPEECH_RATIO:
            findings.append(Finding(
                model="ssl_aasist",
                score=0.0,
                start=start_sec,
                end=end_sec,
                note=f"no_speech (ratio={speech_ratio:.2f})",
            ))
            pos += STRIDE_SAMPLES
            continue

        # TODO: run inference
        # tensor = torch.from_numpy(chunk).unsqueeze(0).to(device)
        # with torch.no_grad():
        #     output = model(tensor)
        #     probs = torch.softmax(output, dim=-1)
        #     # Check repo code for which index is spoof
        #     score = probs[0, SPOOF_INDEX].item()
        score = 0.0  # placeholder

        if score > THRESHOLD:
            findings.append(Finding(
                model="ssl_aasist",
                score=score,
                start=start_sec,
                end=end_sec,
                note="synthetic_speech_detected",
            ))

        pos += STRIDE_SAMPLES

    # Save spectrogram
    spectrogram_path = str(file_path.with_suffix(".spectrogram.png"))
    _save_spectrogram(audio, spectrogram_path)

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        artifacts={"spectrogram": spectrogram_path},
        weights_sha256={"ssl_aasist": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )


def _save_spectrogram(audio: np.ndarray, output_path: str):
    """Mel spectrogram: n_fft=512, win=400 (25ms), hop=160 (10ms), 80 mels."""
    try:
        import librosa
        import librosa.display
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        S = librosa.feature.melspectrogram(
            y=audio, sr=SAMPLE_RATE, n_fft=512,
            win_length=400, hop_length=160, n_mels=80,
        )
        S_dB = librosa.power_to_db(S, ref=np.max)

        fig, ax = plt.subplots(1, 1, figsize=(10, 4))
        librosa.display.specshow(S_dB, sr=SAMPLE_RATE, hop_length=160,
                                 x_axis="time", y_axis="mel", ax=ax)
        ax.set_title("Mel Spectrogram")
        plt.colorbar(ax.collections[0], ax=ax, format="%+2.0f dB")
        plt.tight_layout()
        plt.savefig(output_path, dpi=100)
        plt.close()
    except ImportError:
        pass
