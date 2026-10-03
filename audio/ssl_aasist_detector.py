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
  - Output: (batch, 2) logits — index 0 = bona fide, index 1 = spoof
  - Score = softmax(output)[:, 1] = P(spoof)
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

XLSR_PATH = Path("weights/xlsr2_300m.pt")
AASIST_PATH = Path("weights/best_SSL_model_DF.pth")
REPO_PATH = Path("repos/ssl_aasist")
MODEL = None
DEVICE = None

SAMPLE_RATE = 16000
WINDOW_SAMPLES = 64600  # ~4.04s, matches repo's cut length
STRIDE_SAMPLES = SAMPLE_RATE * 2  # 2s stride (50% overlap)
MIN_SPEECH_RATIO = 0.5
THRESHOLD = 0.5
SPOOF_INDEX = 1  # output[:, 1] = spoof probability


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
    checkpoint = torch.load(str(AASIST_PATH), map_location=DEVICE)
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
        audio, sr = sf.read(str(target))
        audio = audio.astype(np.float32)
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)  # stereo → mono
        if sr != SAMPLE_RATE:
            import subprocess, tempfile
            tmp_wav = Path(tempfile.mktemp(suffix=".wav"))
            subprocess.run(
                ["ffmpeg", "-i", str(target), "-ar", str(SAMPLE_RATE),
                 "-ac", "1", "-f", "wav", str(tmp_wav), "-y", "-loglevel", "error"],
                check=True,
            )
            audio, sr = sf.read(str(tmp_wav))
            audio = audio.astype(np.float32)
            tmp_wav.unlink(missing_ok=True)
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
    try:
        from audio.vad import get_speech_ratio
        has_vad = True
    except ImportError:
        has_vad = False

    findings: list[Finding] = []
    pos = 0

    while pos < len(audio):
        end = pos + WINDOW_SAMPLES
        chunk = audio[pos:end]

        if len(chunk) < WINDOW_SAMPLES:
            chunk = pad_audio(chunk, WINDOW_SAMPLES)

        start_sec = pos / SAMPLE_RATE
        end_sec = min(end, len(audio)) / SAMPLE_RATE

        # Skip non-speech windows
        if has_vad:
            speech_ratio = get_speech_ratio(chunk, SAMPLE_RATE)
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

        score = score_chunk(model, chunk)

        findings.append(Finding(
            model="ssl_aasist",
            score=score,
            start=start_sec,
            end=end_sec,
            note="synthetic_speech_detected" if score > THRESHOLD else "speech_appears_genuine",
        ))

        pos += STRIDE_SAMPLES

    # Save spectrogram artifact
    spectrogram_path = str(file_path.with_suffix(".spectrogram.png"))
    _save_spectrogram(audio, spectrogram_path)

    return ModuleResult(
        module="audio",
        file_sha256=sha,
        findings=findings,
        artifacts={"spectrogram": spectrogram_path},
        weights_sha256={
            "ssl_aasist": "REPLACE_WITH_SHA256_OF_best_SSL_model_DF.pth",
            "xlsr_300m": "REPLACE_WITH_SHA256_OF_xlsr2_300m.pt",
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
