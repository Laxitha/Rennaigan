from __future__ import annotations

import functools
import hashlib
import os
from pathlib import Path


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@functools.lru_cache(maxsize=None)
def _weights_sha256(path: str, mtime_ns: int, size: int) -> str:
    return file_sha256(path)


def weights_sha256(path: str | Path) -> str:
    """SHA-256 of a weight file, hashed once per file version rather than on every request."""
    stat = os.stat(path)
    return _weights_sha256(str(path), stat.st_mtime_ns, stat.st_size)
