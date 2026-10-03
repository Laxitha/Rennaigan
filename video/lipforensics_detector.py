"""LipForensics — detects forged faces from mouth-motion irregularities.

Setup:
  1. git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics
  2. Download lipforensics_ff.pth (link in its README) to weights/lipforensics_ff.pth
  3. pip install face_alignment scikit-image

Follows the official pipeline:
  - preprocessing/crop_mouths.py: 68-point landmarks, smoothed over 12 frames, each frame
    similarity-warped to the mean face at 256x256, 96x96 mouth crop
  - evaluate.py: 25-frame grayscale clips at 25 fps, centre-cropped to 88x88,
    normalized with mean 0.421 / std 0.165; sigmoid(logit) is P(fake)
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
import torch

from common.face import detect_faces_yunet
from common.repo_import import repo_modules
from common.schema import Finding, ModuleResult
from common.utils import file_sha256, weights_sha256

REPO_PATH = Path("repos/lipforensics")
WEIGHTS_CANDIDATES = [Path("weights/lipforensics_ff.pth"), REPO_PATH / "models/weights/lipforensics_ff.pth"]
MODEL = None
DEVICE = None
LANDMARKER = None
MEAN_FACE = None
PREPROCESS = None  # (apply_transform, cut_patch, warp_img) from the repository

FPS = 25
CLIP_LENGTH = 25
MAX_SECONDS = 60
STD_SIZE = (256, 256)
STABLE_POINTS = [33, 36, 39, 42, 45]
MOUTH = slice(48, 68)
CROP = 96
INPUT = 88
WINDOW_MARGIN = 12
GRAY_MEAN, GRAY_STD = 0.421, 0.165
THRESHOLD = 0.5


def _weights_path() -> Path:
    for path in WEIGHTS_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError(f"LipForensics weights not found. Download lipforensics_ff.pth to {WEIGHTS_CANDIDATES[0]}")


def load_model():
    global MODEL, DEVICE, LANDMARKER, MEAN_FACE
    if MODEL is not None:
        return MODEL

    weights = _weights_path()
    if not REPO_PATH.exists():
        raise FileNotFoundError(
            f"LipForensics repo not found at {REPO_PATH}.\n"
            "git clone https://github.com/ahaliassos/LipForensics.git repos/lipforensics"
        )

    import face_alignment

    global PREPROCESS
    with repo_modules(REPO_PATH, "models", "preprocessing"):
        from models.spatiotemporal_net import Lipreading
        from preprocessing.utils import apply_transform, cut_patch, warp_img
    PREPROCESS = (apply_transform, cut_patch, warp_img)

    # Built here rather than through the repo's get_model(), which assumes its own working
    # directory and a CUDA device.
    cfg = json.loads((REPO_PATH / "models/configs/lrw_resnet18_mstcn.json").read_text())
    tcn_options = {
        "num_layers": cfg["tcn_num_layers"], "kernel_size": cfg["tcn_kernel_size"], "dropout": cfg["tcn_dropout"],
        "dwpw": cfg["tcn_dwpw"], "width_mult": cfg["tcn_width_mult"],
    }
    model = Lipreading(num_classes=1, tcn_options=tcn_options, relu_type=cfg["relu_type"])
    model.load_state_dict(torch.load(str(weights), map_location="cpu", weights_only=False)["model"])

    DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    LANDMARKER = face_alignment.FaceAlignment(face_alignment.LandmarksType.TWO_D, device=DEVICE.type, flip_input=False)
    MEAN_FACE = np.load(REPO_PATH / "preprocessing/20words_mean_face.npy")
    MODEL = model.eval().to(DEVICE)
    return MODEL


def _landmarks(frame_rgb: np.ndarray) -> np.ndarray | None:
    """68 landmarks of the largest face.

    The face box comes from YuNet, which runs in a few milliseconds; the landmark network then
    only has to look at that box. face_alignment's own S3FD detector on every frame was the
    slowest step of the whole pipeline.
    """
    faces = detect_faces_yunet(cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))
    if not faces:
        return None
    x, y, w, h = max(faces, key=lambda f: f["box"][2] * f["box"][3])["box"]
    found = LANDMARKER.get_landmarks_from_image(frame_rgb, detected_faces=[[x, y, x + w, y + h]])
    return found[0][:, :2] if found else None


class _RunCropper:
    """Mouth crops for one uninterrupted run of frames, as in preprocessing/crop_mouths.py.

    Landmarks are averaged over WINDOW_MARGIN frames before estimating the alignment, so only
    that many frames are held in memory at a time.
    """

    def __init__(self):
        self._apply, self._cut, self._warp = PREPROCESS
        self.frames: deque = deque()
        self.landmarks: deque = deque()
        self.trans = None
        self.crops: list[np.ndarray] = []

    def _patch(self, aligned: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        patch = self._cut(aligned, self.trans(landmarks)[MOUTH], CROP // 2, CROP // 2)
        return cv2.cvtColor(patch.astype(np.uint8), cv2.COLOR_RGB2GRAY)

    def push(self, frame_rgb: np.ndarray, landmarks: np.ndarray) -> None:
        self.frames.append(frame_rgb)
        self.landmarks.append(landmarks)
        if len(self.frames) == WINDOW_MARGIN:
            smoothed = np.mean(list(self.landmarks), axis=0)
            frame, current = self.frames.popleft(), self.landmarks.popleft()
            aligned, self.trans = self._warp(smoothed[STABLE_POINTS], MEAN_FACE[STABLE_POINTS], frame, STD_SIZE)
            self.crops.append(self._patch(aligned, current))

    def finish(self) -> list[np.ndarray]:
        """Crop the frames still queued with the last alignment, and return the whole run."""
        while self.frames and self.trans is not None:
            frame, current = self.frames.popleft(), self.landmarks.popleft()
            self.crops.append(self._patch(self._apply(self.trans, frame, STD_SIZE), current))
        return self.crops


def extract_mouth_segments(video25: Path, breaks: frozenset[int] = frozenset()) -> list[tuple[int, np.ndarray]]:
    """Aligned 96x96 grayscale mouth crops, as runs of consecutive frames with a visible face.

    Returns [(first_frame_index, array of shape (n, 96, 96))] for runs of at least one clip.
    """
    segments: list[tuple[int, np.ndarray]] = []
    run, run_start = None, 0

    def close():
        nonlocal run
        if run is not None:
            try:
                crops = run.finish()
            except Exception:  # cut_patch rejects a mouth too close to the frame edge
                crops = run.crops
            if len(crops) >= CLIP_LENGTH:
                segments.append((run_start, np.stack(crops)))
        run = None

    cap = cv2.VideoCapture(str(video25))
    index = 0
    while index < MAX_SECONDS * FPS:
        ok, frame = cap.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if index in breaks:  # a join between sampled windows: motion is not continuous across it
            close()
        landmarks = _landmarks(rgb)
        if landmarks is None:
            close()
        else:
            if run is None:
                run, run_start = _RunCropper(), index
            try:
                run.push(rgb, landmarks)
            except Exception:
                close()
        index += 1
    cap.release()
    close()
    return segments


def analyze(file_path: Path, video25_path: Path | None = None, breaks: frozenset[int] = frozenset()) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)
    model = load_model()

    with tempfile.TemporaryDirectory(prefix="lipforensics_") as tmp:
        video25 = video25_path
        if video25 is None:
            video25 = Path(tmp) / "video25.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(file_path), "-t", str(MAX_SECONDS), "-an",
                 "-vf", "scale=-2:'min(720,ih)'", "-r", str(FPS), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(video25)],
                check=True, capture_output=True, timeout=300,
            )
        segments = extract_mouth_segments(video25, breaks)

    findings: list[Finding] = []
    logits: list[float] = []
    offset = (CROP - INPUT) // 2
    for seg_start, crops in segments:
        for i in range(0, len(crops) - CLIP_LENGTH + 1, CLIP_LENGTH):
            clip = crops[i:i + CLIP_LENGTH, offset:offset + INPUT, offset:offset + INPUT].astype(np.float32) / 255.0
            tensor = torch.from_numpy((clip - GRAY_MEAN) / GRAY_STD)[None, None].to(DEVICE)  # (1, 1, T, 88, 88)
            with torch.no_grad():
                logit = float(model(tensor, lengths=[CLIP_LENGTH]).item())
            logits.append(logit)
            score = 1.0 / (1.0 + np.exp(-logit))
            start = (seg_start + i) / FPS
            findings.append(Finding(
                model="lipforensics", score=score, start=round(start, 2), end=round(start + CLIP_LENGTH / FPS, 2),
                note="lip_deepfake_detected" if score >= THRESHOLD else "lip_appears_genuine",
            ))

    if not findings:
        findings.append(Finding(model="lipforensics", score=0.0, note="no_mouth_track: no face stayed visible for a full second"))
    else:
        # A stretch of consecutive flagged clips is local evidence the whole-video average would dilute.
        run: list[Finding] = []
        for f in findings + [None]:
            if f is not None and f.score >= 0.7 and (not run or abs(f.start - run[-1].end) < 0.05):
                run.append(f)
                continue
            if len(run) >= 3:
                findings.append(Finding(model="lipforensics", score=float(np.mean([r.score for r in run])), start=run[0].start,
                                        end=run[-1].end, note=f"lip_manipulation_interval: {len(run)} consecutive clips flagged"))
            run = [f] if f is not None and f.score >= 0.7 else []
        # Video-level score as in the paper's evaluation: the logits averaged over all clips.
        findings.append(Finding(model="lipforensics", score=float(1.0 / (1.0 + np.exp(-np.mean(logits)))),
                                note=f"video_level: mean over {len(logits)} one-second clips"))

    return ModuleResult(
        module="video",
        file_sha256=sha,
        findings=findings,
        weights_sha256={"lipforensics": weights_sha256(_weights_path())},
        runtime_s=time.time() - t0,
    )
