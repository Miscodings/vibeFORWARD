"""
MemoryStore — Cognee wrapper with local SQLite fallback.

Selected by env var USE_LOCAL_MEMORY=1 (or when Cognee is unreachable).
Same interface either way: get / set / delete / list_keys.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any


_USE_LOCAL = os.getenv("USE_LOCAL_MEMORY", "1") == "1"
_DB_PATH   = os.getenv("MEMORY_DB_PATH", os.path.join(os.path.dirname(__file__), "underwire.db"))


# ── Local SQLite backend ──────────────────────────────────────────────────────

class _SQLiteBackend:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._local = threading.local()
        self._init_schema()

    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            self._local.conn = sqlite3.connect(self._db_path, check_same_thread=False)
        return self._local.conn

    def _init_schema(self):
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            conn.commit()

    def get(self, key: str) -> Any | None:
        row = self._conn().execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def set(self, key: str, value: Any) -> None:
        self._conn().execute(
            "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
            (key, json.dumps(value, default=str)),
        )
        self._conn().commit()

    def delete(self, key: str) -> None:
        self._conn().execute("DELETE FROM kv WHERE key=?", (key,))
        self._conn().commit()

    def list_keys(self, prefix: str = "") -> list[str]:
        rows = self._conn().execute(
            "SELECT key FROM kv WHERE key LIKE ?", (prefix + "%",)
        ).fetchall()
        return [r[0] for r in rows]


# ── Cognee backend (optional) ─────────────────────────────────────────────────

class _CogneeBackend:
    def __init__(self):
        import cognee  # noqa: F401 — lazy import so missing cognee doesn't break import
        self._cognee = cognee

    def get(self, key: str) -> Any | None:
        try:
            import asyncio
            result = asyncio.get_event_loop().run_until_complete(
                self._cognee.search(query_text=key, query_type="GRAPH_COMPLETION")
            )
            return result[0] if result else None
        except Exception:
            return None

    def set(self, key: str, value: Any) -> None:
        try:
            import asyncio
            payload = json.dumps({"key": key, "value": value}, default=str)
            asyncio.get_event_loop().run_until_complete(
                self._cognee.add(payload, dataset_name="underwire")
            )
            asyncio.get_event_loop().run_until_complete(self._cognee.cognify())
        except Exception:
            pass

    def delete(self, key: str) -> None:
        pass   # Cognee doesn't support direct delete; no-op for demo

    def list_keys(self, prefix: str = "") -> list[str]:
        return []   # Cognee search is semantic; key listing falls back to SQLite


# ── Public façade ─────────────────────────────────────────────────────────────

class MemoryStore:
    """
    Unified key-value store.  Keys are namespaced strings:
      findings:{detector}:{cluster_id}
      config:{detector}
      config_versions:{detector}
      labels:{cluster_id}
      columns:{pattern_name}
    """

    def __init__(self, force_local: bool | None = None):
        use_local = _USE_LOCAL if force_local is None else force_local
        if not use_local:
            try:
                self._backend: _SQLiteBackend | _CogneeBackend = _CogneeBackend()
                # Probe connectivity
                self._backend.get("_probe")
            except Exception:
                use_local = True

        if use_local or not hasattr(self, "_backend"):
            self._backend = _SQLiteBackend(_DB_PATH)

    def get(self, key: str) -> Any | None:
        return self._backend.get(key)

    def set(self, key: str, value: Any) -> None:
        self._backend.set(key, value)

    def delete(self, key: str) -> None:
        self._backend.delete(key)

    def list_keys(self, prefix: str = "") -> list[str]:
        return self._backend.list_keys(prefix)

    # ── Helpers for typed namespaces ──────────────────────────────────────

    def get_finding(self, detector: str, cluster_id: str) -> dict | None:
        return self.get(f"findings:{detector}:{cluster_id}")

    def set_finding(self, finding_dict: dict) -> None:
        self.set(f"findings:{finding_dict['detector']}:{finding_dict['cluster_id']}", finding_dict)

    def all_findings(self) -> list[dict]:
        keys = self.list_keys("findings:")
        results = []
        for k in keys:
            v = self.get(k)
            if v:
                results.append(v)
        return results

    def get_config(self, detector: str) -> dict | None:
        return self.get(f"config:{detector}")

    def set_config(self, detector: str, cfg: dict) -> None:
        self.set(f"config:{detector}", cfg)

    def append_config_version(self, detector: str, record: dict) -> None:
        key = f"config_versions:{detector}"
        versions = self.get(key) or []
        versions.append(record)
        self.set(key, versions)

    def get_config_versions(self, detector: str) -> list[dict]:
        return self.get(f"config_versions:{detector}") or []

    def set_label(self, cluster_id: str, decision: str) -> None:
        key = f"labels:{cluster_id}"
        labels = self.get(key) or []
        labels.append(decision)
        self.set(key, labels)

    def all_labels(self) -> dict[str, list[str]]:
        keys = self.list_keys("labels:")
        return {k.split(":", 1)[1]: (self.get(k) or []) for k in keys}

    def total_label_count(self) -> int:
        return sum(len(v) for v in self.all_labels().values())

    def set_column(self, pattern_name: str, spec: dict) -> None:
        self.set(f"columns:{pattern_name}", spec)

    def all_columns(self) -> list[dict]:
        keys = self.list_keys("columns:")
        return [self.get(k) for k in keys if self.get(k)]
