#!/usr/bin/env python3
"""Start the Rennaigan backend: the five detector services and the gateway.

    python start.py                  # detectors on 8001-8005, gateway on 8010
    python start.py --gateway-only   # detectors run in-process or are already running elsewhere
    python start.py --host 0.0.0.0   # accept connections from other machines

A detector whose dependencies or weights are missing does not stop the others. The gateway
reports it as unavailable and leaves it out of the trust score.

A module can use its own interpreter (for example a conda env with an older PyTorch):
set services.<module>.python in config.yaml, or RENNAIGAN_PYTHON_<MODULE> in the environment.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from backend import config  # noqa: E402


def healthy(module: str, url: str) -> bool:
    """True when the address answers as this detector module, not as some other server."""
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=1) as resp:
            return resp.status == 200 and json.load(resp).get("module") == module
    except Exception:
        return False


def port_taken(port: int) -> bool:
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            if s.connect_ex((host, port)) == 0:
                return True
    return False


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gateway-only", action="store_true", help="do not start the detector services")
    parser.add_argument("--separate", action="store_true", help="one process per detector module instead of sharing")
    parser.add_argument("--host", help="gateway bind address (default from config.yaml, 127.0.0.1)")
    parser.add_argument("--port", type=int, help="gateway port (default from config.yaml, 8010)")
    args = parser.parse_args()

    os.chdir(ROOT)
    cfg = config.load()
    logs = Path(cfg["gateway"]["data_dir"]) / "logs"
    logs.mkdir(parents=True, exist_ok=True)

    children: dict[str, subprocess.Popen] = {}
    atexit.register(lambda: [p.terminate() for p in set(children.values()) if p.poll() is None])

    if not args.gateway_only:
        # Modules that use the same interpreter share one process, so shared models load once.
        groups: dict[str, list[tuple[str, int]]] = {}
        for module in config.MODULES:
            service = cfg["services"][module]
            url = urlparse(service["url"])
            if url.hostname not in ("127.0.0.1", "localhost"):
                print(f"  {module:<9} remote service at {service['url']}")
                continue
            if healthy(module, service["url"]):
                print(f"  {module:<9} already running at {service['url']}")
                continue
            port = url.port
            if port_taken(port):
                # Another program owns the configured port. Move this service and tell the gateway.
                port = free_port()
                service["url"] = f"http://127.0.0.1:{port}"
                os.environ[f"{module.upper()}_URL"] = service["url"]
                print(f"  {module:<9} port {url.port} is used by another program, using {port}")
            python = os.environ.get(f"RENNAIGAN_PYTHON_{module.upper()}") or service.get("python") or sys.executable
            key = module if args.separate else python
            groups.setdefault(key, []).append((module, port, python))

        for members in groups.values():
            names = [m for m, _, _ in members]
            log = logs / f"{'+'.join(names)}.log"
            process = subprocess.Popen(
                [members[0][2], "-m", "common.multi", *[f"{m}:{p}" for m, p, _ in members]],
                cwd=ROOT, stdout=open(log, "w"), stderr=subprocess.STDOUT,
                env={**os.environ, "MPLBACKEND": "Agg"},  # a notebook's inline backend does not exist in a service
            )
            for name in names:
                children[name] = process
                link = logs / f"{name}.log"
                if link != log:
                    link.unlink(missing_ok=True)
                    link.symlink_to(log.name)

        # Model imports can take a while. Report what is known after a short wait and carry on.
        deadline = time.time() + 25
        pending = set(children)
        while pending and time.time() < deadline:
            time.sleep(0.5)
            for module in sorted(pending):
                if children[module].poll() is not None:
                    lines = (logs / f"{module}.log").read_text().strip().splitlines()
                    print(f"  {module:<9} did not start: {lines[-1] if lines else 'no output'}  (see {logs / (module + '.log')})")
                    pending.discard(module)
                elif healthy(module, cfg["services"][module]["url"]):
                    print(f"  {module:<9} online at {cfg['services'][module]['url']}")
                    pending.discard(module)
        for module in sorted(pending):
            print(f"  {module:<9} still loading at {cfg['services'][module]['url']}")

    host = args.host or cfg["gateway"]["host"]
    port = args.port or cfg["gateway"]["port"]
    print(f"\nRennaigan gateway: http://{host}:{port}   (API docs at /docs)\n")

    import uvicorn
    uvicorn.run("backend.gateway:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
