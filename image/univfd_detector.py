"""UniversalFakeDetect (UnivFD) — AI-generated image detector.

Setup:
  1. pip install open_clip_torch
  2. Download fc_weights.pth → weights/univfd/fc_weights.pth
     (from https://github.com/WisconsinAIVision/UniversalFakeDetect)

Input: whole image, 224x224 center crop, CLIP normalization.
Output: P(fake) per image (sigmoid).
"""

from __future__ import annotations

import time
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/univfd/fc_weights.pth")
MODEL = None
THRESHOLD = 0.5
INPUT_SIZE = 224

CLIP_MEAN = (0.48145466, 0.4578275, 0.40821073)
CLIP_STD = (0.26862954, 0.26130258, 0.27577711)

TRANSFORM = transforms.Compose([
    transforms.Resize(INPUT_SIZE, interpolation=transforms.InterpolationMode.BICUBIC),
    transforms.CenterCrop(INPUT_SIZE),
    transforms.ToTensor(),
    transforms.Normalize(mean=CLIP_MEAN, std=CLIP_STD),
])


def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL

    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"UnivFD weights not found at {WEIGHTS_PATH}.\n"
            "Download fc_weights.pth from the UniversalFakeDetect repo."
        )

    import open_clip

    clip_model, _, _ = open_clip.create_model_and_transforms("ViT-L-14", pretrained="openai")
    clip_model.eval()

    fc = torch.nn.Linear(768, 1)
    fc.load_state_dict(torch.load(str(WEIGHTS_PATH), map_location="cpu"))
    fc.eval()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    clip_model = clip_model.to(device)
    fc = fc.to(device)

    MODEL = (clip_model, fc, device)
    return MODEL


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    try:
        img = Image.open(file_path).convert("RGB")
    except Exception:
        return ModuleResult(module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    clip_model, fc, device = load_model()
    tensor = TRANSFORM(img).unsqueeze(0).to(device)

    with torch.no_grad():
        feat = clip_model.encode_image(tensor)
        score = torch.sigmoid(fc(feat)).item()

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
