"""Import code from the cloned model repositories without their module names colliding.

The repositories use generic top-level names: TruFor and LipForensics both have a `models`
package, TruFor has `config`, the voice model has `model`. When two of them are loaded in one
process, the second `import models` returns the first repository's package. Inside this context
manager the given repository comes first on the path and any earlier modules with the same
names are set aside, then put back afterwards. The imported objects keep working, because
they hold references to their own modules.
"""

from __future__ import annotations

import sys
import threading
from contextlib import contextmanager
from pathlib import Path

_lock = threading.RLock()


@contextmanager
def repo_modules(path: Path, *names: str):
    def owned(key: str) -> bool:
        return any(key == n or key.startswith(n + ".") for n in names)

    with _lock:
        saved = {k: sys.modules.pop(k) for k in list(sys.modules) if owned(k)}
        sys.path.insert(0, str(Path(path).resolve()))
        try:
            yield
        finally:
            sys.path.remove(str(Path(path).resolve()))
            for k in [k for k in sys.modules if owned(k)]:
                del sys.modules[k]
            sys.modules.update(saved)
