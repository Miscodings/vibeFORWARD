"""
End-to-end tests through fastapi.testclient.TestClient(app).

Isolation: MEMORY_DB_PATH is pointed at a per-process temp file BEFORE the app
module is imported, so /upload and /cases share a fresh, isolated SQLite DB and
never touch the developer's underwire.db.

These tests exercise the full pipeline the way the frontend uses it and assert
the frontend<->backend contract: every case object has exactly the 10 fields.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ── Isolate the DB BEFORE importing the app (module-level _store reads env) ───
_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="underwire_e2e_"), "e2e.db")
os.environ["MEMORY_DB_PATH"] = _TMP_DB
os.environ["USE_LOCAL_MEMORY"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)  # force LLM-absent path
os.environ["CORS_ORIGINS"] = "http://localhost:3000,http://127.0.0.1:3000"

from fastapi.testclient import TestClient  # noqa: E402
from api.app import app  # noqa: E402

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "transactions.csv")

CONTRACT_FIELDS = {
    "cluster_id": str,
    "detector": str,
    "members": list,
    "score": (int, float),
    "features": dict,
    "score_breakdown": dict,
    "reason": str,
    "rules_fired": int,
    "action": str,
    "evidence_txn_ids": list,
}


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def _assert_contract(case: dict):
    assert set(case.keys()) == set(CONTRACT_FIELDS.keys()), (
        f"extra/missing fields: {set(case.keys()) ^ set(CONTRACT_FIELDS.keys())}"
    )
    for field, typ in CONTRACT_FIELDS.items():
        assert isinstance(case[field], typ), f"{field}={case[field]!r} not {typ}"
    assert all(isinstance(m, str) for m in case["members"])
    assert all(isinstance(t, str) for t in case["evidence_txn_ids"])
    assert case["action"] in ("escalate", "watch", "clear")
    # bool is a subclass of int -- guard rules_fired isn't a bool
    assert not isinstance(case["rules_fired"], bool)


@pytest.fixture(scope="module")
def uploaded(client):
    """Upload the real CSV once for the module; returns the upload response JSON."""
    with open(CSV_PATH, "rb") as fh:
        resp = client.post(
            "/upload",
            files={"file": ("transactions.csv", fh, "text/csv")},
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── (a) health ────────────────────────────────────────────────────────────────

def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "n_findings" in body
    assert body["llm_available"] is False  # no API key


# ── (b) upload + contract ─────────────────────────────────────────────────────

def test_upload_response_shape_and_contract(uploaded):
    assert uploaded["status"] == "ok"
    assert uploaded["n_transactions"] > 0
    assert uploaded["n_findings"] > 0
    assert "n_escalated" in uploaded
    assert "n_watch" in uploaded
    assert isinstance(uploaded["cases"], list)
    assert uploaded["cases"], "expected at least one case"
    for case in uploaded["cases"]:
        _assert_contract(case)


def test_upload_rejects_non_csv(client):
    resp = client.post("/upload", files={"file": ("x.txt", b"hello", "text/plain")})
    assert resp.status_code == 400


# ── (c) /cases reads persisted findings ───────────────────────────────────────

def test_cases_reflect_uploaded_findings(client, uploaded):
    resp = client.get("/cases")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == uploaded["n_findings"]
    assert "offset" in body and "limit" in body
    for case in body["cases"]:
        _assert_contract(case)
    # sorted by score descending
    scores = [c["score"] for c in body["cases"]]
    assert scores == sorted(scores, reverse=True)


def test_cases_action_filter(client, uploaded):
    resp = client.get("/cases", params={"action": "escalate"})
    assert resp.status_code == 200
    body = resp.json()
    assert all(c["action"] == "escalate" for c in body["cases"])
    assert body["total"] == uploaded["n_escalated"]


def test_cases_limit_offset(client, uploaded):
    full = client.get("/cases", params={"limit": 1000, "offset": 0}).json()
    if full["total"] >= 2:
        page = client.get("/cases", params={"limit": 1, "offset": 1}).json()
        assert len(page["cases"]) == 1
        assert page["cases"][0]["cluster_id"] == full["cases"][1]["cluster_id"]


# ── (d) /case/{id} ────────────────────────────────────────────────────────────

def _a_cluster_id(client):
    return client.get("/cases").json()["cases"][0]["cluster_id"]


def test_get_single_case(client, uploaded):
    cid = _a_cluster_id(client)
    resp = client.get(f"/case/{cid}")
    assert resp.status_code == 200
    body = resp.json()
    _assert_contract({k: body[k] for k in CONTRACT_FIELDS})
    assert "analyst_labels" in body
    assert isinstance(body["analyst_labels"], list)


def test_get_unknown_case_404(client, uploaded):
    resp = client.get("/case/this-does-not-exist-xyz")
    assert resp.status_code == 404


# ── (e) decision approve/reject persists labels ───────────────────────────────

def test_decision_records_and_persists(client, uploaded):
    cid = _a_cluster_id(client)
    before = client.get(f"/case/{cid}").json()["analyst_labels"]

    r1 = client.post(f"/case/{cid}/decision", json={"decision": "approve", "note": "looks bad"})
    assert r1.status_code == 200, r1.text
    t1 = r1.json()["total_labels"]

    r2 = client.post(f"/case/{cid}/decision", json={"decision": "reject"})
    assert r2.status_code == 200
    t2 = r2.json()["total_labels"]
    assert t2 == t1 + 1

    after = client.get(f"/case/{cid}").json()["analyst_labels"]
    assert len(after) == len(before) + 2
    assert after[-2:] == ["approve", "reject"]


def test_decision_unknown_case_404(client, uploaded):
    resp = client.post("/case/nope-xyz/decision", json={"decision": "approve"})
    assert resp.status_code == 404


def test_decision_invalid_payload_422(client, uploaded):
    cid = _a_cluster_id(client)
    resp = client.post(f"/case/{cid}/decision", json={"decision": "maybe"})
    assert resp.status_code == 422


# ── (f) discover ──────────────────────────────────────────────────────────────

def test_discover_after_upload(client, uploaded):
    resp = client.post("/discover")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert "patterns" in body
    assert isinstance(body["patterns"], list)
    assert body["n_patterns_discovered"] == len(body["patterns"])


# ── (g) SAR markdown (templated fallback when no LLM) ─────────────────────────

def test_sar_generation(client, uploaded):
    cid = _a_cluster_id(client)
    resp = client.get(f"/case/{cid}/sar")
    assert resp.status_code == 200, resp.text
    assert "markdown" in resp.headers.get("content-type", "")
    text = resp.text
    assert "SAR" in text
    assert cid in text


# ── (h) CORS preflight / origin header ────────────────────────────────────────

def test_cors_preflight(client):
    resp = client.options(
        "/cases",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    # preflight should succeed and echo the allowed origin
    assert resp.status_code in (200, 204), resp.status_code
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_cors_simple_get_has_acao_header(client):
    resp = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
