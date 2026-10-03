"""Gateway configuration: config.yaml merged over defaults, then environment overrides."""

from __future__ import annotations

import copy
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent

MODULES = ["image", "video", "audio", "metadata", "motion"]

MODULE_DETECTORS = {
    "image": ["sbi", "univfd", "trufor"],
    "video": ["frame_scorer", "lipforensics", "syncnet"],
    "audio": ["ssl_aasist", "ecapa"],
    "metadata": ["exiftool", "ffprobe", "c2patool"],
    "motion": ["optical_flow", "head_pose", "smoothness", "identity_drift", "blink"],
}

MODULES_FOR_MEDIA = {
    "image": ["image", "metadata"],
    "screenshot": ["image", "metadata"],
    "video": ["video", "audio", "motion", "metadata"],
    "audio": ["audio", "metadata"],
}

DEFAULTS = {
    "gateway": {
        "host": "127.0.0.1",
        "port": 8010,
        "data_dir": "data",
        "keep_media": True,
        "max_concurrent_analyses": 2,
        "module_timeout_s": 600,
        "inprocess_fallback": True,
        "max_bulk_files": 20,
        # Extra browser origins allowed to call the gateway, besides local addresses.
        "cors_origins": [],
    },
    "services": {
        "image": {"url": "http://127.0.0.1:8001"},
        "video": {"url": "http://127.0.0.1:8002"},
        "audio": {"url": "http://127.0.0.1:8003"},
        "metadata": {"url": "http://127.0.0.1:8004"},
        "motion": {"url": "http://127.0.0.1:8005"},
    },
    "preprocessing": {"max_upload_mb": 100},
    "thresholds": {},
    "temperatures": {},
    "module_weights": {
        "public": {"image": 0.35, "audio": 0.25, "motion": 0.15, "video": 0.15, "metadata": 0.10},
        "identity": {"image": 0.25, "audio": 0.10, "motion": 0.20, "video": 0.35, "metadata": 0.10},
    },
    "fusion": {
        "strong_signal_cap": 0.9,
        "strong_signal_max_trust": 30,
        "inconclusive_coverage_threshold": 0.5,
        "signal_floor": 0.3,
    },
    "labels": {"low_risk": [70, 100], "review": [40, 69], "high_manipulation": [0, 39]},
    "weights_sha256": {},
}


def _merge(base: dict, over: dict) -> dict:
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        elif value is not None:
            base[key] = value
    return base


def load(path: Path | None = None) -> dict:
    cfg = copy.deepcopy(DEFAULTS)
    path = path or Path(os.environ.get("RENNAIGAN_CONFIG", ROOT / "config.yaml"))
    if path.exists():
        with open(path) as f:
            _merge(cfg, yaml.safe_load(f) or {})

    env = os.environ
    for module in MODULES:
        if env.get(f"{module.upper()}_URL"):
            cfg["services"][module]["url"] = env[f"{module.upper()}_URL"].rstrip("/")
    if env.get("RENNAIGAN_DATA_DIR"):
        cfg["gateway"]["data_dir"] = env["RENNAIGAN_DATA_DIR"]
    if env.get("RENNAIGAN_PORT"):
        cfg["gateway"]["port"] = int(env["RENNAIGAN_PORT"])
    if env.get("RENNAIGAN_CORS_ORIGINS"):
        cfg["gateway"]["cors_origins"] = [o.strip() for o in env["RENNAIGAN_CORS_ORIGINS"].split(",") if o.strip()]

    data_dir = Path(cfg["gateway"]["data_dir"])
    cfg["gateway"]["data_dir"] = str(data_dir if data_dir.is_absolute() else ROOT / data_dir)
    return cfg
