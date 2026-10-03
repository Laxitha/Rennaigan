"""SSL-AASIST — wav2vec 2.0 XLS-R 300M + AASIST anti-spoofing.

Setup:
  1. Create dedicated env (this has the most fragile deps):
       conda create -n tf-audio python=3.7 -y
       conda activate tf-audio

  2. Install pinned PyTorch:
       pip install torch==1.8.1+cu111 torchvision==0.9.1+cu111 torchaudio==0.8.1 \
         -f https://download.pytorch.org/whl/torch_stable.html

  3. Clone repo:
       git clone https://github.com/TakHemlata/SSL_Anti-spoofing.git repos/ssl_aasist

  4. Install fairseq (MUST use the bundled commit):
       cd repos/ssl_aasist/fairseq-a54021305d6b3c4c5959ac9395135f63202db8f1
       pip install --editable ./
       cd ../../..

  5. Download XLS-R 300M checkpoint:
       # From https://github.com/pytorch/fairseq/tree/main/examples/wav2vec/xlsr
       # Direct: https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt
       wget -P weights/ https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt

  6. Download pretrained AASIST model (use DF model for in-the-wild audio):
       # From https://drive.google.com/drive/folders/1c4ywztEVlYVijfwbGLl9OEa1SNtFKppB
       # Download best_SSL_model_DF.pth → weights/best_SSL_model_DF.pth

  7. Install remaining deps:
       pip install soundfile librosa matplotlib pydantic fastapi uvicorn numpy

Architecture:
  - SSLModel loads xlsr2_300m.pt via fairseq, extracts 1024-d embeddings
  - AASIST graph attention network classifies embeddings
  - Input: (batch, 64600) raw audio at 16kHz
  - Output: (batch, 2) logits — index 0 = spoof, index 1 = bona fide
  - Score = softmax(output)[:, 0] = P(spoof)
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Services run headless; an inherited notebook backend (MPLBACKEND) would break matplotlib.
os.environ["MPLBACKEND"] = "Agg"

import numpy as np
import soundfile as sf
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256

XLSR_PATH = Path("weights/xlsr2_300m.pt")
AASIST_PATH = Path("weights/best_SSL_model_DF.pth")
REPO_PATH = Path("repos/ssl_aasist")
MODEL = None
DEVICE = None

SAMPLE_RATE = 16000
MAX_SECONDS = 900
MAX_WINDOWS = 150
BATCH_SIZE = 8
WINDOW_SAMPLES = 64600  # ~4.04s, matches repo's cut length
STRIDE_SAMPLES = SAMPLE_RATE * 2  # 2s stride (50% overlap)
MIN_SPEECH_RATIO = 0.5
THRESHOLD = 0.5
# The repo labels bonafide as 1 and spoof as 0 (data_utils_SSL.py) and scores with output[:, 1].
SPOOF_INDEX = 0


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    if not REPO_PATH.exists():
        raise NotImplementedError(
            f"Clone SSL_Anti-spoofing to {REPO_PATH}:\n"
            "  git clone https://github.com/TakHemlata/SSL_Anti-spoofing.git repos/ssl_aasist"
        )
    if not XLSR_PATH.exists():
        raise NotImplementedError(
            f"Download XLS-R 300M to {XLSR_PATH}:\n"
            "  wget -P weights/ https://dl.fbaipublicfiles.com/fairseq/wav2vec/xlsr2_300m.pt"
        )
    if not AASIST_PATH.exists():
        raise NotImplementedError(
            f"Download AASIST DF model to {AASIST_PATH}:\n"
            "  See Google Drive link in the repo README"
        )

    # model.py loads the XLS-R checkpoint by bare file name from the working directory.
    link = Path("xlsr2_300m.pt")
    if not link.exists():
        link.symlink_to(XLSR_PATH.resolve())

    sys.path.insert(0, str(REPO_PATH))
    from model import Model

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    # The Model class expects an args object with a few attributes
    class Args:
        pass
    args = Args()

    model = Model(args, DEVICE)
    model = model.to(DEVICE)

    # Load pretrained weights
    checkpoint = torch.load(str(AASIST_PATH), map_location=DEVICE, weights_only=False)
    if "model_state_dict" in checkpoint:
        model.load_state_dict(checkpoint["model_state_dict"])
    elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
        model.load_state_dict(checkpoint["state_dict"])
    else:
        # Try loading directly (might be just the state dict)
        try:
            model.load_state_dict(checkpoint)
        except Exception:
            # Wrapped in DataParallel during training — strip "module." prefix
            state = {k.replace("module.", ""): v for k, v in checkpoint.items()}
            model.load_state_dict(state)

    model.eval()
    MODEL = model
    return MODEL


def pad_audio(audio: np.ndarray, target_len: int) -> np.ndarray:
    """Pad short audio by tiling (repeating), matching repo behavior."""
    if len(audio) >= target_len:
        return audio[:target_len]
    repeats = (target_len // len(audio)) + 1
    return np.tile(audio, repeats)[:target_len]


def score_chunk(model, chunk: np.ndarray) -> float:
    """Run inference on a single 64600-sample chunk. Returns P(spoof)."""
    tensor = torch.from_numpy(chunk).float().unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        output = model(tensor)
        probs = torch.softmax(output, dim=-1)
        return probs[0, SPOOF_INDEX].item()


def analyze(file_path: Path, audio_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    # Load audio
    target = audio_path or file_path
    try:
        # Decode through ffmpeg: handles video containers and compressed audio, and resamples.
        with tempfile.TemporaryDirectory(prefix="aasist_") as tmp:
            wav = Path(tmp) / "audio16k.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(target), "-vn", "-t", str(MAX_SECONDS),
                 "-ar", str(SAMPLE_RATE), "-ac", "1", "-sample_fmt", "s16", str(wav)],
                check=True, capture_output=True, timeout=300,
            )
            audio, sr = sf.read(str(wav), dtype="float32")
        if len(audio) < SAMPLE_RATE // 2:
            raise ValueError("less than half a second of audio")
    except Exception as e:
        return ModuleResult(
            module="audio", file_sha256=sha,
            findings=[Finding(model="ssl_aasist", score=0.0, note=f"audio_load_error: {e}")],
            runtime_s=time.time() - t0,
        )

    # Load model
    try:
        model = load_model()
    except NotImplementedError as e:
        return ModuleResult(
            module="audio", file_sha256=sha,
            findings=[Finding(model="ssl_aasist", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    # VAD filtering
    # Without a working VAD every window is scored, silence included.
    try:
        from audio.vad import get_speech_ratio
        get_speech_ratio(audio[:WINDOW_SAMPLES], SAMPLE_RATE)
        has_vad = True
    except Exception:
        has_vad = False

    # Window positions. Long recordings widen the stride so the work stays bounded.
    stride = max(STRIDE_SAMPLES, len(audio) // MAX_WINDOWS)
    positions = list(range(0, max(len(audio) - WINDOW_SAMPLES // 2, 1), stride))

    findings: list[Finding] = []
    pending: list[tuple[int, np.ndarray]] = []

    def flush():
        """Score the queued speech windows in one batch."""
        if not pending:
            return
        batch = torch.from_numpy(np.stack([c for _, c in pending])).float().to(DEVICE)
        with torch.no_grad():
            probs = torch.softmax(model(batch), dim=-1)[:, SPOOF_INDEX].cpu().tolist()
        for (pos, _), score in zip(pending, probs):
            findings.append(Finding(
                model="ssl_aasist", score=float(score),
                start=pos / SAMPLE_RATE, end=min(pos + WINDOW_SAMPLES, len(audio)) / SAMPLE_RATE,
                note="synthetic_speech_detected" if score > THRESHOLD else "speech_appears_genuine",
            ))
        pending.clear()

    for pos in positions:
        chunk = audio[pos:pos + WINDOW_SAMPLES]
        if len(chunk) < WINDOW_SAMPLES:
            chunk = pad_audio(chunk, WINDOW_SAMPLES)
        if has_vad:
            speech_ratio = get_speech_ratio(chunk, SAMPLE_RATE)
            if speech_ratio < MIN_SPEECH_RATIO:
                findings.append(Finding(
                    model="ssl_aasist", score=0.0,
                    start=pos / SAMPLE_RATE, end=min(pos + WINDOW_SAMPLES, len(audio)) / SAMPLE_RATE,
                    note=f"no_speech (ratio={speech_ratio:.2f})",
                ))
                continue
        pending.append((pos, chunk))
        if len(pending) == BATCH_SIZE:
            flush()
    flush()
    findings.sort(key=lambda f: f.start)

    scored = [f for f in findings if not f.note.startswith("no_speech")]
    if scored:
        run: list[Finding] = []
        for f in scored + [None]:
            if f is not None and f.score >= 0.8:
                run.append(f)
                continue
            if len(run) >= 2:
                findings.append(Finding(model="ssl_aasist", score=float(np.mean([r.score for r in run])), start=run[0].start,
                                        end=run[-1].end, note=f"synthetic_speech_interval: {len(run)} consecutive windows flagged"))
            run = []
        values = [f.score for f in scored]
        findings.append(Finding(
            model="ssl_aasist", score=float(np.median(values)),
            note=f"clip_level: median over {len(values)} speech windows, {sum(v > THRESHOLD for v in values) / len(values):.0%} flagged",
        ))
    else:
        findings.append(Finding(model="ssl_aasist", score=0.0, note="no_speech: no window contained enough speech to score"))

    # Save spectrogram artifact
    spectrogram_path = str(file_path.with_suffix(".spectrogram.png"))
    _save_spectrogram(audio, spectrogram_path)

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        artifacts={"spectrogram": spectrogram_path},
        weights_sha256={
            "ssl_aasist": weights_sha256(AASIST_PATH),
            "xlsr_300m": weights_sha256(XLSR_PATH),
        },
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
