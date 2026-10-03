"""Rennaigan gateway. The UI talks only to this service.

    uvicorn backend.gateway:app --port 8010      (or: python start.py)

It stores each upload as a case, runs the detector modules that apply to the media type,
fuses their findings into a trust score, and seals every step into the audit ledger.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__, assess, config, media, rag
from .detectors import run_module, service_up
from .fusion import fuse
from .store import Store, now_iso, result_digest

CASE_ID = re.compile(r"^RG-\d{4}-\d{5,}$")
BATCH_ID = re.compile(r"^BT-[0-9a-f]{12}$")
LOCAL_ORIGIN = r"^https?://(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^./]+\.local)(:\d+)?$"
SUMMARY_KEYS = ("id", "created_at", "mode", "batch_id", "file", "media", "trust_score", "label", "label_reason",
                "evidence_weight", "module_scores", "total_findings", "runtime_s", "review", "modules", "verdict")
MAX_ARTIFACT_BYTES = 50 * 1024 * 1024


class ReviewBody(BaseModel):
    decision: Literal["confirm", "reject", "inconclusive"]
    note: str = Field(default="", max_length=4000)
    analyst: str = Field(default="analyst", min_length=1, max_length=120)


class RagQuery(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    k: int = Field(default=5, ge=1, le=50)
    case_id: str | None = None


def create_app(cfg: dict | None = None) -> FastAPI:
    cfg = cfg or config.load()
    gw = cfg["gateway"]
    data_dir = Path(gw["data_dir"])
    cases_dir = data_dir / "cases"
    tmp_dir = data_dir / "tmp"
    max_bytes = int(cfg["preprocessing"]["max_upload_mb"]) * 1024 * 1024
    urls = {m: cfg["services"][m]["url"].rstrip("/") for m in config.MODULES}
    assessment_cfg = cfg["assessment"]

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Detectors resolve weights/, repos/ and config.yaml relative to the repository root.
        os.chdir(config.ROOT)
        if str(config.ROOT) not in sys.path:
            sys.path.insert(0, str(config.ROOT))
        cases_dir.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)
        app.state.store = Store(data_dir)
        app.state.client = httpx.AsyncClient()
        app.state.slots = asyncio.Semaphore(int(gw["max_concurrent_analyses"]))
        yield
        await app.state.client.aclose()

    app = FastAPI(title="Rennaigan Gateway", version=__version__, lifespan=lifespan)
    origins = list(gw.get("cors_origins") or [])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=".*" if "*" in origins else LOCAL_ORIGIN,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    # ------------------------------------------------------------- helpers

    def store() -> Store:
        return app.state.store

    def case_dir(case_id: str) -> Path:
        if not CASE_ID.match(case_id):
            raise HTTPException(404, f"No case {case_id}")
        return cases_dir / case_id

    def load_case(case_id: str) -> dict:
        case_dir(case_id)
        doc = store().get_case(case_id)
        if doc is None:
            raise HTTPException(404, f"No case {case_id}")
        return doc

    def inside(base: Path, relative: str) -> Path:
        target = (base / relative).resolve()
        if not target.is_relative_to(base.resolve()) or not target.is_file():
            raise HTTPException(404, "Not found")
        return target

    def summary(doc: dict) -> dict:
        return {k: doc.get(k) for k in SUMMARY_KEYS}

    async def receive(upload: UploadFile) -> tuple[Path, str, str, int]:
        """Stream an upload to disk, hashing it and enforcing type and size limits."""
        name = media.safe_name(upload.filename or "upload")
        ext = Path(name).suffix.lower().lstrip(".")
        if ext not in media.ALLOWED_EXT:
            raise HTTPException(415, f"Files of type .{ext or '?'} are not supported.")
        tmp = tmp_dir / f"{secrets.token_hex(8)}.{ext}"
        digest, size = hashlib.sha256(), 0
        try:
            with open(tmp, "wb") as out:
                while chunk := await upload.read(1 << 20):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(413, f"File is larger than the {max_bytes // (1024 * 1024)} MB limit.")
                    digest.update(chunk)
                    out.write(chunk)
            if size == 0:
                raise HTTPException(422, "The uploaded file is empty.")
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return tmp, name, digest.hexdigest(), size

    def collect_artifacts(case_id: str, module: str, produced: dict, art_dir: Path, media_dir: Path) -> list[dict]:
        """Copy files a detector wrote on this host into the case. Remote paths are listed as unavailable."""
        out = []
        removable = [Path(tempfile.gettempdir()).resolve(), media_dir.resolve()]
        for name, raw_path in produced.items():
            src = Path(str(raw_path))
            src = src if src.is_absolute() else config.ROOT / src
            label = re.sub(r"[^A-Za-z0-9_-]", "_", str(name))[:60]
            entry = {"name": label, "module": module, "url": None, "content_type": None, "available": False}
            if src.is_file() and src.stat().st_size <= MAX_ARTIFACT_BYTES:
                dest = art_dir / f"{module}_{label}{src.suffix.lower()}"
                shutil.copyfile(src, dest)
                if any(src.resolve().is_relative_to(base) for base in removable):
                    src.unlink(missing_ok=True)
                entry.update(url=f"/artifacts/{case_id}/{dest.name}", content_type=media.content_type(dest.name), available=True)
            out.append(entry)
        return out

    def gateway_artifacts(case_id: str, media_path: Path, info: dict, art_dir: Path) -> list[dict]:
        made = []
        if info["media_type"] in ("image", "screenshot"):
            if media.ela_heatmap(media_path, art_dir / "ela_heatmap.png"):
                made.append("ela_heatmap.png")
        elif info["has_audio"]:
            # Named differently for video so the UI does not lay it over the picture.
            name = "spectrogram.png" if info["media_type"] == "audio" else "audio_spectrum.png"
            if media.spectrogram(media_path, art_dir / name):
                made.append(name)
        return [{"name": Path(n).stem, "module": "gateway", "url": f"/artifacts/{case_id}/{n}",
                 "content_type": media.content_type(n), "available": True} for n in made]

    async def ingest(upload: UploadFile) -> tuple:
        """Validate and store an upload. Every rejection (type, size, undecodable) happens here."""
        tmp, name, sha, size = await receive(upload)
        try:
            info = await asyncio.to_thread(media.probe, tmp, name)
        except media.UnsupportedMedia as exc:
            tmp.unlink(missing_ok=True)
            raise HTTPException(415, str(exc))
        return tmp, name, sha, size, info

    async def analyze_upload(upload: UploadFile, mode: str, batch_id: str | None = None) -> dict:
        return await run_case(await ingest(upload), mode, batch_id)

    async def run_case(ingested: tuple, mode: str, batch_id: str | None = None) -> dict:
        tmp, name, sha, size, info = ingested
        t0 = time.monotonic()
        st = store()
        case_id, n = st.new_case_id()
        media_dir, art_dir = cases_dir / case_id / "media", cases_dir / case_id / "artifacts"
        media_dir.mkdir(parents=True)
        art_dir.mkdir()
        media_path = media_dir / name
        shutil.move(tmp, media_path)

        st.append_audit(case_id, "media.received", f"{name}, {size} bytes. SHA-256 recorded before any processing.",
                        extra={"file_sha256": sha, "size_bytes": size, "mode": mode, **({"batch_id": batch_id} if batch_id else {})})
        st.append_audit(case_id, "media.probed",
                        f"Classified as {info['media_type']}"
                        + (f", {info['width']}x{info['height']}" if info["width"] else "")
                        + (f", {info['duration_s']} s" if info["duration_s"] else ""),
                        extra={k: v for k, v in info.items() if v is not None})

        applicable = list(config.MODULES_FOR_MEDIA[info["media_type"]])
        modules: dict[str, dict] = {}
        if "audio" in applicable and info["media_type"] == "video" and not info["has_audio"]:
            applicable.remove("audio")
            modules["audio"] = {"status": "not_applicable", "detail": "The video has no audio stream.", "findings_count": 0}

        async with app.state.slots:
            results = await asyncio.gather(*[
                run_module(app.state.client, m, urls[m], media_path, name, timeout_s=float(gw["module_timeout_s"]),
                           inprocess_fallback=bool(gw["inprocess_fallback"]), signal_floor=float(cfg["fusion"]["signal_floor"]))
                for m in applicable
            ])
        runs = dict(zip(applicable, results))

        findings, artifacts = [], []
        for module in applicable:
            run = runs[module]
            modules[module] = run["info"]
            findings.extend(run["findings"])
            artifacts.extend(collect_artifacts(case_id, module, run["artifacts"], art_dir, media_dir))
            st.append_audit(case_id, "detector.completed", f"{run['info']['status']}: {run['info']['detail']}", actor=module,
                            duration_ms=int(run["info"]["elapsed_s"] * 1000),
                            extra={"findings": run["info"]["findings_count"], **{f"weights.{k}": v for k, v in run["info"]["weights_sha256"].items()}})
        artifacts.extend(await asyncio.to_thread(gateway_artifacts, case_id, media_path, info, art_dir))
        # The UI overlays the first heatmap it finds, so lead with the strongest detector's.
        top_score: dict[str, float] = {}
        for f in findings:
            top_score[f["model"]] = max(top_score.get(f["model"], 0.0), f["score"])
        artifacts.sort(key=lambda a: -top_score.get(a["name"].split("_")[0], -1.0 if a["module"] == "gateway" else 0.0))

        fused = fuse(runs, applicable, mode, cfg)
        st.append_audit(case_id, "fusion.computed",
                        f"{fused['label']}. Trust score {fused['trust_score']}. Evidence weight {fused['evidence_weight']:.0%}.",
                        actor="fusion", extra={f"score.{m}": s for m, s in fused["module_scores"].items()})

        keep = bool(gw["keep_media"])
        if not keep:
            shutil.rmtree(media_dir, ignore_errors=True)
        doc = {
            "id": case_id,
            "created_at": now_iso(),
            "mode": mode,
            "batch_id": batch_id,
            "file": {"name": name, "size_bytes": size, "sha256": sha, "content_type": media.content_type(name),
                     "media_url": f"/media/{case_id}" if keep else None},
            "media": info,
            **fused,
            "total_findings": sum(1 for f in findings if f["kind"] != "error"),
            "runtime_s": round(time.monotonic() - t0, 3),
            "review": None,
            "modules": modules,
            "applicable_modules": applicable,
            "findings": findings,
            "artifacts": artifacts,
            "gateway_version": __version__,
        }
        await add_verdict(doc)
        doc["runtime_s"] = round(time.monotonic() - t0, 3)
        st.save_case(doc, n)
        st.append_audit(case_id, "case.sealed", "Analysis result stored. Its digest is sealed into this entry.",
                        duration_ms=int(doc["runtime_s"] * 1000), extra={"result_sha256": result_digest(doc)})
        return st.get_case(case_id)

    async def add_verdict(doc: dict) -> None:
        """Set doc["verdict"]: Claude's reasoned verdict when it is available, else the fused one."""
        st = store()
        doc["fusion_verdict"] = doc["verdict"] = assess.fusion_verdict(doc, cfg)
        doc["assessment"], doc["assessment_error"] = None, None
        if not (assessment_cfg["enabled"] and assess.available()):
            return
        t0 = time.monotonic()
        earlier = [c for c in st.list_cases(200)[1] if c["id"] != doc["id"]]
        try:
            result = await asyncio.wait_for(assess.assess(doc, earlier, assessment_cfg["model"]), timeout=float(assessment_cfg["timeout_s"]))
        except Exception as exc:
            doc["assessment_error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
            st.append_audit(doc["id"], "assessment.failed", doc["assessment_error"], actor=assessment_cfg["model"],
                            duration_ms=int((time.monotonic() - t0) * 1000))
            return
        doc["assessment"] = result
        doc["verdict"] = {"verdict": result["verdict"], "confidence": result["confidence"], "source": "claude", "headline": result["headline"]}
        st.append_audit(doc["id"], "assessment.generated",
                        f"{result['verdict']} at {result['confidence']}% confidence. {result['headline'][:200]}",
                        actor=result["model"], duration_ms=int((time.monotonic() - t0) * 1000),
                        extra={"fusion_verdict": doc["fusion_verdict"]["verdict"], "similar_cases": ",".join(result["similar_cases_used"])})

    # -------------------------------------------------------------- status

    @app.get("/health")
    async def health():
        async def ping(module: str) -> tuple[str, dict]:
            t0 = time.monotonic()
            ok = await service_up(app.state.client, module, urls[module], timeout=1.5)
            return module, {"ok": ok, "url": urls[module], "latency_ms": round((time.monotonic() - t0) * 1000)}

        services = dict(await asyncio.gather(*[ping(m) for m in config.MODULES]))
        up = sum(s["ok"] for s in services.values())
        return {
            "status": "ok" if up == len(services) else "degraded" if up else "down",
            "services": services,
            "services_up": up,
            "services_total": len(services),
            "tools": {t: shutil.which(t) is not None for t in ("ffmpeg", "ffprobe", "exiftool", "c2patool")},
            "gateway": {"version": __version__, "cases": store().count_cases(), "keep_media": bool(gw["keep_media"])},
            "rag": {"enabled": True, "retriever": rag.RETRIEVER},
            "assessment": {"enabled": bool(assessment_cfg["enabled"] and assess.available()), "model": assessment_cfg["model"]},
        }

    @app.get("/info")
    async def info():
        return {
            "version": __version__,
            "modules": {m: {"url": urls[m], "detectors": config.MODULE_DETECTORS[m]} for m in config.MODULES},
            "modules_for_media": config.MODULES_FOR_MEDIA,
            "thresholds": cfg["thresholds"],
            "temperatures": cfg["temperatures"],
            "module_weights": cfg["module_weights"],
            "fusion": cfg["fusion"],
            "labels": cfg["labels"],
            "preprocessing": {k: v for k, v in cfg["preprocessing"].items() if isinstance(v, (int, float))},
            "weights_sha256": cfg["weights_sha256"],
        }

    # ------------------------------------------------------------- analyze

    @app.post("/analyze")
    async def analyze(file: UploadFile = File(...), mode: Literal["public", "identity"] = Form("public"),
                      batch_id: str | None = Form(None)):
        if batch_id is not None and not BATCH_ID.match(batch_id):
            raise HTTPException(422, "batch_id must look like BT-<12 hex characters>.")
        ingested = await ingest(file)
        task = asyncio.create_task(run_case(ingested, mode, batch_id))

        async def body():
            # Detector runs can take minutes, and tunnels and proxies drop a request that stays
            # silent that long. JSON allows leading whitespace, so a space is sent while waiting.
            while not (await asyncio.wait({task}, timeout=15))[0]:
                yield b" "
            try:
                yield json.dumps(task.result()).encode()
            except Exception as exc:
                yield json.dumps({"detail": f"Analysis failed: {type(exc).__name__}: {exc}"}).encode()

        return StreamingResponse(body(), media_type="application/json")

    @app.post("/bulk")
    async def bulk(files: list[UploadFile] = File(...), mode: Literal["public", "identity"] = Form("public")):
        """Analyse several files as one batch. A file that fails does not stop the others."""
        if len(files) > int(gw["max_bulk_files"]):
            raise HTTPException(413, f"A batch holds up to {gw['max_bulk_files']} files.")
        batch_id = f"BT-{secrets.token_hex(6)}"

        async def one(upload: UploadFile) -> dict:
            try:
                return {"name": upload.filename, "ok": True, "case": summary(await analyze_upload(upload, mode, batch_id))}
            except HTTPException as exc:
                return {"name": upload.filename, "ok": False, "status": exc.status_code, "error": exc.detail}
            except Exception as exc:
                return {"name": upload.filename, "ok": False, "status": 500, "error": f"{type(exc).__name__}: {exc}"}

        results = await asyncio.gather(*[one(f) for f in files])
        done = [r["case"] for r in results if r["ok"]]
        return {
            "batch_id": batch_id,
            "total": len(results),
            "succeeded": len(done),
            "failed": len(results) - len(done),
            "labels": {label: sum(1 for c in done if c["label"] == label) for label in sorted({c["label"] for c in done})},
            "results": results,
        }

    # --------------------------------------------------------------- cases

    @app.get("/cases")
    async def list_cases(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), batch_id: str | None = None):
        total, docs = store().list_cases(500 if batch_id else limit, 0 if batch_id else offset)
        if batch_id:
            docs = [d for d in docs if d.get("batch_id") == batch_id]
            total = len(docs)
        return {"total": total, "cases": [summary(d) for d in docs]}

    @app.get("/cases/{case_id}")
    async def get_case(case_id: str):
        return load_case(case_id)

    @app.delete("/cases/{case_id}")
    async def delete_case(case_id: str):
        doc = load_case(case_id)
        shutil.rmtree(case_dir(case_id), ignore_errors=True)
        store().delete_case(case_id)
        store().append_audit(case_id, "case.deleted", "Media, artifacts and results removed. Audit entries are retained.",
                             extra={"file_sha256": doc["file"]["sha256"]})
        return {"deleted": case_id}

    @app.post("/cases/{case_id}/review")
    async def review(case_id: str, body: ReviewBody):
        load_case(case_id)
        record = {"decision": body.decision, "note": body.note.strip(), "analyst": body.analyst.strip(), "recorded_at": now_iso()}
        store().set_review(case_id, record)
        store().append_audit(case_id, "review.recorded", f"Analyst decision: {body.decision}." + (f" {record['note'][:300]}" if record["note"] else ""),
                             actor=record["analyst"], extra={"decision": body.decision})
        return load_case(case_id)

    # --------------------------------------------------------------- audit

    @app.post("/cases/{case_id}/assess")
    async def reassess(case_id: str):
        """Generate the reasoned verdict again, for example after an API key was added."""
        doc = load_case(case_id)
        if not (assessment_cfg["enabled"] and assess.available()):
            raise HTTPException(503, "Reasoned assessment is not configured. Set ANTHROPIC_API_KEY on the gateway and install the anthropic package.")
        doc.pop("audit", None)
        await add_verdict(doc)
        store().save_case(doc, int(case_id.rsplit("-", 1)[1]))
        store().append_audit(case_id, "case.sealed", "Result re-sealed after a new assessment.", extra={"result_sha256": result_digest(doc)})
        return load_case(case_id)

    @app.get("/cases/{case_id}/audit/verify")
    async def verify_case(case_id: str):
        """Recompute every hash in this case's chain and compare the stored result with its seal."""
        case_dir(case_id)
        report = store().verify_case(case_id)
        if not report["entries"]:
            raise HTTPException(404, f"No audit entries for {case_id}")
        return report

    @app.get("/audit/verify")
    async def verify_ledger():
        """Verify the ledger that links the audit entries of all cases."""
        return await asyncio.to_thread(store().verify_ledger)

    # --------------------------------------------------------------- files

    @app.get("/media/{case_id}")
    async def get_media(case_id: str):
        doc = load_case(case_id)
        path = inside(case_dir(case_id) / "media", doc["file"]["name"])
        return FileResponse(path, media_type=doc["file"]["content_type"], filename=doc["file"]["name"], content_disposition_type="inline")

    @app.get("/artifacts/{case_id}/{file_path:path}")
    async def get_artifact(case_id: str, file_path: str):
        load_case(case_id)
        path = inside(case_dir(case_id) / "artifacts", file_path)
        return FileResponse(path, media_type=media.content_type(path.name))

    # ----------------------------------------------------------- dissection

    dissect_locks: dict[str, asyncio.Lock] = {}

    async def run_dissect(case_id: str, opts: dict) -> dict:
        doc = load_case(case_id)
        if doc["media"]["media_type"] != "video":
            raise HTTPException(422, "Only video cases can be dissected into frames.")
        video = case_dir(case_id) / "media" / doc["file"]["name"]
        if not video.is_file():
            raise HTTPException(409, "The original media was not kept for this case.")
        # One extraction per case at a time: a repeated request waits and is then served from cache.
        async with dissect_locks.setdefault(case_id, asyncio.Lock()):
            try:
                result, cached = await asyncio.to_thread(
                    media.dissect, video, case_dir(case_id) / "artifacts" / "frames", f"/artifacts/{case_id}/frames", doc["media"], **opts)
            except RuntimeError as exc:
                raise HTTPException(500, str(exc))
        if not cached:
            d = result["dissection"]
            store().append_audit(case_id, "video.dissected",
                                 f"{d['extracted_count']} frames at {d['requested_fps']:g} fps from {d['start_s']:g} s to {d['end_s']:g} s.")
        return {"case_id": case_id, **result}

    @app.post("/cases/{case_id}/dissect")
    async def dissect(case_id: str, request: Request, fps: float | None = Query(None, gt=0, le=60),
                      max_frames: int | None = Query(None, ge=1, le=600), start_s: float | None = Query(None, ge=0),
                      end_s: float | None = Query(None, ge=0), quality: int | None = Query(None, ge=1, le=100)):
        try:
            body = await request.json()
        except Exception:
            body = {}
        opts = {}
        for key, value in (("fps", fps), ("max_frames", max_frames), ("start_s", start_s), ("end_s", end_s), ("quality", quality)):
            value = value if value is not None else (body.get(key) if isinstance(body, dict) else None)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                opts[key] = value
        return await run_dissect(case_id, opts)

    @app.get("/cases/{case_id}/frames/zip")
    async def frames_zip(case_id: str, fps: float = Query(2.0, gt=0, le=60)):
        result = await run_dissect(case_id, {"fps": fps})
        frames_root = case_dir(case_id) / "artifacts" / "frames"
        dest = await asyncio.to_thread(media.zip_frames, result, frames_root, frames_root / f"frames_{fps:g}fps.zip")
        return FileResponse(dest, media_type="application/zip", filename=f"{case_id}_frames_{fps:g}fps.zip")

    # ------------------------------------------------------------------ rag

    def rag_docs(case_id: str | None = None) -> list[dict]:
        docs = [load_case(case_id)] if case_id else store().list_cases(500)[1]
        return rag.documents(docs)

    @app.get("/rag/status")
    async def rag_status():
        return {"enabled": True, "retriever": rag.RETRIEVER, "documents_indexed": len(rag_docs()), "cases": store().count_cases()}

    @app.post("/rag/query")
    async def rag_query(body: RagQuery):
        return {"hits": rag.query(rag_docs(body.case_id), body.query, body.k)}

    return app


app = create_app()
