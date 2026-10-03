"""UniversalFakeDetect (UnivFD) — AI-generated image detector wrapper.

Setup:
  1. git clone https://github.com/WisconsinAIVision/UniversalFakeDetect.git repos/univfd
  2. Download weights: CLIP ViT-L/14 + linear head → weights/univfd.pth
  3. pip install open_clip_torch
"""

from __future__ import annotations

import time
from pathlib import Path

import torch
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/univfd.pth")
MODEL = None
PREPROCESS = None


def load_model():
    global MODEL, PREPROCESS
    if MODEL is not None:
        return MODEL, PREPROCESS

    # TODO: Replace with actual UnivFD loading
    # import open_clip
    # clip_model, _, preprocess = open_clip.create_model_and_transforms(
    #     "ViT-L-14", pretrained="openai"
    # )
    # fc = torch.nn.Linear(768, 1)
    # fc.load_state_dict(torch.load(WEIGHTS_PATH, map_location="cpu"))
    # MODEL = (clip_model, fc)
    # PREPROCESS = preprocess
    raise NotImplementedError(
        "Clone UnivFD repo and uncomment model loading. "
        "See docstring for setup steps."
    )


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    try:
        img = Image.open(file_path).convert("RGB")
    except Exception:
        return ModuleResult(
            module="image",
            file_sha256=sha,
            findings=[],
            runtime_s=time.time() - t0,
        )

    clip_model, fc = load_model()[0]
    preprocess = load_model()[1]

    # TODO: run inference
    # tensor = preprocess(img).unsqueeze(0)
    # with torch.no_grad():
    #     feat = clip_model.encode_image(tensor)
    #     score = torch.sigmoid(fc(feat)).item()
    score = 0.0  # placeholder

    findings = [Finding(
        model="univfd",
        score=score,
        note="ai_generated_detection",
    )]

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"univfd": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
