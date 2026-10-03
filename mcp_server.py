#!/usr/bin/env python3
"""Rennaigan MCP (Model Context Protocol) Server & FastMCP Provider.

Exposes Rennaigan's multi-modal deepfake detection microservices and fused orchestrator
as standard Model Context Protocol (MCP) tools for LLMs, AI agents, and web applications.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

# Import orchestrator
sys.path.insert(0, str(Path(__file__).parent))
from orchestrator import analyze_media, MODULES, check_health

app = FastAPI(
    title="Rennaigan MCP & API Gateway",
    description="MCP Server & REST API for Rennaigan ML Detectors (Image, Video, Audio, Metadata, Motion)",
    version="1.0.0",
)

# Enable CORS for easy integration into web apps
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def download_remote_file(url: str) -> Path:
    """Download a file from a remote URL to a temporary local path."""
    suffix = Path(url.split("?")[0]).suffix or ".tmp"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    req = urllib.request.Request(url, headers={"User-Agent": "Rennaigan-MCP/1.0"})
    with urllib.request.urlopen(req) as resp, open(tmp.name, "wb") as out:
        out.write(resp.read())
    return Path(tmp.name)


@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Rennaigan Deepfake Detection MCP & REST Gateway",
        "endpoints": {
            "orchestrator_analyze": "/analyze",
            "mcp_tools": "/mcp/tools",
            "mcp_call": "/mcp/call",
            "mcp_sse": "/mcp/sse",
            "health": "/health",
            "docs": "/docs",
        },
        "modules": list(MODULES.keys()),
    }


@app.get("/health")
async def health_check():
    async with httpx.AsyncClient() as client:
        statuses = {}
        for mod, url in MODULES.items():
            statuses[mod] = await check_health(client, url)
    return {
        "orchestrator": "ok",
        "modules": statuses,
        "all_healthy": all(statuses.values()),
    }


@app.post("/analyze")
async def analyze_endpoint(
    request: Request,
    mode: str = "public",
):
    """REST endpoint to analyze media uploaded via multipart/form-data or JSON body with URL."""
    tmp_path: Optional[Path] = None
    try:
        content_type = request.headers.get("content-type", "")
        if "multipart/form-data" in content_type:
            form = await request.form()
            file_obj = form.get("file")
            if not file_obj or not hasattr(file_obj, "filename"):
                raise HTTPException(status_code=400, detail="Missing file parameter in multipart form")
            
            suffix = Path(file_obj.filename).suffix or ".tmp"
            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            content = await file_obj.read()
            with open(tmp.name, "wb") as f:
                f.write(content)
            tmp_path = Path(tmp.name)
        else:
            body = await request.json()
            file_url = body.get("file_url") or body.get("url") or body.get("path")
            if not file_url:
                raise HTTPException(status_code=400, detail="Provide 'file' upload or 'file_url' in JSON")
            if file_url.startswith("http://") or file_url.startswith("https://"):
                tmp_path = download_remote_file(file_url)
            else:
                tmp_path = Path(file_url)

        if not tmp_path.exists():
            raise HTTPException(status_code=404, detail="File path invalid or failed to download")

        result = await analyze_media(tmp_path, mode=mode)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if tmp_path and tmp_path.exists() and "tmp" in tmp_path.name:
            tmp_path.unlink(missing_ok=True)


# --- MCP Protocol Tool Definitions ---
MCP_TOOLS = [
    {
        "name": "analyze_media",
        "description": "Run full multi-modal deepfake detection (Image, Video, Audio, Metadata, Motion) with score fusion.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of media file"},
                "mode": {"type": "string", "enum": ["public", "identity"], "default": "public"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "analyze_image",
        "description": "Run image deepfake and splicing detectors (SBI, UnivFD, TruFor).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of image"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "analyze_video",
        "description": "Run video deepfake detectors (SBI frame scoring, LipForensics, SyncNet).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of video"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "analyze_audio",
        "description": "Run audio deepfake and voice spoofing detectors (SSL-AASIST, ECAPA-TDNN).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of audio clip"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "analyze_metadata",
        "description": "Extract & analyze EXIF, FFprobe, and C2PA metadata for manipulation signals.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of media"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "analyze_motion",
        "description": "Analyze temporal motion, optical flow, head pose, and facial dynamics for deepfake traces.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path_or_url": {"type": "string", "description": "Local file path or HTTPS URL of video"},
            },
            "required": ["file_path_or_url"],
        },
    },
    {
        "name": "get_system_health",
        "description": "Check health status of all 5 ML detection microservices and orchestrator.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


@app.get("/mcp/tools")
async def get_mcp_tools():
    """List available MCP tools."""
    return {"tools": MCP_TOOLS}


@app.post("/mcp/call")
async def call_mcp_tool(request: Request):
    """Execute an MCP tool by name."""
    body = await request.json()
    tool_name = body.get("name")
    args = body.get("arguments", {})

    if tool_name == "get_system_health":
        health = await health_check()
        return {"result": health}

    file_ref = args.get("file_path_or_url")
    if not file_ref and tool_name != "get_system_health":
        raise HTTPException(status_code=400, detail="Missing required argument 'file_path_or_url'")

    tmp_path: Optional[Path] = None
    if file_ref.startswith("http://") or file_ref.startswith("https://"):
        tmp_path = download_remote_file(file_ref)
    else:
        tmp_path = Path(file_ref)

    if not tmp_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_ref}")

    try:
        if tool_name == "analyze_media":
            res = await analyze_media(tmp_path, mode=args.get("mode", "public"))
        elif tool_name in ("analyze_image", "analyze_video", "analyze_audio", "analyze_metadata", "analyze_motion"):
            mod = tool_name.replace("analyze_", "")
            res = await analyze_media(tmp_path, modules=[mod])
        else:
            raise HTTPException(status_code=404, detail=f"Unknown tool: {tool_name}")
        return {"result": res}
    finally:
        if tmp_path and tmp_path.exists() and "tmp" in tmp_path.name:
            tmp_path.unlink(missing_ok=True)


@app.get("/mcp/sse")
async def mcp_sse_endpoint():
    """MCP Server-Sent Events (SSE) channel for streaming MCP events."""
    async def event_generator():
        init_event = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {"meta": {"server": "Rennaigan MCP Server v1.0"}},
        }
        yield f"event: endpoint\ndata: /mcp/call\n\n"
        yield f"event: message\ndata: {json.dumps(init_event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"🚀 Starting Rennaigan MCP Server & Gateway on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
