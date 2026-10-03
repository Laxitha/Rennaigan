"""TruFor — image editing/splicing detector with pixel-level localization.

Setup:
  1. git clone https://github.com/grip-unina/TruFor.git repos/trufor
  2. wget https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip
     unzip so that weights/trufor/trufor.pth.tar exists
  3. pip install yacs timm

Follows the official inference script (repos/trufor/test_docker/src/trufor_test.py):
  - model: models.cmx.builder_np_conf.myEncoderDecoder built from trufor.yaml
  - input: RGB scaled by 1/256
  - forward returns (pred, conf, det, npp); softmax(pred)[1] is the per-pixel forgery
    probability and sigmoid(det) the image-level forgery score
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from common.heat import save_heat
from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256

WEIGHTS_PATH = Path("weights/trufor/trufor.pth.tar")
SRC_PATH = Path("repos/trufor/test_docker/src")
MAX_SIDE = 1600  # larger images are downscaled to fit GPU memory
MODEL = None
DEVICE = None


def load_model():
    global MODEL, DEVICE
    if MODEL is not None:
        return MODEL

    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(
            f"TruFor weights not found at {WEIGHTS_PATH}.\n"
            "Download from: https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip"
        )
    if not SRC_PATH.exists():
        raise FileNotFoundError(
            f"TruFor repo not found at {SRC_PATH}.\n"
            "git clone https://github.com/grip-unina/TruFor.git repos/trufor"
        )

    sys.path.insert(0, str(SRC_PATH.resolve()))
    from config import _C
    from models.cmx.builder_np_conf import myEncoderDecoder

    cfg = _C.clone()
    cfg.merge_from_file(str(SRC_PATH / "trufor.yaml"))
    cfg.freeze()

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = myEncoderDecoder(cfg=cfg)
    checkpoint = torch.load(str(WEIGHTS_PATH), map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["state_dict"])
    MODEL = model.eval().to(DEVICE)
    return MODEL


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    img_bgr = cv2.imread(str(file_path))
    if img_bgr is None:
        return ModuleResult(module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    model = load_model()

    scale = MAX_SIDE / max(img_bgr.shape[:2])
    if scale < 1:
        img_bgr = cv2.resize(img_bgr, (int(img_bgr.shape[1] * scale), int(img_bgr.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    tensor = (torch.from_numpy(rgb.transpose(2, 0, 1)).float() / 256.0).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        pred, conf, det, npp = model(tensor)

    forgery_map = torch.softmax(pred[0], dim=0)[1].cpu().numpy()
    score = float(torch.sigmoid(det).item())

    heatmap_path = save_heat(forgery_map, str(file_path.with_suffix(".trufor_heatmap.png")))

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=[Finding(model="trufor", score=score, note="splicing_editing_detection")],
        artifacts={"trufor_heatmap": heatmap_path},
        weights_sha256={"trufor": weights_sha256(WEIGHTS_PATH)},
        runtime_s=time.time() - t0,
    )
