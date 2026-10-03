"""SQLite case store and tamper-evident audit ledger.

Every audit entry is sealed three ways:
  entry_hash = SHA-256(prev_hash + canonical(entry))   per-case chain, verifiable from an export
  chain_hash = SHA-256(chain_prev + entry_hash)        one chain across all cases, so removing
                                                       or reordering entries leaves a gap
  sig        = HMAC-SHA256(ledger key, chain_hash)     rewriting the chain needs the key file

Audit rows are never deleted. Deleting a case removes its media and results and appends a
"case.deleted" entry.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

GENESIS = "0" * 64

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    n INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    gseq INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    actor TEXT NOT NULL,
    duration_ms INTEGER,
    extra TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    chain_prev TEXT NOT NULL,
    chain_hash TEXT NOT NULL,
    sig TEXT NOT NULL,
    UNIQUE (case_id, seq)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def result_digest(doc: dict) -> str:
    """Digest of the stored analysis result. The analyst review is recorded separately."""
    return sha256_hex(canonical({k: v for k, v in doc.items() if k not in ("review", "audit")}))


def _entry_body(row) -> dict:
    return {
        "case_id": row["case_id"],
        "seq": row["seq"],
        "timestamp": row["timestamp"],
        "action": row["action"],
        "detail": row["detail"],
        "actor": row["actor"],
        "duration_ms": row["duration_ms"],
        "extra": json.loads(row["extra"]) if isinstance(row["extra"], str) else row["extra"],
    }


def entry_hash(prev_hash: str, body: dict) -> str:
    return sha256_hex(prev_hash.encode() + canonical(body))


class Store:
    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.data_dir / "rennaigan.db", check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._key = self._load_key()

    def _load_key(self) -> bytes:
        path = self.data_dir / "ledger.key"
        if not path.exists():
            path.write_bytes(secrets.token_bytes(32))
            path.chmod(0o600)
        return path.read_bytes()

    def _sign(self, chain_hash: str) -> str:
        return hmac.new(self._key, chain_hash.encode(), hashlib.sha256).hexdigest()

    # ------------------------------------------------------------------ cases

    def new_case_id(self) -> tuple[str, int]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            row = self._db.execute("SELECT value FROM meta WHERE key='case_counter'").fetchone()
            n = int(row["value"]) + 1 if row else 1
            self._db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('case_counter', ?)", (str(n),))
            self._db.execute("COMMIT")
        return f"RG-{datetime.now(timezone.utc).year}-{n:05d}", n

    def save_case(self, doc: dict, n: int) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO cases (id, n, created_at, doc) VALUES (?, ?, ?, ?)",
                (doc["id"], n, doc["created_at"], json.dumps(doc)),
            )

    def _raw_case(self, case_id: str) -> dict | None:
        row = self._db.execute("SELECT doc FROM cases WHERE id=?", (case_id,)).fetchone()
        return json.loads(row["doc"]) if row else None

    def get_case(self, case_id: str) -> dict | None:
        with self._lock:
            doc = self._raw_case(case_id)
            if doc is not None:
                doc["audit"] = self.audit_for(case_id)
            return doc

    def list_cases(self, limit: int = 100, offset: int = 0) -> tuple[int, list[dict]]:
        with self._lock:
            total = self._db.execute("SELECT COUNT(*) AS c FROM cases").fetchone()["c"]
            rows = self._db.execute("SELECT doc FROM cases ORDER BY n DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        return total, [json.loads(r["doc"]) for r in rows]

    def count_cases(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) AS c FROM cases").fetchone()["c"]

    def set_review(self, case_id: str, review: dict) -> bool:
        with self._lock:
            doc = self._raw_case(case_id)
            if doc is None:
                return False
            doc["review"] = review
            self._db.execute("UPDATE cases SET doc=? WHERE id=?", (json.dumps(doc), case_id))
            return True

    def delete_case(self, case_id: str) -> bool:
        with self._lock:
            return self._db.execute("DELETE FROM cases WHERE id=?", (case_id,)).rowcount > 0

    # ------------------------------------------------------------------ audit

    def append_audit(self, case_id: str, action: str, detail: str, actor: str = "gateway",
                     duration_ms: int | None = None, extra: dict | None = None) -> dict:
        extra = {k: str(v) for k, v in (extra or {}).items()}
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                last = self._db.execute(
                    "SELECT seq, entry_hash FROM audit WHERE case_id=? ORDER BY seq DESC LIMIT 1", (case_id,)
                ).fetchone()
                tail = self._db.execute("SELECT chain_hash FROM audit ORDER BY gseq DESC LIMIT 1").fetchone()
                body = {
                    "case_id": case_id,
                    "seq": (last["seq"] + 1) if last else 1,
                    "timestamp": now_iso(),
                    "action": action,
                    "detail": detail,
                    "actor": actor,
                    "duration_ms": duration_ms,
                    "extra": extra,
                }
                prev_hash = last["entry_hash"] if last else GENESIS
                e_hash = entry_hash(prev_hash, body)
                chain_prev = tail["chain_hash"] if tail else GENESIS
                chain_hash = sha256_hex((chain_prev + e_hash).encode())
                self._db.execute(
                    "INSERT INTO audit (case_id, seq, timestamp, action, detail, actor, duration_ms, extra,"
                    " prev_hash, entry_hash, chain_prev, chain_hash, sig) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (case_id, body["seq"], body["timestamp"], action, detail, actor, duration_ms,
                     json.dumps(extra), prev_hash, e_hash, chain_prev, chain_hash, self._sign(chain_hash)),
                )
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise
        return {**body, "prev_hash": prev_hash, "entry_hash": e_hash}

    def audit_for(self, case_id: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM audit WHERE case_id=? ORDER BY seq", (case_id,)).fetchall()
        return [{**_entry_body(r), "prev_hash": r["prev_hash"], "entry_hash": r["entry_hash"],
                 "input_hash": None, "output_hash": None} for r in rows]

    def _check_row(self, row, expected_prev: str | None) -> str | None:
        """Return a description of what is wrong with one audit row, or None."""
        if expected_prev is not None and row["prev_hash"] != expected_prev:
            return "does not link to the previous entry"
        if entry_hash(row["prev_hash"], _entry_body(row)) != row["entry_hash"]:
            return "content does not match its hash"
        if sha256_hex((row["chain_prev"] + row["entry_hash"]).encode()) != row["chain_hash"]:
            return "ledger hash does not match"
        if not hmac.compare_digest(self._sign(row["chain_hash"]), row["sig"]):
            return "ledger signature is invalid"
        return None

    def verify_case(self, case_id: str) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT * FROM audit WHERE case_id=? ORDER BY seq", (case_id,)).fetchall()
            doc = self._raw_case(case_id)
        problems: list[dict] = []
        prev = GENESIS
        for i, row in enumerate(rows):
            if row["seq"] != i + 1:
                problems.append({"seq": row["seq"], "problem": f"expected entry {i + 1}, an entry is missing"})
            problem = self._check_row(row, prev)
            if problem:
                problems.append({"seq": row["seq"], "problem": problem})
            prev = row["entry_hash"]

        sealed = next((r for r in reversed(rows) if r["action"] == "case.sealed"), None)
        result_matches = None
        if doc is not None:
            result_matches = bool(sealed) and json.loads(sealed["extra"]).get("result_sha256") == result_digest(doc)
            if not result_matches:
                problems.append({"seq": sealed["seq"] if sealed else None,
                                 "problem": "stored analysis result does not match the sealed digest"})
        return {
            "case_id": case_id,
            "intact": bool(rows) and not problems,
            "entries": len(rows),
            "broken_at": problems[0]["seq"] if problems else None,
            "problems": problems,
            "head_hash": rows[-1]["entry_hash"] if rows else None,
            "result_matches_seal": result_matches,
            "verified_at": now_iso(),
        }

    def verify_ledger(self) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT * FROM audit ORDER BY gseq").fetchall()
        problems: list[dict] = []
        chain_prev = GENESIS
        for row in rows:
            problem = self._check_row(row, None)
            if not problem and row["chain_prev"] != chain_prev:
                problem = "ledger gap: an earlier entry was removed or reordered"
            if problem:
                problems.append({"gseq": row["gseq"], "case_id": row["case_id"], "seq": row["seq"], "problem": problem})
            chain_prev = row["chain_hash"]
        return {
            "intact": not problems,
            "entries": len(rows),
            "cases": len({r["case_id"] for r in rows}),
            "problems": problems[:50],
            "head_hash": rows[-1]["chain_hash"] if rows else None,
            "verified_at": now_iso(),
        }
