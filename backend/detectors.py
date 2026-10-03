"""Run one detector module: its HTTP service if it is up, otherwise in-process."""

from __future__ import annotations

import asyncio
import importlib
import re
import threading
import time
from pathlib import Path

import httpx

from .config import MODULE_DETECTORS

# Detectors report a missing weight file, repo or dependency as a zero-score finding whose
# note is the error text. Those are not evidence of a clean file.
ERROR_NOTE = re.compile(
    r"^(error\b|audio_load_error)|not found|no module named|pip install|git clone|download|traceback|errno", re.I
)
_inprocess_locks: dict[str, threading.Lock] = {}


def normalize(module: str, raw: list[dict], signal_floor: float) -> tuple[list[dict], set[str]]:
    """Convert detector findings to the gateway shape. Returns (findings, models that errored)."""
    findings, errored = [], set()
    for i, f in enumerate(raw):
        score = min(max(float(f.get("score") or 0.0), 0.0), 1.0)
        note = str(f.get("note") or "")
        model = str(f.get("model") or module)
        if score == 0.0 and ERROR_NOTE.search(note):
            kind = "error"
            errored.add(model)
        else:
            kind = "signal" if score >= signal_floor else "info"
        region = f.get("region")
        findings.append({
            "id": f"{module[:3].upper()}-{i + 1:03d}",
            "module": module,
            "model": model,
            "score": round(score, 4),
            "start": f.get("start"),
            "end": f.get("end"),
            "region": [int(v) for v in region] if region and len(region) == 4 else None,
            "note": note[:500],
            "kind": kind,
        })
    return findings, errored


async def service_up(client: httpx.AsyncClient, module: str, url: str, timeout: float = 2.0) -> bool:
    """True when the address answers as this detector module, not merely as some HTTP server."""
    try:
        resp = await client.get(f"{url}/health", timeout=timeout)
        return resp.status_code == 200 and resp.json().get("module") == module
    except (httpx.HTTPError, ValueError, AttributeError):
        return False


def _failed(status: str, detail: str, url: str, elapsed: float) -> dict:
    return {
        "info": {"status": status, "detail": detail, "url": url, "elapsed_s": round(elapsed, 3), "runtime_s": None,
                 "file_sha256": None, "weights_sha256": {}, "findings_count": 0},
        "findings": [], "artifacts": {}, "coverage": 0.0,
    }


def _run_inprocess(module: str, path: Path) -> dict:
    app = importlib.import_module(f"{module}.app")
    with _inprocess_locks.setdefault(module, threading.Lock()):
        return app.analyze(path).model_dump()


async def run_module(client: httpx.AsyncClient, module: str, url: str, path: Path, filename: str, *,
                     timeout_s: float, inprocess_fallback: bool, signal_floor: float) -> dict:
    t0 = time.monotonic()
    raw = None
    via = url

    if await service_up(client, module, url):
        try:
            with open(path, "rb") as fh:
                resp = await client.post(f"{url}/analyze", files={"file": (filename, fh)}, timeout=timeout_s)
            if resp.status_code != 200:
                # A dependency that is only imported at analysis time fails here, not at startup.
                status = "unavailable" if re.search(r"no module named", resp.text, re.I) else "error"
                return _failed(status, f"{module} service returned HTTP {resp.status_code}: {resp.text[:300]}", url, time.monotonic() - t0)
            raw = resp.json()
        except httpx.TimeoutException:
            return _failed("error", f"{module} service did not answer within {timeout_s:.0f} s", url, time.monotonic() - t0)
        except (httpx.HTTPError, ValueError) as exc:
            return _failed("error", f"{module} service call failed: {exc}", url, time.monotonic() - t0)
    elif inprocess_fallback:
        via = "in-process"
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(_run_inprocess, module, path), timeout=timeout_s)
        except ImportError as exc:
            return _failed("unavailable", f"Service offline at {url}; dependencies for in-process run are missing ({exc})", url, time.monotonic() - t0)
        except asyncio.TimeoutError:
            return _failed("error", f"In-process {module} run exceeded {timeout_s:.0f} s", url, time.monotonic() - t0)
        except Exception as exc:
            return _failed("error", f"In-process {module} run failed: {type(exc).__name__}: {exc}", url, time.monotonic() - t0)
    else:
        return _failed("unavailable", f"Service offline at {url}", url, time.monotonic() - t0)

    findings, errored = normalize(module, raw.get("findings") or [], signal_floor)
    expected = len(MODULE_DETECTORS.get(module, [])) or 1
    coverage = 1.0 - min(len(errored), expected) / expected
    usable = [f for f in findings if f["kind"] != "error"]

    if errored and not usable:
        status = "unavailable"
        detail = "No detector in this module could run: " + "; ".join(f["note"][:140] for f in findings if f["kind"] == "error")
        coverage = 0.0
    elif errored:
        status = "degraded"
        detail = f"Ran without: {', '.join(sorted(errored))}"
    else:
        status = "ok"
        signals = sum(1 for f in findings if f["kind"] == "signal")
        detail = f"{signals} signal{'s' if signals != 1 else ''}, {len(findings)} finding{'s' if len(findings) != 1 else ''} ({via})"

    return {
        "info": {
            "status": status, "detail": detail, "url": url, "elapsed_s": round(time.monotonic() - t0, 3),
            "runtime_s": raw.get("runtime_s"), "file_sha256": raw.get("file_sha256"),
            "weights_sha256": raw.get("weights_sha256") or {}, "findings_count": len(usable),
        },
        "findings": findings,
        "artifacts": raw.get("artifacts") or {},
        "coverage": round(coverage, 3),
    }
