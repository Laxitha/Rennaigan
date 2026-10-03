"""Grad-CAM heatmap generation for SBI EfficientNet-B4.

Overlays at 40% opacity with JET colormap, mapped back onto the full frame.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image


def generate_gradcam_heatmap(
    model: torch.nn.Module,
    input_tensor: torch.Tensor,
    original_frame: np.ndarray,
    face_box: list[int],
    output_path: str,
    target_class: int = 0,
) -> str | None:
    """Generate Grad-CAM heatmap for SBI and overlay on the original frame.

    Args:
        model: SBI EfficientNet-B4 model
        input_tensor: preprocessed face crop tensor (1, 3, 380, 380)
        original_frame: full BGR frame
        face_box: [x, y, w, h] of the face in the frame
        output_path: where to save the heatmap
        target_class: 0 for fake class

    Returns:
        Path to saved heatmap, or None on failure.
    """
    try:
        from pytorch_grad_cam import GradCAM
        from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget

        # Target: last conv layer of EfficientNet (_conv_head)
        target_layer = model._conv_head

        cam = GradCAM(model=model, target_layers=[target_layer])
        targets = [ClassifierOutputTarget(target_class)]

        grayscale_cam = cam(input_tensor=input_tensor, targets=targets)
        grayscale_cam = grayscale_cam[0]

        x, y, w, h = face_box
        heatmap_resized = cv2.resize(grayscale_cam, (w, h))
        heatmap_colored = cv2.applyColorMap(
            (heatmap_resized * 255).astype(np.uint8), cv2.COLORMAP_JET
        )

        overlay = original_frame.copy()
        x1, y1 = max(0, x), max(0, y)
        x2 = min(overlay.shape[1], x + w)
        y2 = min(overlay.shape[0], y + h)

        crop_h = heatmap_colored[:y2 - y1, :x2 - x1]
        region = overlay[y1:y2, x1:x2]
        overlay[y1:y2, x1:x2] = cv2.addWeighted(region, 0.6, crop_h, 0.4, 0)

        cv2.imwrite(output_path, overlay)
        return output_path

    except ImportError:
        return None


def generate_ela(image_path: str, output_path: str, quality: int = 90, scale: int = 15) -> str:
    """Error Level Analysis — re-save JPEG and visualize pixel differences.

    Edited regions often stand out. Supporting view, not a score.
    """
    img = cv2.imread(image_path)
    if img is None:
        return output_path

    tmp = output_path + ".tmp.jpg"
    cv2.imwrite(tmp, img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    resaved = cv2.imread(tmp)

    diff = cv2.absdiff(img, resaved) * scale
    diff = np.clip(diff, 0, 255).astype(np.uint8)

    cv2.imwrite(output_path, diff)
    Path(tmp).unlink(missing_ok=True)
    return output_path
