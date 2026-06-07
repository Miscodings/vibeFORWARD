"""
AnomalyAgent — runs all detectors over the DataFrame, writes Findings to memory.

The single score is the rank AND the decision. No separate Ranker/Decider.
"""
from __future__ import annotations

import pandas as pd

from detectors.registry import get_detectors
from detectors.base import Finding
from memory.store import MemoryStore


class AnomalyAgent:
    def __init__(self, store: MemoryStore | None = None):
        self.store = store or MemoryStore()

    def run(self, df: pd.DataFrame) -> list[Finding]:
        all_findings: list[Finding] = []

        for det in get_detectors():
            findings = det.detect(df)
            for f in findings:
                self.store.set_finding(f.to_dict())
            all_findings.extend(findings)

        ranked = sorted(all_findings, key=lambda f: f.score, reverse=True)
        return ranked

    def get_alerted_accounts(self, min_action: str = "watch") -> set[str]:
        """
        Return account_ids already covered by an escalate or watch Finding.
        Cleared findings don't block Agent 0 from re-examining the account.
        """
        include_actions = {"escalate", "watch"} if min_action == "watch" else {"escalate"}
        accounts: set[str] = set()
        for fd in self.store.all_findings():
            if fd.get("action") in include_actions:
                accounts.update(fd.get("members", []))
        return accounts
