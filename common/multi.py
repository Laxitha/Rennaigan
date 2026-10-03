"""Serve several detector modules from one process, each on its own port.

    python -m common.multi image:8001 video:8002 motion:8005 metadata:8004

The image, video and motion modules share models (the face-swap network, the AI-image
classifiers, the face detector). As separate processes each loaded its own copy and its own
GPU context; in one process every model is loaded once. Each module keeps its own port and
/health, so the gateway does not see a difference.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import traceback

import uvicorn


async def main(specs: list[str]) -> None:
    servers = []
    for spec in specs:
        module, _, port = spec.partition(":")
        try:
            app = importlib.import_module(f"{module}.app").app
        except Exception:
            # One module missing a dependency must not take the others down.
            print(f"[{module}] not started:", flush=True)
            traceback.print_exc()
            continue
        servers.append(uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=int(port), log_level="info")))
        print(f"[{module}] serving on port {port}", flush=True)
    if not servers:
        sys.exit("no module could be started")
    for server in servers[1:]:
        server.install_signal_handlers = lambda: None  # only one server may own the process signals
    await asyncio.gather(*(server.serve() for server in servers))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
