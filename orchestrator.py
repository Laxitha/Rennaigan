"""Orchestrator client — calls all running detector services and fuses results.

This is what the main TruthFrame backend imports. It calls whichever
module services are running and aggregates their ModuleResults.

Usage:
  from orchestrator import analyze_media
  results = await analyze_media("suspect_video.mp4")
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from common.schema import ModuleResult

MODULES = {
    "image": "http://localhost:8001",
    "video": "http://localhost:8002",
    "audio": "http://localhost:8003",
    "metadata": "http://localhost:8004",
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
) -> list[ModuleResult]:
    """Analyze a media file across all available detector modules.

    Args:
        file_path: Path to the media file.
        modules: Optional list of module names to run. Defaults to all.

    Returns:
        List of ModuleResult from each responding module.
    """
    file_path = Path(file_path)
    targets = {k: v for k, v in MODULES.items() if modules is None or k in modules}

    async with httpx.AsyncClient() as client:
        tasks = [
            call_module(client, mod, url, file_path)
            for mod, url in targets.items()
        ]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for r in raw_results:
        if isinstance(r, ModuleResult):
            results.append(r)
    return results


def fuse_results(results: list[ModuleResult]) -> dict:
    """Simple fusion: aggregate findings, compute overall score."""
    all_findings = []
    all_artifacts = {}

    for r in results:
        all_findings.extend([f.model_dump() for f in r.findings])
        all_artifacts.update(r.artifacts)

    scores = [f["score"] for f in all_findings if f["score"] > 0]
    overall = max(scores) if scores else 0.0
    mean_score = sum(scores) / len(scores) if scores else 0.0

    return {
        "overall_score": overall,
        "mean_score": mean_score,
        "modules_responded": [r.module for r in results],
        "total_findings": len(all_findings),
        "findings": all_findings,
        "artifacts": all_artifacts,
    }


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python orchestrator.py <file>")
        sys.exit(1)

    results = asyncio.run(analyze_media(sys.argv[1]))
    fused = fuse_results(results)
    print(json.dumps(fused, indent=2))
