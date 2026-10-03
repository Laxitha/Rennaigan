"""Orchestrator — calls all running detector services and fuses results.

This is what the main Rennaigan backend imports. It calls whichever
module services are running, aggregates ModuleResults, and applies
calibrated fusion with temperature scaling.

Usage:
  from orchestrator import analyze_media
  results = await analyze_media("suspect_video.mp4")

  # Or CLI:
  python orchestrator.py video.mp4
  python orchestrator.py video.mp4 --mode identity
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from common.schema import ModuleResult
from common.fusion import fuse_results, load_config

MODULES = {
    "image": "http://localhost:8001",
    "video": "http://localhost:8002",
    "audio": "http://localhost:8003",
    "metadata": "http://localhost:8004",
    "motion": "http://localhost:8005",
}


async def check_health(client: httpx.AsyncClient, url: str) -> bool:
    try:
        resp = await client.get(f"{url}/health", timeout=5)
        return resp.status_code == 200
    except Exception:
        return False


async def call_module(
    client: httpx.AsyncClient, module: str, url: str, file_path: Path
) -> ModuleResult | None:
    if not await check_health(client, url):
        return None

    with open(file_path, "rb") as f:
        resp = await client.post(
            f"{url}/analyze",
            files={"file": (file_path.name, f)},
            timeout=300,
        )

    if resp.status_code == 200:
        return ModuleResult(**resp.json())
    return None


async def analyze_media(
    file_path: str | Path,
    modules: list[str] | None = None,
    mode: str = "public",
) -> dict:
    """Analyze a media file across all available detector modules.

    Args:
        file_path: Path to the media file.
        modules: Optional list of module names to run. Defaults to all.
        mode: "public" or "identity" (KYC mode with reference voice/face).

    Returns:
        Fused result dict with trust_score, label, findings, etc.
    """
    file_path = Path(file_path)
    targets = {k: v for k, v in MODULES.items() if modules is None or k in modules}

    async with httpx.AsyncClient() as client:
        tasks = [
            call_module(client, mod, url, file_path)
            for mod, url in targets.items()
        ]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = [r for r in raw_results if isinstance(r, ModuleResult)]
    config = load_config()

    return fuse_results(results, mode=mode, config=config)


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python orchestrator.py <file> [--mode public|identity]")
        sys.exit(1)

    file_path = sys.argv[1]
    mode = "public"
    if "--mode" in sys.argv:
        idx = sys.argv.index("--mode")
        if idx + 1 < len(sys.argv):
            mode = sys.argv[idx + 1]

    result = asyncio.run(analyze_media(file_path, mode=mode))
    print(json.dumps(result, indent=2))
