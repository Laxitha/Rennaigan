"""Shared FastAPI factory — each module calls create_app() with its analyzer."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Awaitable

from fastapi import FastAPI, File, UploadFile, HTTPException

from .schema import ModuleResult

_WARMUP_LOCK = threading.Lock()


def create_app(
    module_name: str,
    analyze_fn: Callable[[Path], Awaitable[ModuleResult] | ModuleResult],
    warmup: Callable[[], None] | None = None,
) -> FastAPI:
    """`warmup` loads the models in the background at startup, so the first upload does not pay for it."""
    state = {"ready": warmup is None}

    def _warm():
        # One at a time: modules sharing a process share models, and loading them
        # concurrently would load some twice.
        with _WARMUP_LOCK:
            try:
                warmup()
            finally:
                state["ready"] = True

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if warmup is not None:
            threading.Thread(target=_warm, daemon=True).start()
        yield

    app = FastAPI(title=f"Rennaigan — {module_name}", lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "ok", "module": module_name, "ready": state["ready"]}

    @app.post("/analyze", response_model=ModuleResult)
    async def analyze(file: UploadFile = File(...)):
        suffix = Path(file.filename or "input").suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = Path(tmp.name)
        try:
            # Worker thread: /health keeps answering while a long analysis runs.
            result = await asyncio.to_thread(analyze_fn, tmp_path)
            if hasattr(result, "__await__"):
                result = await result
            return result
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        finally:
            tmp_path.unlink(missing_ok=True)

    return app
