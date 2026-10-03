"""Motion & physics forensics module — 6 training-free checks on 25fps video.

1. Optical flow consistency (RAFT)
2. Head-pose agreement (solvePnP)
3. Motion smoothness (Savitzky-Golay jerk)
4. Identity drift (ArcFace cosine distance)
5. Blink dynamics (EAR)
6. rPPG heartbeat (stretch goal — not wired yet)
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256
from common.face import detect_faces, get_largest_face

from .landmarks import get_landmarks
from .head_pose import analyze_head_pose
from .smoothness import compute_jerk
from .blink import analyze_blinks
from .identity_drift import analyze_identity_drift


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)

    target = video25_path or file_path
    cap = cv2.VideoCapture(str(target))
    if not cap.isOpened():
        return ModuleResult(module="motion", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    all_landmarks = []
    all_embeddings = []
    face_boxes = []
    frames_for_flow = []
    frame_shape = None

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_shape is None:
            frame_shape = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        lm = get_landmarks(rgb)
        all_landmarks.append(lm)

        # Face detection + embedding at 3fps for identity drift
        if frame_idx % max(1, int(fps / 3)) == 0:
            faces = detect_faces(frame)
            largest = get_largest_face(faces)
            if largest:
                all_embeddings.append(largest.get("embedding"))
                face_boxes.append(largest["box"])
            else:
                all_embeddings.append(None)
                face_boxes.append(None)

        # Store frames for optical flow (every other frame to save memory)
        if frame_idx % 2 == 0 and len(frames_for_flow) < 500:
            faces_for_flow = detect_faces(frame)
            largest_flow = get_largest_face(faces_for_flow)
            frames_for_flow.append({
                "frame": frame,
                "box": largest_flow["box"] if largest_flow else None,
            })

        frame_idx += 1

    cap.release()

    if not all_landmarks:
        return ModuleResult(module="motion", file_sha256=sha, findings=[], runtime_s=time.time() - t0)

    all_findings: list[Finding] = []

    # 1. Optical flow (can be slow — skip if no faces)
    try:
        if len(frames_for_flow) > 2:
            from .optical_flow import analyze_flow_consistency
            flow_findings = analyze_flow_consistency(
                [f["frame"] for f in frames_for_flow],
                [f["box"] for f in frames_for_flow],
            )
            all_findings.extend(flow_findings)
    except Exception as e:
        all_findings.append(Finding(model="optical_flow", score=0.0, note=f"error: {e}"))

    # 2. Head pose agreement
    try:
        if frame_shape is not None:
            pose_findings = analyze_head_pose(all_landmarks, frame_shape)
            all_findings.extend(pose_findings)
    except Exception as e:
        all_findings.append(Finding(model="head_pose", score=0.0, note=f"error: {e}"))

    # 3. Motion smoothness (jerk)
    try:
        jerk_findings = compute_jerk(all_landmarks)
        all_findings.extend(jerk_findings)
    except Exception as e:
        all_findings.append(Finding(model="smoothness", score=0.0, note=f"error: {e}"))

    # 4. Identity drift
    try:
        drift_findings = analyze_identity_drift(all_embeddings, fps=3.0)
        all_findings.extend(drift_findings)
    except Exception as e:
        all_findings.append(Finding(model="identity_drift", score=0.0, note=f"error: {e}"))

    # 5. Blink dynamics
    try:
        blink_findings = analyze_blinks(all_landmarks)
        all_findings.extend(blink_findings)
    except Exception as e:
        all_findings.append(Finding(model="blink", score=0.0, note=f"error: {e}"))

    return ModuleResult(
        module="motion",
        file_sha256=sha,
        findings=all_findings,
        runtime_s=time.time() - t0,
    )


app = create_app("motion", analyze)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
