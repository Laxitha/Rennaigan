#!/usr/bin/env python3
"""Run and check the backend on Colab.

    python scripts/colab.py restart    stop everything, start services + gateway, wait until ready
    python scripts/colab.py status     which services answer, and the log tail of those that do not
    python scripts/colab.py selftest   analyse the bundled talking-head clip, frame and voice

The notebook calls this script, so `git pull` is enough to pick up fixes: the notebook cells
themselves do not change when the repository does.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = "http://127.0.0.1:8010"
LOG = Path("/content/backend.log") if Path("/content").is_dir() else ROOT / "data" / "backend.log"
AUDIO_PYTHON = Path("/content/audio-env/bin/python")
MODULES = ["image", "video", "audio", "metadata", "motion"]


def get(path: str, timeout: float = 5):
    with urllib.request.urlopen(f"{GATEWAY}{path}", timeout=timeout) as resp:
        return json.load(resp)


def stop() -> None:
    out = subprocess.run(["ps", "-eo", "pid,args"], capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        pid, _, args = line.strip().partition(" ")
        # Only Python processes: a shell whose command line merely mentions start.py is not the backend.
        if int(pid) != os.getpid() and "python" in args.split(" ")[0] and ("start.py" in args or "common.multi" in args or (".app:app" in args and "uvicorn" in args) or "backend.gateway" in args):
            try:
                os.kill(int(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
    time.sleep(2)


def status() -> bool:
    try:
        health = get("/health")
    except Exception as exc:
        print(f"Gateway is not answering ({exc}). Last lines of {LOG}:")
        print("".join(LOG.read_text().splitlines(keepends=True)[-25:]) if LOG.exists() else "  (no log)")
        return False
    print(f"gateway v{health['gateway']['version']}: {health['services_up']}/{health['services_total']} services, "
          f"{health['gateway']['cases']} cases, reasoned assessment: {health.get('assessment', 'not in this gateway version')}")
    for name, service in health["services"].items():
        print(f"  {'online ' if service['ok'] else 'OFFLINE'} {name:<9} {service['url']}")
        log = ROOT / "data" / "logs" / f"{name}.log"
        if not service["ok"] and log.exists():
            for line in log.read_text().splitlines()[-12:]:
                print(f"            | {line[:220]}")
    return health["services_up"] == health["services_total"]


def restart() -> None:
    stop()
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    if AUDIO_PYTHON.exists():
        env["RENNAIGAN_PYTHON_AUDIO"] = str(AUDIO_PYTHON)
    print("Claude assessment key:", "present" if env.get("ANTHROPIC_API_KEY") else "not set (rule-based verdict only)")
    LOG.parent.mkdir(parents=True, exist_ok=True)
    # start_new_session: the backend must outlive the notebook cell that launched it
    subprocess.Popen([sys.executable, "start.py"], cwd=ROOT, env=env, stdout=open(LOG, "w"), stderr=subprocess.STDOUT,
                     start_new_session=True)
    deadline = time.time() + 420
    while time.time() < deadline:
        time.sleep(4)
        try:
            health = get("/health")
        except Exception:
            continue
        if health["services_up"] == health["services_total"]:
            break
    status()


def selftest() -> None:
    import requests

    sample = ROOT / "repos/syncnet/data/example.avi"
    out = Path("/content") if Path("/content").is_dir() else ROOT / "data"
    ff = ["ffmpeg", "-y", "-loglevel", "error"]
    subprocess.run(ff + ["-i", str(sample), "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out / "test_clip.mp4")])
    subprocess.run(ff + ["-ss", "2", "-i", str(sample), "-frames:v", "1", "-q:v", "2", str(out / "test_frame.jpg")])
    subprocess.run(ff + ["-i", str(sample), "-t", "12", "-vn", "-ar", "16000", "-ac", "1", str(out / "test_voice.wav")])

    for name in ("test_frame.jpg", "test_voice.wav", "test_clip.mp4"):
        with open(out / name, "rb") as f:
            res = requests.post(f"{GATEWAY}/analyze", files={"file": (name, f)}, timeout=1800)
        case = res.json()
        if "id" not in case:
            print(name, "->", res.status_code, case)
            continue
        verdict = case.get("verdict") or {}
        print(f"\n=== {name} -> {str(verdict.get('verdict')).upper()} at {verdict.get('confidence')}% ({verdict.get('source')}), "
              f"trust {case['trust_score']}, evidence {case['evidence_weight']:.0%}, {case['runtime_s']} s")
        print("   ", verdict.get("headline"))
        if case.get("assessment_error"):
            print("    assessment error:", case["assessment_error"])
        for module, info in case["modules"].items():
            print(f"  [{info['status']:<13}] {module:<9} {info.get('elapsed_s')} s  per detector: {info.get('detector_runtime_s') or '-'}")
            print(f"        {(info.get('detail') or '')[:400]}")
        groups: dict = {}
        for f in case["findings"]:
            groups.setdefault((f["module"], f["model"], f["kind"]), []).append(f)
        for (module, model, kind), fs in groups.items():
            top = max(fs, key=lambda f: f["score"])
            print(f"      {module}/{model:<14} {kind:<6} n={len(fs):<3} max={top['score']:.3f}  {top['note'][:170]}")
        print("   artifacts:", [a["name"] for a in case["artifacts"] if a["available"]])
    print("\nThis clip is a genuine recording: the verdict should be REAL with low detector scores.")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"restart": restart, "status": status, "stop": stop, "selftest": selftest}.get(command, status)()
