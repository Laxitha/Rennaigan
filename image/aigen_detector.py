"""AI-generated image detector: two public classifiers, averaged.

Setup: pip install transformers. The models download from Hugging Face on first use.

  - haywoodsloan/ai-image-detector-deploy  (SwinV2, Apache-2.0)
  - Ateeqq/ai-vs-human-image-detector      (SigLIP, Apache-2.0)

Chosen by measurement (scripts/evaluate.py, 62 real photos and 58 generated images from Stable
Diffusion, DALL-E, ChatGPT, Gemini, Grok, Bing, Firefly and NightCafe): each separates real
from generated with AUC 0.92-0.98, where the previous UnivFD detector fell to chance on the
newer generators. Averaged, they are wrong less often than either alone, because when they
disagree the score lands in the middle and the case is reported as uncertain.

Each model's own preprocessing is used. Score is P(generated).
"""

from __future__ import annotations

import time
from pathlib import Path

import torch
from PIL import Image

from common.schema import Finding, ModuleResult
from common.utils import file_sha256

MODEL_IDS = ["haywoodsloan/ai-image-detector-deploy", "Ateeqq/ai-vs-human-image-detector"]
GENERATED_WORDS = ("artificial", "ai", "fake", "generated", "synthetic")
MODELS = None
DEVICE = None
THRESHOLD = 0.5


def load_model():
    global MODELS, DEVICE
    if MODELS is not None:
        return MODELS

    from transformers import AutoImageProcessor, AutoModelForImageClassification

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    loaded = []
    for model_id in MODEL_IDS:
        processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForImageClassification.from_pretrained(model_id).eval().to(DEVICE)
        generated = [i for i, label in model.config.id2label.items() if label.lower() in GENERATED_WORDS]
        if len(generated) != 1:
            raise RuntimeError(f"{model_id}: cannot tell which output means 'generated' from labels {model.config.id2label}")
        loaded.append((model_id.split("/")[1], processor, model, generated[0]))
    MODELS = loaded
    return MODELS


def score_images(images: list[Image.Image]) -> list[dict]:
    """P(generated) for each image: {"score": mean, "<model>": its own score, ...}."""
    results = [{} for _ in images]
    for name, processor, model, generated in load_model():
        inputs = {k: v.to(DEVICE) for k, v in processor(images=images, return_tensors="pt").items()}
        with torch.no_grad():
            probs = torch.softmax(model(**inputs).logits, dim=-1)[:, generated].cpu().tolist()
        for result, p in zip(results, probs):
            result[name] = float(p)
    for result in results:
        result["score"] = sum(result.values()) / len(result)
    return results


def analyze(file_path: Path) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    try:
        img = Image.open(file_path).convert("RGB")
    except Exception:
        return ModuleResult(module="image", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    result = score_images([img])[0]
    score = result.pop("score")
    parts = ", ".join(f"{name} {p:.2f}" for name, p in result.items())
    agree = all((p >= THRESHOLD) == (score >= THRESHOLD) for p in result.values())

    return ModuleResult(
        module="image",
        file_sha256=sha,
        findings=[Finding(
            model="aigen",
            score=score,
            note=f"ai_generated_detection: {parts}" + ("" if agree else " (the two classifiers disagree)"),
        )],
        weights_sha256={name: model_id for (name, *_), model_id in zip(load_model(), MODEL_IDS)},
        runtime_s=time.time() - t0,
    )
