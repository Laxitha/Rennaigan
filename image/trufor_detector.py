"""TruFor — image editing/splicing detector with localization.

Setup:
  1. git clone https://github.com/grip-unina/TruFor.git repos/trufor
  2. Download weights:
     wget https://www.grip.unina.it/download/prog/TruFor/TruFor_weights.zip
     unzip TruFor_weights.zip -d weights/trufor/
     (main file: weights/trufor/trufor.pth.tar)
  3. cd repos/trufor/TruFor_train_test && pip install -r requirements.txt

Architecture:
  - SegFormer-B2 backbone + Noiseprint++ noise residual
  - Class: EncoderDecoder from lib.models.cmx.builder_np_conf
  - Forward returns (pred, conf, det, npp) tuple
  - pred: 2-class segmentation logits → softmax channel 1 = forgery map
  - det: detection logit → sigmoid = image-level forgery score
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

WEIGHTS_PATH = Path("weights/trufor/trufor.pth.tar")
REPO_PATH = Path("repos/trufor/TruFor_train_test")
CONFIG_PATH = Path("repos/trufor/test_docker/src/trufor.yaml")
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
    if not REPO_PATH.exists():
        raise FileNotFoundError(
            f"TruFor repo not found at {REPO_PATH}.\n"
            "git clone https://github.com/grip-unina/TruFor.git repos/trufor"
        )

    sys.path.insert(0, str(REPO_PATH))

    from lib.utils import get_model
    from lib.config import config, update_config

    cfg_file = str(CONFIG_PATH) if CONFIG_PATH.exists() else None
    if cfg_file:
        update_config(config, cfg_file)

    config.defrost()
    config.TEST.MODEL_FILE = str(WEIGHTS_PATH)
    config.freeze()

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = get_model(config)
    checkpoint = torch.load(str(WEIGHTS_PATH), map_location=DEVICE)
    if "state_dict" in checkpoint:
        model.load_state_dict(checkpoint["state_dict"])
    else:
        model.load_state_dict(checkpoint)

    model.eval()
    model = model.to(DEVICE)
    MODEL = model
    return MODEL


def preprocess_image(img_rgb: np.ndarray) -> torch.Tensor:
    """Convert RGB numpy image to model input tensor. Division by 256, not 255."""
    img = img_rgb.astype(np.float32) / 256.0
    img = img.transpose(2, 0, 1)  # HWC → CHW
    return torch.tensor(img, dtype=torch.float32).unsqueeze(0)


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    img_bgr = cv2.imread(str(file_path))
    if img_bgr is None:
        return ModuleResult(
            module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0,
        )

    try:
        model = load_model()
    except FileNotFoundError as e:
        return ModuleResult(
            module="image", file_sha256=sha,
            findings=[Finding(model="trufor", score=0.0, note=str(e))],
            runtime_s=time.time() - t0,
        )

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    rgb_tensor = preprocess_image(img_rgb).to(DEVICE)

    with torch.no_grad():
        pred, conf, det, npp = model(rgb_tensor)

    forgery_map = torch.softmax(pred, dim=1)[:, 1, :, :].cpu().numpy().squeeze()
    integrity_score = torch.sigmoid(det).item() if det is not None else 0.0

    if forgery_map.shape != img_bgr.shape[:2]:
        forgery_map = cv2.resize(forgery_map, (img_bgr.shape[1], img_bgr.shape[0]))

    heatmap_path = str(file_path.with_suffix(".trufor_heatmap.png"))
    norm_map = ((forgery_map - forgery_map.min()) /
                (forgery_map.max() - forgery_map.min() + 1e-8) * 255)
    heatmap_vis = cv2.applyColorMap(norm_map.astype(np.uint8), cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(img_bgr, 0.6, heatmap_vis, 0.4, 0)
    cv2.imwrite(heatmap_path, overlay)

    findings = [Finding(
        model="trufor",
        score=integrity_score,
        note="splicing_editing_detection",
    )]

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=findings,
        artifacts={"trufor_heatmap": heatmap_path},
        weights_sha256={"trufor": "REPLACE_AFTER_DOWNLOAD"},
        runtime_s=time.time() - t0,
    )
