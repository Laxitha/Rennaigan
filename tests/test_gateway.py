"""Gateway tests. Need ffmpeg and ffprobe on PATH; no model weights or detector services.

    python -m pytest tests -q
"""

from __future__ import annotations

import io
import json
import shutil
import sqlite3
import subprocess
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend import config
from backend.fusion import fuse
from backend.gateway import create_app
from backend.store import Store
from common.fusion import calibrate_score

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")


def make_cfg(tmp_path, **gateway):
    cfg = config.load()
    cfg["gateway"].update(data_dir=str(tmp_path / "data"), **gateway)
    # Nothing listens here, so every module takes the in-process path or is unavailable.
    for i, module in enumerate(config.MODULES):
        cfg["services"][module]["url"] = f"http://127.0.0.1:{59001 + i}"
    return cfg


@pytest.fixture
def cfg(tmp_path):
    return make_cfg(tmp_path)


@pytest.fixture
def client(cfg):
    with TestClient(create_app(cfg)) as c:
        yield c


@pytest.fixture(scope="session")
def samples(tmp_path_factory):
    d = tmp_path_factory.mktemp("samples")
    Image.effect_noise((320, 240), 60).convert("RGB").save(d / "photo.jpg", quality=92)
    run = lambda *a: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)
    run("-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(d / "clip.mp4"))
    run("-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(d / "voice.wav"))
    return d


def upload(client, path, **data):
    with open(path, "rb") as f:
        return client.post("/analyze", files={"file": (path.name, f)}, data=data)


# ------------------------------------------------------------------- fusion

def run_of(status, coverage, *findings):
    return {"info": {"status": status}, "coverage": coverage,
            "findings": [{"model": m, "score": s, "kind": "signal" if s >= 0.3 else "info", "note": m} for m, s in findings]}


def test_calibration_is_identity_at_temperature_one():
    for p in (0.05, 0.2, 0.5, 0.93):
        assert calibrate_score(p, 1.0) == pytest.approx(p, abs=1e-6)
    assert calibrate_score(0.8, 2.0) < 0.8


def test_fusion_strong_signal_caps_trust(cfg):
    runs = {"audio": run_of("ok", 1.0, ("ssl_aasist", 0.96)), "video": run_of("ok", 1.0), "motion": run_of("ok", 1.0),
            "metadata": run_of("ok", 1.0, ("ffprobe", 0.2))}
    out = fuse(runs, ["video", "audio", "motion", "metadata"], "public", cfg)
    assert out["trust_score"] == 4.0  # follows the 0.96 detector, not the average
    assert out["label"] == "High manipulation indicators"
    assert "ssl_aasist" in out["label_reason"]


def test_fusion_unavailable_modules_are_not_counted_as_clean(cfg):
    runs = {"image": run_of("unavailable", 0.0), "metadata": run_of("ok", 1.0, ("ffprobe", 0.2))}
    out = fuse(runs, ["image", "metadata"], "public", cfg)
    assert out["label"] == "Inconclusive"
    assert out["evidence_weight"] == pytest.approx(0.10 / 0.45, abs=1e-3)
    assert "image" not in out["module_scores"]
    assert out["trust_score"] is None  # metadata alone must not read as a clean result


def test_face_swap_with_clean_audio_is_not_averaged_away(cfg):
    runs = {"video": run_of("ok", 1.0, ("sbi_video", 0.85)), "audio": run_of("ok", 1.0, ("voice", 0.08)),
            "motion": run_of("ok", 1.0), "metadata": run_of("ok", 1.0)}
    out = fuse(runs, ["video", "audio", "motion", "metadata"], "public", cfg)
    assert out["label"] == "High manipulation indicators" and out["trust_score"] == 15.0


def test_lip_sync_alone_does_not_decide(cfg):
    # Voice-over and off-screen speakers are out of sync in genuine videos.
    runs = {"video": run_of("ok", 1.0, ("syncnet", 0.69)), "audio": run_of("ok", 1.0, ("voice", 0.1)),
            "motion": run_of("ok", 1.0), "metadata": run_of("ok", 1.0)}
    out = fuse(runs, ["video", "audio", "motion", "metadata"], "public", cfg)
    assert out["label"] == "Low risk" and out["trust_score"] == 75.0
    runs["video"] = run_of("ok", 1.0, ("syncnet", 0.69), ("lipforensics", 0.8))
    assert fuse(runs, ["video", "audio", "motion", "metadata"], "public", cfg)["label"] == "High manipulation indicators"


def test_review_frames_start_with_the_flagged_moments():
    from backend.assess import review_moments
    doc = {"media": {"duration_s": 60.0}, "findings": [
        {"module": "video", "model": "sbi_video", "kind": "signal", "score": 0.9, "start": 10.0, "end": 12.0, "note": "face_swap_interval"},
        {"module": "video", "model": "sbi_video", "kind": "signal", "score": 0.8, "start": 10.5, "end": 11.5, "note": "face_swap_interval"},
        {"module": "video", "model": "aigen_video", "kind": "signal", "score": 0.7, "start": None, "end": None,
         "note": "clip_level: ai_generated_frames, median of 16 frames, 60% at or above 0.5, highest 0.98 at 41.0 s"},
        {"module": "audio", "model": "voice", "kind": "signal", "score": 0.95, "start": 3.0, "end": 8.0, "note": "synthetic_speech_detected"},
    ]}
    moments = review_moments(doc)
    assert len(moments) == 6 and [m["at_s"] for m in moments] == sorted(m["at_s"] for m in moments)
    flagged = [m["at_s"] for m in moments if "scored" in m["why"]]
    assert flagged == [11.0, 41.0]  # the overlapping interval and the audio finding add no frame


def test_clip_too_short_to_judge_is_uncertain(cfg):
    runs = {"audio": {"info": {"status": "ok"}, "coverage": 1.0, "findings": [
                {"model": "voice", "score": 0.0, "kind": "info", "note": "no_usable_speech: 1.2 s of audio is too short to judge"}]},
            "metadata": run_of("ok", 1.0, ("ffprobe", 0.2))}
    out = fuse(runs, ["audio", "metadata"], "public", cfg)
    assert out["label"] == "Inconclusive" and out["trust_score"] is None
    assert "too short" in out["label_reason"]


def test_fusion_without_any_evidence_gives_no_score(cfg):
    out = fuse({"image": run_of("error", 0.0)}, ["image"], "public", cfg)
    assert out["trust_score"] is None and out["label"] == "Inconclusive"


# -------------------------------------------------------------------- ledger

def test_ledger_detects_edits_and_removals(tmp_path):
    store = Store(tmp_path)
    for case in ("RG-2026-00001", "RG-2026-00002"):
        for action in ("media.received", "fusion.computed", "review.recorded"):
            store.append_audit(case, action, f"{action} for {case}")
    assert store.verify_ledger()["intact"]

    db = sqlite3.connect(tmp_path / "rennaigan.db")
    db.execute("UPDATE audit SET detail='rewritten' WHERE case_id='RG-2026-00001' AND seq=2")
    db.commit()
    report = store.verify_case("RG-2026-00001")
    assert not report["intact"] and report["broken_at"] == 2

    db.execute("DELETE FROM audit WHERE case_id='RG-2026-00002' AND seq=2")
    db.commit()
    assert any("missing" in p["problem"] for p in store.verify_case("RG-2026-00002")["problems"])
    assert any("gap" in p["problem"] for p in store.verify_ledger()["problems"])


def test_ledger_rejects_a_recomputed_chain_without_the_key(tmp_path):
    store = Store(tmp_path)
    store.append_audit("RG-2026-00001", "media.received", "original")
    (tmp_path / "ledger.key").write_bytes(b"x" * 32)
    assert not Store(tmp_path).verify_ledger()["intact"]


# ----------------------------------------------------------------------- API

def test_health_and_info(client):
    health = client.get("/health").json()
    assert health["services_total"] == 5 and health["services_up"] == 0 and health["status"] == "down"
    assert health["tools"]["ffmpeg"] is True
    assert health["gateway"]["version"]
    info = client.get("/info").json()
    assert info["modules_for_media"]["video"] == ["video", "audio", "motion", "metadata"]


def test_image_case_lifecycle(client, samples, cfg):
    res = upload(client, samples / "photo.jpg")
    assert res.status_code == 200, res.text
    case = res.json()
    assert case["id"].startswith("RG-") and case["media"]["media_type"] == "image"
    assert case["media"]["width"] == 320 and case["applicable_modules"] == ["image", "metadata"]
    assert case["modules"]["metadata"]["status"] == "ok"
    assert len(case["file"]["sha256"]) == 64
    assert [e["action"] for e in case["audit"]] == ["media.received", "media.probed", "detector.completed",
                                                    "detector.completed", "fusion.computed", "case.sealed"]
    for prev, entry in zip(case["audit"], case["audit"][1:]):
        assert entry["prev_hash"] == prev["entry_hash"]

    assert client.get(case["file"]["media_url"]).status_code == 200
    ela = next(a for a in case["artifacts"] if a["name"] == "ela_heatmap")
    assert client.get(ela["url"]).headers["content-type"] == "image/png"

    listed = client.get("/cases").json()
    assert listed["total"] == 1 and "findings" not in listed["cases"][0]

    assert client.get(f"/cases/{case['id']}/audit/verify").json()["intact"]

    reviewed = client.post(f"/cases/{case['id']}/review", json={"decision": "confirm", "note": "checked", "analyst": "Asha"}).json()
    assert reviewed["review"]["decision"] == "confirm" and reviewed["audit"][-1]["action"] == "review.recorded"
    assert client.get(f"/cases/{case['id']}/audit/verify").json()["intact"]
    assert client.post(f"/cases/{case['id']}/review", json={"decision": "maybe"}).status_code == 422

    # Editing the stored result behind the gateway's back breaks the seal.
    db = sqlite3.connect(f"{cfg['gateway']['data_dir']}/rennaigan.db")
    doc = json.loads(db.execute("SELECT doc FROM cases").fetchone()[0])
    doc["trust_score"] = 99.0
    db.execute("UPDATE cases SET doc=?", (json.dumps(doc),))
    db.commit()
    report = client.get(f"/cases/{case['id']}/audit/verify").json()
    assert not report["intact"] and report["result_matches_seal"] is False

    assert client.delete(f"/cases/{case['id']}").json() == {"deleted": case["id"]}
    assert client.get(f"/cases/{case['id']}").status_code == 404
    assert client.get(case["file"]["media_url"]).status_code == 404
    assert client.get("/audit/verify").json()["entries"] == 8  # the audit trail outlives the case


def test_video_case_and_dissection(client, samples):
    case = upload(client, samples / "clip.mp4").json()
    assert case["media"]["media_type"] == "video" and case["media"]["has_audio"] is True
    assert case["media"]["fps"] == 25 and case["media"]["duration_s"] == pytest.approx(3.0, abs=0.2)
    assert set(case["applicable_modules"]) == {"video", "audio", "motion", "metadata"}

    res = client.post(f"/cases/{case['id']}/dissect?fps=2", json={"fps": 2, "max_frames": 120, "quality": 85})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["dissection"]["extracted_count"] == len(out["frames"]) == 6
    frame = out["frames"][1]
    assert frame["timestamp_s"] == 0.5 and frame["width"] == 320 and frame["sharpness"] > 0
    assert client.get(frame["url"]).headers["content-type"] == "image/jpeg"

    archive = zipfile.ZipFile(io.BytesIO(client.get(f"/cases/{case['id']}/frames/zip?fps=2").content))
    assert len([n for n in archive.namelist() if n.endswith(".jpg")]) == 6

    actions = [e["action"] for e in client.get(f"/cases/{case['id']}").json()["audit"]]
    assert actions.count("video.dissected") == 1  # the second request was served from cache


def test_audio_case_gets_a_spectrogram(client, samples):
    case = upload(client, samples / "voice.wav").json()
    assert case["media"]["media_type"] == "audio" and case["applicable_modules"] == ["audio", "metadata"]
    assert any(a["name"] == "spectrogram" and a["available"] for a in case["artifacts"])


def test_uploads_are_validated(tmp_path, samples):
    with TestClient(create_app(make_cfg(tmp_path))) as client:
        assert client.post("/analyze", files={"file": ("notes.exe", b"MZ")}).status_code == 415
        assert client.post("/analyze", files={"file": ("fake.jpg", b"this is not an image")}).status_code == 415
        assert client.post("/analyze", files={"file": ("empty.png", b"")}).status_code == 422
        assert client.get("/cases").json()["total"] == 0
        assert client.get("/cases/..%2F..%2Fetc").status_code == 404

        case = upload(client, samples / "photo.jpg").json()
        assert client.get(f"/artifacts/{case['id']}/..%2F..%2F..%2Frennaigan.db").status_code == 404
        assert client.get(f"/artifacts/{case['id']}/../media/photo.jpg").status_code == 404

    small = make_cfg(tmp_path / "small")
    small["preprocessing"]["max_upload_mb"] = 0
    with TestClient(create_app(small)) as client:
        assert upload(client, samples / "photo.jpg").status_code == 413


def test_bulk_isolates_failures(client, samples):
    files = [("files", ("photo.jpg", (samples / "photo.jpg").read_bytes())),
             ("files", ("voice.wav", (samples / "voice.wav").read_bytes())),
             ("files", ("broken.png", b"nope"))]
    out = client.post("/bulk", files=files).json()
    assert (out["total"], out["succeeded"], out["failed"]) == (3, 2, 1)
    assert out["results"][2]["status"] == 415
    assert client.get(f"/cases?batch_id={out['batch_id']}").json()["total"] == 2


def test_rag_retrieves_case_findings(client, samples):
    case = upload(client, samples / "clip.mp4").json()
    assert client.get("/rag/status").json()["documents_indexed"] >= 1
    hits = client.post("/rag/query", json={"query": "trust score label", "k": 3}).json()["hits"]
    assert hits and hits[0]["case_id"] == case["id"]


def test_fusion_rule_based_modules_cannot_cap_trust(cfg):
    runs = {"video": run_of("ok", 1.0), "motion": run_of("ok", 1.0, ("smoothness", 1.0)), "metadata": run_of("ok", 1.0)}
    out = fuse(runs, ["video", "motion", "metadata"], "public", cfg)
    assert out["module_scores"]["motion"] == pytest.approx(0.2)  # one motion check alone
    assert out["trust_score"] > 30
    runs["motion"] = run_of("ok", 1.0, ("smoothness", 1.0), ("head_pose", 0.9))
    assert fuse(runs, ["video", "motion", "metadata"], "public", cfg)["module_scores"]["motion"] == pytest.approx(0.4)  # two agree: module cap


def test_fusion_needs_the_primary_module(cfg):
    runs = {"video": run_of("error", 0.0), "audio": run_of("ok", 1.0, ("voice", 0.05)), "motion": run_of("ok", 1.0), "metadata": run_of("ok", 1.0)}
    out = fuse(runs, ["video", "audio", "motion", "metadata"], "public", cfg)
    assert out["label"] == "Inconclusive" and "video detectors" in out["label_reason"]


def test_fusion_detector_with_nothing_to_examine_is_not_clean_evidence(cfg):
    no_face = {"info": {"status": "ok"}, "coverage": 1.0, "findings": [
        {"model": m, "score": 0.0, "kind": "info", "note": n}
        for m, n in (("sbi_video", "no_face_detected"), ("aigen_video", "no_frames"), ("lipforensics", "no_mouth_track"), ("syncnet", "no_face_track"))]}
    out = fuse({"video": no_face}, ["video"], "public", cfg)
    assert out["module_coverage"]["video"] == 0 and out["trust_score"] is None


# ------------------------------------------------------------------ verdict

def test_fusion_verdict_levels(cfg):
    from backend.assess import fusion_verdict
    real = fusion_verdict({"trust_score": 95.0, "evidence_weight": 1.0, "label": "Low risk", "label_reason": ""}, cfg)
    fake = fusion_verdict({"trust_score": 30.0, "evidence_weight": 1.0, "label": "High manipulation indicators", "label_reason": ""}, cfg)
    thin = fusion_verdict({"trust_score": 90.0, "evidence_weight": 0.2, "label": "Inconclusive", "label_reason": ""}, cfg)
    assert (real["verdict"], real["confidence"]) == ("real", 95)
    assert fake["verdict"] == "deepfake" and 60 <= fake["confidence"] <= 90
    assert thin["verdict"] == "uncertain" and thin["confidence"] <= 50


def test_case_without_api_key_uses_fusion_verdict(client, samples, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    case = upload(client, samples / "photo.jpg").json()
    assert case["verdict"]["source"] == "fusion" and case["assessment"] is None
    assert client.get("/health").json()["assessment"]["enabled"] is False
    assert client.post(f"/cases/{case['id']}/assess").status_code == 503
    assert client.get("/cases").json()["cases"][0]["verdict"]["verdict"] == case["verdict"]["verdict"]


def test_claude_assessment_is_recorded_and_sealed(client, samples, monkeypatch):
    from backend import assess
    seen = {}

    async def fake_assess(doc, earlier, model, images=None, frames=None):
        seen["evidence"] = assess.build_evidence(doc, earlier)
        return {"verdict": "deepfake", "confidence": 71, "headline": "Voice detector flags synthetic speech.",
                "explanation": "e", "evidence": [], "caveats": [], "recommendation": "r", "model": model,
                "generated_at": "t", "similar_cases_used": [], "usage": {"input_tokens": 1, "output_tokens": 1}}

    monkeypatch.setattr(assess, "available", lambda: True)
    monkeypatch.setattr(assess, "assess", fake_assess)
    case = upload(client, samples / "voice.wav").json()
    assert case["verdict"] == {"verdict": "deepfake", "confidence": 71, "source": "claude", "headline": "Voice detector flags synthetic speech."}
    assert case["fusion_verdict"]["source"] == "fusion"
    assert "assessment.generated" in [e["action"] for e in case["audit"]]
    assert any("ASVspoof" in note for note in seen["evidence"]["detector_reference_notes"]) is False  # audio detector did not run here
    assert any("ffprobe" in note for note in seen["evidence"]["detector_reference_notes"])
    assert client.get(f"/cases/{case['id']}/audit/verify").json()["intact"]

    again = client.post(f"/cases/{case['id']}/assess").json()
    assert [e["action"] for e in again["audit"]][-2:] == ["assessment.generated", "case.sealed"]
    assert client.get(f"/cases/{case['id']}/audit/verify").json()["intact"]

    async def failing(doc, earlier, model, images=None, frames=None):
        raise RuntimeError("rate limited")
    monkeypatch.setattr(assess, "assess", failing)
    failed = upload(client, samples / "photo.jpg").json()
    assert failed["verdict"]["source"] == "fusion" and "rate limited" in failed["assessment_error"]


def test_chunked_upload(client, samples, monkeypatch):
    import hashlib
    from backend import gateway
    data = (samples / "clip.mp4").read_bytes()
    size = gateway.CHUNK_BYTES  # default chunk size; the sample is smaller, so use a tiny one via a second app
    start = client.post("/uploads", json={"name": "clip.mp4", "size": len(data)}).json()
    assert start["chunk_bytes"] == size
    # one chunk covers this small file
    assert client.put(f"/uploads/{start['upload_id']}/3", content=b"x").status_code == 409  # outside the file
    assert client.put(f"/uploads/{start['upload_id']}/0", content=data[:100]).status_code == 422  # wrong length
    assert client.put(f"/uploads/{start['upload_id']}/0", content=data).json()["received"] == 1
    assert client.put(f"/uploads/{start['upload_id']}/0", content=data).json()["received"] == 1  # a retry is harmless
    case = client.post(f"/uploads/{start['upload_id']}/analyze", json={"mode": "public"}).json()
    assert case["media"]["media_type"] == "video" and case["file"]["sha256"] == hashlib.sha256(data).hexdigest()
    # the upload id doubles as the progress id
    assert client.get(f"/progress/{start['upload_id']}").json() == {"percent": 100, "stage": "done", "detail": case["id"]}
    assert client.get("/progress/" + "0" * 24).status_code == 404

    assert client.post("/uploads", json={"name": "x.exe", "size": 10}).status_code == 415
    empty = client.post("/uploads", json={"name": "clip.mp4", "size": len(data)}).json()
    assert client.post(f"/uploads/{empty['upload_id']}/analyze", json={}).status_code == 422


def test_chunks_can_arrive_out_of_order(tmp_path, samples, monkeypatch):
    import hashlib
    from backend import gateway
    monkeypatch.setattr(gateway, "CHUNK_BYTES", 100_000)
    data = (samples / "clip.mp4").read_bytes()
    with TestClient(create_app(make_cfg(tmp_path))) as c:
        start = c.post("/uploads", json={"name": "clip.mp4", "size": len(data)}).json()
        parts = [data[i:i + 100_000] for i in range(0, len(data), 100_000)]
        for index in reversed(range(len(parts))):
            assert c.put(f"/uploads/{start['upload_id']}/{index}", content=parts[index]).status_code == 200
        case = c.post(f"/uploads/{start['upload_id']}/analyze", json={}).json()
        assert case["file"]["sha256"] == hashlib.sha256(data).hexdigest()


def test_fusion_uses_aggregates_and_softens_subthreshold_scores(cfg):
    from backend.fusion import soften
    assert soften(0.2, 0.5) == pytest.approx(0.08) and soften(0.5, 0.5) == 0.5 and soften(0.9, 0.5) == 0.9
    windows = [{"model": "ssl_aasist", "score": s, "kind": "signal" if s >= 0.3 else "info", "note": "speech_appears_genuine"} for s in [0.05] * 20 + [0.97]]
    noisy = {"info": {"status": "ok"}, "coverage": 1.0,
             "findings": windows + [{"model": "ssl_aasist", "score": 0.05, "kind": "info", "note": "clip_level: median over 21 speech windows"}]}
    out = fuse({"audio": noisy}, ["audio"], "public", cfg)
    assert out["module_scores"]["audio"] < 0.05 and out["label"] == "Low risk"  # one stray window does not decide the file

    sustained = {**noisy, "findings": noisy["findings"] + [{"model": "ssl_aasist", "score": 0.95, "kind": "signal", "note": "synthetic_speech_interval: 3 consecutive windows flagged"}]}
    assert fuse({"audio": sustained}, ["audio"], "public", cfg)["label"] == "High manipulation indicators"


def test_failed_detector_plus_idle_one_is_unavailable_not_real(cfg):
    """Seen live: the voice model crashed, the speaker check had no reference, and the file was called real."""
    from backend.detectors import normalize
    from backend.assess import fusion_verdict
    raw = [{"model": "ssl_aasist", "score": 0.0, "note": "error: No module named 'fairseq'"},
           {"model": "ecapa", "score": 0.0, "note": "no_reference_audio_provided"}]
    findings, errored = normalize("audio", raw, 0.3)
    usable = [f for f in findings if f["kind"] != "error" and not (f["score"] == 0.0 and f["note"].startswith("no_"))]
    assert errored == {"ssl_aasist"} and usable == []
    runs = {"audio": {"info": {"status": "unavailable"}, "coverage": 0.0, "findings": findings},
            "metadata": {"info": {"status": "ok"}, "coverage": 1.0, "findings": [{"model": "ffprobe", "score": 0.2, "kind": "info", "note": "encoder_detected"}]}}
    fused = fuse(runs, ["audio", "metadata"], "public", cfg)
    assert fused["label"] == "Inconclusive" and fusion_verdict(fused, cfg)["verdict"] == "uncertain"


def test_a_certain_detector_flags_even_when_others_are_missing(cfg):
    """Seen on the website: both AI-image classifiers said 1.00 and the page said 'too little could be tested'."""
    from backend.assess import fusion_verdict
    image = {"info": {"status": "degraded"}, "coverage": 0.333, "findings": [{"model": "aigen", "score": 0.998, "kind": "signal", "note": "ai_generated_detection"}]}
    fused = fuse({"image": image, "metadata": run_of("ok", 1.0)}, ["image", "metadata"], "public", cfg)
    verdict = fusion_verdict(fused, cfg)
    assert fused["label"] == "High manipulation indicators" and "did not all run" in fused["label_reason"]
    assert verdict["verdict"] == "deepfake" and 60 <= verdict["confidence"] <= 90
    # but a low score with the same gaps still cannot clear the file
    image["findings"][0]["score"] = 0.01
    assert fuse({"image": image, "metadata": run_of("ok", 1.0)}, ["image", "metadata"], "public", cfg)["label"] == "Inconclusive"


def test_faceless_video_is_judged_on_the_checks_that_apply(cfg):
    """Seen on the website: a screen recording of buildings came back 'too little could be tested'."""
    nothing = lambda m, n: {"model": m, "score": 0.0, "kind": "info", "note": n}
    video = {"info": {"status": "ok"}, "coverage": 1.0, "findings": [
        nothing("sbi_video", "no_face_detected: x"), nothing("lipforensics", "no_mouth_track: x"), nothing("syncnet", "no_face_track: x"),
        {"model": "aigen_video", "score": 0.04, "kind": "info", "note": "clip_level: ai_generated_frames"}]}
    motion = {"info": {"status": "ok"}, "coverage": 1.0, "findings": [nothing("landmarks", "no_face_detected: x")]}
    audio = {"info": {"status": "ok"}, "coverage": 1.0, "findings": [nothing("voice", "no_speech: silent")]}
    out = fuse({"video": video, "audio": audio, "motion": motion, "metadata": run_of("ok", 1.0)}, ["video", "audio", "motion", "metadata"], "public", cfg)
    assert out["label"] == "Low risk" and out["evidence_weight"] == 1.0
    assert out["module_coverage"]["video"] == 1.0 and "did not apply" in out["label_reason"]
