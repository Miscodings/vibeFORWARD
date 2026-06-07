"""
Underwire — FastAPI REST layer.

Endpoints:
  POST /upload                  Accept CSV, run full detection pipeline
  GET  /cases                   Return ranked case queue
  GET  /case/{id}               Return single finding detail
  POST /case/{id}/decision      Analyst Approve/Reject
  GET  /case/{id}/sar           Return / generate SAR Markdown
  POST /discover                Run Agent 0 on current data
"""
from __future__ import annotations

import os
import io
import sys
import tempfile
import json
from pathlib import Path
from typing import Literal

import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Make underwire package importable when launched from any cwd
sys.path.insert(0, str(Path(__file__).parent.parent))

from memory.store import MemoryStore
from detectors.registry import get_detectors
from detectors.base import Finding
from agents.anomaly_agent import AnomalyAgent
from agents.agent0_discovery import Agent0Discovery
from agents.explainer import Explainer
from agents.updater_agent import UpdaterAgent

# ── LLM client (optional — degrades gracefully when API key absent) ────────────
def _make_llm():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        from llm.client import LLMClient
        return LLMClient(api_key=api_key)
    except Exception:
        return None


app = FastAPI(
    title="Underwire Fraud Detection API",
    description="Self-tuning unsupervised fraud detection. Math detects; LLM explains.",
    version="1.0.0",
)

# ── Shared state ───────────────────────────────────────────────────────────────
_store = MemoryStore()
_llm   = _make_llm()
_df_store: dict[str, pd.DataFrame] = {}   # session in-memory; keyed "current"


# ── Helper ─────────────────────────────────────────────────────────────────────

def _current_df() -> pd.DataFrame:
    df = _df_store.get("current")
    if df is None:
        raise HTTPException(status_code=400, detail="No CSV uploaded yet. POST /upload first.")
    return df


# ══ Endpoints ══════════════════════════════════════════════════════════════════

@app.post("/upload", summary="Upload CSV and run detection pipeline")
async def upload(file: UploadFile = File(...)):
    """
    Accept a CSV of unlabeled bank transactions.
    Runs all detectors and stores findings.
    Returns ranked case queue.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files accepted.")

    contents = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(contents))
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df["account_open_date"] = pd.to_datetime(df["account_open_date"])
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"CSV parse error: {e}")

    _df_store["current"] = df

    agent = AnomalyAgent(store=_store)
    findings = agent.run(df)

    ranked = [f.to_dict() for f in findings]
    return {
        "status": "ok",
        "n_transactions": len(df),
        "n_findings": len(ranked),
        "n_escalated": sum(1 for f in ranked if f["action"] == "escalate"),
        "n_watch": sum(1 for f in ranked if f["action"] == "watch"),
        "cases": ranked[:50],  # top 50 in response; all stored in memory
    }


@app.get("/cases", summary="Return ranked case queue")
def get_cases(
    action: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """
    Returns all findings sorted by score descending.
    Optional ?action=escalate|watch|clear filter.
    """
    findings = _store.all_findings()
    findings.sort(key=lambda f: f.get("score", 0), reverse=True)

    if action:
        findings = [f for f in findings if f.get("action") == action]

    return {
        "total": len(findings),
        "offset": offset,
        "limit": limit,
        "cases": findings[offset : offset + limit],
    }


@app.get("/case/{case_id}", summary="Return single finding detail")
def get_case(case_id: str):
    """
    Finds a finding by cluster_id (URL-safe; replace '/' with '_').
    """
    for fd in _store.all_findings():
        if fd.get("cluster_id") == case_id or fd.get("cluster_id").replace("/", "_") == case_id:
            labels = _store.get(f"labels:{fd['cluster_id']}") or []
            return {**fd, "analyst_labels": labels}

    raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found.")


class DecisionBody(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""


@app.post("/case/{case_id}/decision", summary="Analyst Approve or Reject")
def post_decision(case_id: str, body: DecisionBody):
    """
    Record analyst decision. Automatically triggers UpdaterAgent
    if ≥20 labels have been collected.
    """
    # Verify the case exists
    found = any(
        fd.get("cluster_id") == case_id
        for fd in _store.all_findings()
    )
    if not found:
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found.")

    _store.set_label(case_id, body.decision)
    total = _store.total_label_count()

    updater_result = None
    if total >= 20:
        updater = UpdaterAgent(store=_store, llm_client=_llm)
        updater_result = updater.run()

    return {
        "status": "recorded",
        "case_id": case_id,
        "decision": body.decision,
        "total_labels": total,
        "updater": updater_result,
    }


@app.get("/case/{case_id}/sar", summary="Get or generate SAR narrative")
def get_sar(case_id: str):
    """
    Returns a downloadable Markdown SAR for the given cluster_id.
    Generates on-demand if not already created.
    """
    explainer = Explainer(store=_store, llm_client=_llm)
    md_path = explainer.generate_sar(case_id)

    if md_path is None or not Path(md_path).exists():
        raise HTTPException(
            status_code=404,
            detail=f"Could not generate SAR for '{case_id}'. Case may not exist.",
        )

    return FileResponse(
        path=md_path,
        media_type="text/markdown",
        filename=Path(md_path).name,
    )


@app.post("/discover", summary="Run Agent 0 residual pattern discovery")
def discover():
    """
    Run Agent0Discovery on the current DataFrame.
    Discovers patterns in accounts not already covered by escalate/watch findings.
    Appends new threshold detectors to the registry.
    """
    df = _current_df()
    agent0 = Agent0Discovery(store=_store, llm_client=_llm)
    patterns = agent0.run(df)

    return {
        "status": "ok",
        "n_patterns_discovered": len(patterns),
        "patterns": patterns,
    }


# ── Health check ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "has_csv": "current" in _df_store,
        "n_findings": len(_store.all_findings()),
        "n_labels": _store.total_label_count(),
        "llm_available": _llm is not None,
    }
