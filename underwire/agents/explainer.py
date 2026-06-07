"""
Explainer — generates SAR narratives from Findings.

Philosophy: Math detects/scores, LLM only explains.
The hallucination guard rejects any LLM output whose numeric tokens
are not a subset of the numbers present in the input JSON.
"""
from __future__ import annotations

import json
import re
import os
from datetime import datetime, timezone
from pathlib import Path

from memory.store import MemoryStore

_SAR_DIR = Path(__file__).parent.parent / "output" / "sar"

_GEODO_STUB = {
    "classification": "potential_money_laundering",
    "legal_refs": ["31 U.S.C. § 5318(g)", "FinCEN FIN-2014-A007"],
    "filing_obligation": "File SAR within 30 days of detection",
}


def _extract_numbers(text: str) -> set[str]:
    """Return all numeric tokens (int and float) found in text."""
    return set(re.findall(r"\b\d+(?:\.\d+)?\b", text))


def _input_numbers(payload: dict) -> set[str]:
    """Flatten all numeric tokens from the input JSON."""
    raw = json.dumps(payload)
    return _extract_numbers(raw)


def _verify_no_hallucinated_numbers(narrative: str, input_json: dict) -> tuple[bool, set[str]]:
    """
    Returns (ok, hallucinated_numbers).
    A hallucinated number is one that appears in the narrative
    but is NOT present anywhere in the input JSON.
    """
    allowed = _input_numbers(input_json)
    used    = _extract_numbers(narrative)
    bad     = used - allowed
    return (len(bad) == 0, bad)


def _build_sar_payload(finding: dict) -> dict:
    """Compact payload sent to LLM — no raw transactions, only summary stats."""
    return {
        "cluster_id":        finding.get("cluster_id"),
        "detector":          finding.get("detector"),
        "score":             finding.get("score"),
        "action":            finding.get("action"),
        "members":           finding.get("members", []),
        "n_members":         len(finding.get("members", [])),
        "reason":            finding.get("reason"),
        "rules_fired":       finding.get("rules_fired"),
        "score_breakdown":   finding.get("score_breakdown", {}),
        "features":          finding.get("features", {}),
        "n_evidence_txns":   len(finding.get("evidence_txn_ids", [])),
        "geodo_context":     _GEODO_STUB,
        "generated_at_utc":  datetime.now(timezone.utc).isoformat(),
    }


class Explainer:
    def __init__(
        self,
        store: MemoryStore | None = None,
        llm_client=None,
        max_regenerations: int = 2,
    ):
        self.store = store or MemoryStore()
        self.llm = llm_client
        self.max_regenerations = max_regenerations
        _SAR_DIR.mkdir(parents=True, exist_ok=True)

    def generate_sar(self, cluster_id: str) -> str | None:
        """
        Generate SAR narrative for a cluster, with hallucination guard.
        Returns path to the saved Markdown file, or None if LLM unavailable.
        """
        finding = self._load_finding(cluster_id)
        if finding is None:
            return None

        payload = _build_sar_payload(finding)

        if self.llm is None:
            narrative = self._fallback_narrative(payload)
        else:
            narrative = self._llm_with_guard(payload)

        md_path = self._save_markdown(cluster_id, narrative, payload)
        return md_path

    # ── Internal ──────────────────────────────────────────────────────────────

    def _load_finding(self, cluster_id: str) -> dict | None:
        for fd in self.store.all_findings():
            if fd.get("cluster_id") == cluster_id:
                return fd
        return None

    def _llm_with_guard(self, payload: dict) -> str:
        for attempt in range(self.max_regenerations + 1):
            narrative = self.llm.sar_narrative(payload)
            ok, bad = _verify_no_hallucinated_numbers(narrative, payload)
            if ok:
                return narrative
            # Inject correction hint into next attempt
            payload["_correction"] = (
                f"Previous draft contained unverified numbers: {sorted(bad)}. "
                "Use ONLY numbers present in the JSON above."
            )

        # Final fallback after all regeneration attempts exhausted
        return self._fallback_narrative(payload)

    def _fallback_narrative(self, payload: dict) -> str:
        bd = payload.get("score_breakdown", {})
        features = payload.get("features", {})
        members_str = ", ".join(payload.get("members", [])[:6])
        if len(payload.get("members", [])) > 6:
            members_str += f" (and {len(payload['members']) - 6} more)"

        return (
            f"**Suspicious Activity Report — {payload['cluster_id']}**\n\n"
            f"Detector: {payload['detector']}\n"
            f"Score: {payload['score']} / 100 | Action: {payload['action'].upper()}\n\n"
            f"**Involved accounts ({payload['n_members']}):** {members_str}\n\n"
            f"**Detection reason:** {payload['reason']}\n\n"
            f"**Score breakdown:**\n"
            + "\n".join(f"- {k}: {v}" for k, v in bd.items())
            + (f"\n\n**Features:**\n" + "\n".join(f"- {k}: {v}" for k, v in features.items()) if features else "")
            + f"\n\n**Evidence transactions:** {payload['n_evidence_txns']} captured\n\n"
            f"**Legal context:** {', '.join(_GEODO_STUB['legal_refs'])}\n"
            f"**Filing obligation:** {_GEODO_STUB['filing_obligation']}\n\n"
            f"**Recommendation:** Escalate to compliance officer for review and SAR filing.\n\n"
            f"*Generated: {payload['generated_at_utc']}*"
        )

    def _save_markdown(self, cluster_id: str, narrative: str, payload: dict) -> str:
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", cluster_id)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"{safe_id}_{ts}.md"
        path = _SAR_DIR / filename

        header = (
            f"# SAR Narrative — {cluster_id}\n\n"
            f"**Generated:** {payload.get('generated_at_utc', ts)}\n"
            f"**Score:** {payload.get('score')} / 100\n"
            f"**Action:** {payload.get('action', '').upper()}\n"
            f"**Detector:** {payload.get('detector')}\n\n"
            "---\n\n"
        )

        path.write_text(header + narrative + "\n", encoding="utf-8")
        return str(path)

    def batch_generate(self, min_action: str = "escalate") -> list[str]:
        """Generate SARs for all findings at or above min_action. Returns file paths."""
        include = {"escalate"} if min_action == "escalate" else {"escalate", "watch"}
        paths = []
        for fd in self.store.all_findings():
            if fd.get("action") in include:
                p = self.generate_sar(fd["cluster_id"])
                if p:
                    paths.append(p)
        return paths
