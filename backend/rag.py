"""Lexical (BM25) retrieval over stored cases, for grounding explanations in real findings."""

from __future__ import annotations

import math
import re
from collections import Counter

RETRIEVER = "bm25"
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower().replace("_", " "))


def documents(cases: list[dict]) -> list[dict]:
    docs = []
    for c in cases:
        media = c.get("media", {})
        docs.append({
            "id": f"{c['id']}:summary", "case_id": c["id"], "kind": "summary",
            "text": f"Case {c['id']}: {c['file']['name']} ({media.get('media_type')}). Label: {c['label']}. "
                    f"Trust score: {c.get('trust_score')}. {c.get('label_reason') or ''}",
            "metadata": {"trust_score": c.get("trust_score"), "label": c["label"], "created_at": c["created_at"]},
        })
        for f in c.get("findings", []):
            if f["kind"] == "error":
                continue
            span = f" from {f['start']}s to {f['end']}s" if f.get("start") is not None else ""
            docs.append({
                "id": f"{c['id']}:{f['id']}", "case_id": c["id"], "kind": "finding",
                "text": f"{f['module']} module, {f['model']} detector, score {f['score']:.2f}{span}: {f['note']}",
                "metadata": {"module": f["module"], "model": f["model"], "score": f["score"]},
            })
        if c.get("review"):
            r = c["review"]
            docs.append({
                "id": f"{c['id']}:review", "case_id": c["id"], "kind": "review",
                "text": f"Analyst {r['analyst']} decision {r['decision']}: {r['note']}",
                "metadata": {"decision": r["decision"], "recorded_at": r["recorded_at"]},
            })
    return docs


def query(docs: list[dict], text: str, k: int = 5, k1: float = 1.5, b: float = 0.75) -> list[dict]:
    terms = _tokens(text)
    if not docs or not terms:
        return []
    tokenized = [_tokens(d["text"]) for d in docs]
    avg_len = sum(len(t) for t in tokenized) / len(tokenized)
    df = Counter(term for toks in tokenized for term in set(toks))
    hits = []
    for doc, toks in zip(docs, tokenized):
        tf = Counter(toks)
        score = 0.0
        for term in terms:
            if term not in tf:
                continue
            idf = math.log(1 + (len(docs) - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(toks) / avg_len))
        if score > 0:
            hits.append({"score": round(score, 4), **doc})
    return sorted(hits, key=lambda h: h["score"], reverse=True)[:k]
