"""Voice Activity Detection using Silero VAD.

Filters audio windows — only score windows with >= 50% speech.
"""

from __future__ import annotations

import torch
import numpy as np

VAD_MODEL = None
VAD_UTILS = None
SPEECH_THRESHOLD = 0.5


def load_vad():
    global VAD_MODEL, VAD_UTILS
    if VAD_MODEL is not None:
        return VAD_MODEL, VAD_UTILS
    VAD_MODEL, VAD_UTILS = torch.hub.load(
        "snakers4/silero-vad", "silero_vad", trust_repo=True
    )
    return VAD_MODEL, VAD_UTILS


def get_speech_ratio(audio_chunk: np.ndarray, sample_rate: int = 16000) -> float:
    """Return fraction of the chunk that is speech (0.0 to 1.0)."""
    model, utils = load_vad()
    get_speech_timestamps = utils[0]

    tensor = torch.from_numpy(audio_chunk).float()
    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)

    timestamps = get_speech_timestamps(
        tensor.squeeze(), model, sampling_rate=sample_rate, threshold=SPEECH_THRESHOLD
    )

    if not timestamps:
        return 0.0

    speech_samples = sum(ts["end"] - ts["start"] for ts in timestamps)
    return speech_samples / len(audio_chunk)
