from __future__ import annotations

from pydantic import BaseModel, Field


class Finding(BaseModel):
    model: str
    score: float = Field(ge=0.0, le=1.0)
    start: float | None = None
    end: float | None = None
    region: list[int] | None = None
    note: str = ""


class ModuleResult(BaseModel):
    module: str
    file_sha256: str
    findings: list[Finding]
    artifacts: dict[str, str] = {}
    weights_sha256: dict[str, str] = {}
    runtime_s: float
