"""Shared FastAPI factory — each module calls create_app() with its analyzer."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Callable, Awaitable

from fastapi import FastAPI, File, UploadFile, HTTPException

from .schema import ModuleResult


def create_app(
    module_name: str,
    analyze_fn: Callable[[Path], Awaitable[ModuleResult] | ModuleResult],
) -> FastAPI:
    app = FastAPI(title=f"TruthFrame — {module_name}")

    @app.get("/health")
    async def health():
        return {"status": "ok", "module": module_name}

    @app.post("/analyze", response_model=ModuleResult)
    async def analyze(file: UploadFile = File(...)):
        suffix = Path(file.filename or "input").suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = Path(tmp.name)
        try:
            result = analyze_fn(tmp_path)
            if hasattr(result, "__await__"):
                result = await result
            return result
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        finally:
            tmp_path.unlink(missing_ok=True)

    return app
