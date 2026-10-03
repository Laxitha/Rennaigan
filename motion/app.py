"""Motion & physics forensics module: rule-based checks on facial motion.

1. Optical flow consistency (RAFT): face against its surroundings
2. Head-pose agreement (solvePnP)
3. Motion smoothness (Savitzky-Golay jerk)
4. Identity drift (ArcFace cosine distance)
5. Blink dynamics (EAR)

Cost is bounded: a long video is examined in evenly spaced windows (common.sampling), at
480 px height. Landmarks are read on every frame, faces are detected three times a second,
and flow is computed five times a second. Each check runs per window, because motion is not
continuous across the join between two windows.
"""

from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path

import cv2

from common import budget
from common.face import any_face, detect_faces, get_largest_face
from common.sampling import build_sample, coverage_note, plan, probe_duration, window_bounds
from common.schema import Finding, ModuleResult
from common.service import create_app
from common.utils import file_sha256

from .blink import analyze_blinks
from .head_pose import analyze_head_pose
from .identity_drift import analyze_identity_drift
from .landmarks import get_face_mesh, get_landmarks
from .smoothness import compute_jerk

FPS = 25
FACE_EVERY = 8   # frames between face detections (about 3 per second)
EMBED_EVERY = 24 # frames between identity embeddings (about 1 per second)
FLOW_EVERY = 5   # frames between optical-flow pairs (5 per second)


def analyze(file_path: Path, video25_path: Path | None = None) -> ModuleResult:
    t0 = time.time()
    sha = file_sha256(file_path)
    duration = probe_duration(file_path)
    plan_ = budget.get()
    windows = plan(duration, plan_["window_s"], plan_["max_windows"])
    timings: dict[str, float] = {}

    work = Path(tempfile.mkdtemp(prefix="rg_motion_"))
    try:
        # No face in a spread of frames of the upload: none of the motion checks apply, so the
        # sample clip is not built and the full pass is skipped.
        probe = cv2.VideoCapture(str(video25_path or file_path))
        total = int(probe.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        samples = []
        for position in range(0, total, max(1, total // 10)):
            probe.set(cv2.CAP_PROP_POS_FRAMES, position)
            ok, frame = probe.read()
            if ok:
                samples.append(cv2.resize(frame, (frame.shape[1] * 480 // max(frame.shape[0], 1), 480)) if frame.shape[0] > 480 else frame)
        probe.release()
        if not any_face(samples):
            return ModuleResult(module="motion", file_sha256=sha, runtime_s=time.time() - t0, timings=timings,
                                findings=[Finding(model="landmarks", score=0.0, note="no_face_detected: no face in the sampled frames")])

        target = video25_path or build_sample(file_path, work / "sample25.mp4", windows, fps=FPS, max_height=480, audio=False)
        timings["prepare"] = round(time.time() - t0, 2)

        cap = cv2.VideoCapture(str(target))
        landmarks, embeddings, flow_pairs = [], [], []
        frame_shape, box, previous = None, None, None
        index = 0
        started = time.time()
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_shape = frame_shape or frame.shape
            landmarks.append(get_landmarks(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))

            if index % FACE_EVERY == 0:
                # Boxes are cheap; the identity embedding is the slow part, so it is taken once a second.
                want_embedding = index % EMBED_EVERY == 0
                face = get_largest_face(detect_faces(frame, embeddings=want_embedding))
                box = face["box"] if face else None
                if want_embedding:
                    embeddings.append((index, face.get("embedding") if face else None))
            # the frame after a flow sample completes the pair
            if plan_["optical_flow"] and index % FLOW_EVERY == 1 and previous is not None and box is not None:
                flow_pairs.append((index - 1, previous, frame, box))
            previous = frame if index % FLOW_EVERY == 0 else None
            index += 1
        cap.release()
        timings["landmarks_and_faces"] = round(time.time() - started, 2)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if not landmarks or all(lm is None for lm in landmarks):
        return ModuleResult(module="motion", file_sha256=sha, runtime_s=time.time() - t0, timings=timings,
                            findings=[Finding(model="landmarks", score=0.0, note="no_face_detected: no face to track in the examined frames")])

    findings: list[Finding] = []
    failed: dict[str, str] = {}

    def check(name: str, offset: float, fn) -> None:
        """Run one check on one window and report its findings in source-video time."""
        started = time.time()
        try:
            for f in fn():
                if f.start is not None:
                    f.start, f.end = round(f.start + offset, 2), round((f.end if f.end is not None else f.start) + offset, 2)
                findings.append(f)
        except Exception as exc:
            failed.setdefault(name, str(exc))
        timings[name] = round(timings.get(name, 0.0) + time.time() - started, 2)

    def flow_findings(first: int, last: int):
        from .optical_flow import analyze_flow_consistency, flow_residual
        residuals, times = [], []
        for i, a, b, face_box in flow_pairs:
            if first <= i < last:
                value = flow_residual(a, b, face_box)
                if value is not None:
                    residuals.append(value)
                    times.append((i - first) / FPS)
        return analyze_flow_consistency(residuals, times)

    for (source_start, _), (first, last) in zip(windows, window_bounds(windows, FPS)):
        last = min(last, len(landmarks))
        if last - first < FPS:
            continue
        part = landmarks[first:last]
        # Check times are relative to the window; the offset places them in the source video.
        if plan_["optical_flow"]:
            check("optical_flow", source_start, lambda: flow_findings(first, last))
        check("head_pose", source_start, lambda: analyze_head_pose(part, frame_shape))
        check("smoothness", source_start, lambda: compute_jerk(part))
        check("identity_drift", source_start,
              lambda: analyze_identity_drift([e for i, e in embeddings if first <= i < last], fps=FPS / EMBED_EVERY))
        check("blink", source_start, lambda: analyze_blinks(part))

    findings += [Finding(model=name, score=0.0, note=f"error: {message}") for name, message in failed.items()]

    return ModuleResult(
        module="motion",
        file_sha256=sha,
        findings=findings,
        runtime_s=time.time() - t0,
        timings=timings,
        note=" ".join(n for n in (coverage_note(duration, windows), budget.REDUCED_NOTE if plan_["reduced"] else "") if n),
    )


def warmup() -> None:
    from .optical_flow import load_raft
    for load in (get_face_mesh, load_raft):
        try:
            load()
        except Exception:
            pass  # reported per check at analysis time


app = create_app("motion", analyze, warmup)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
