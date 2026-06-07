"""
MuleFanInDetector — high in-degree collector accounts on the A2A graph.

Uses LocalOutlierFactor on [in_degree, distinct_senders, total_received].
"""
from __future__ import annotations

import pandas as pd
import numpy as np
import networkx as nx
from sklearn.neighbors import LocalOutlierFactor

from .base import Detector, Finding


class MuleFanInDetector(Detector):
    name = "mule_fanin"

    def __init__(self, config: dict | None = None):
        self.config = config or {
            "contamination": 0.05,
            "min_in_degree": 2,
        }

    def detect(self, df: pd.DataFrame) -> list[Finding]:
        df = df.copy()
        a2a = df[df["counterparty_id"].str.startswith("AC-")].copy()
        if len(a2a) < 5:
            return []

        G = nx.DiGraph()
        for _, row in a2a.iterrows():
            G.add_edge(row["account_id"], row["counterparty_id"], weight=row["amount"])

        records = []
        for node in G.nodes():
            in_deg = G.in_degree(node)
            if in_deg < self.config["min_in_degree"]:
                continue
            predecessors = list(G.predecessors(node))
            total_received = sum(G[p][node]["weight"] for p in predecessors)
            records.append({
                "account_id": node,
                "in_degree": in_deg,
                "distinct_senders": len(predecessors),
                "total_received": total_received,
            })

        if len(records) < 3:
            return []

        feat_df = pd.DataFrame(records)
        X = feat_df[["in_degree", "distinct_senders", "total_received"]].values

        n_neighbors = min(5, len(feat_df) - 1)
        contamination = max(0.001, min(self.config["contamination"], 0.499))
        lof = LocalOutlierFactor(n_neighbors=n_neighbors, contamination=contamination)
        feat_df["anomaly"] = lof.fit_predict(X)

        flagged = feat_df[feat_df["anomaly"] == -1]
        if flagged.empty:
            return []

        findings = []
        for _, row in flagged.iterrows():
            acct = row["account_id"]
            score_raw = min(
                (row["in_degree"] / max(feat_df["in_degree"].max(), 1)) * 50
                + (row["total_received"] / max(feat_df["total_received"].max(), 1)) * 50,
                100,
            )
            score = round(score_raw, 2)
            bd = {
                "in_degree_ratio": round((row["in_degree"] / max(feat_df["in_degree"].max(), 1)) * 50, 2),
                "received_ratio": round((row["total_received"] / max(feat_df["total_received"].max(), 1)) * 50, 2),
            }
            action = Finding.action_for(score)
            rules_fired = int(row["in_degree"])

            # txns where this account is the destination
            evidence = a2a[a2a["counterparty_id"] == acct]["txn_id"].tolist()

            reason = (
                f"Mule/fan-in: {acct} receives from {int(row['distinct_senders'])} senders, "
                f"in_degree={int(row['in_degree'])}, total_received=${row['total_received']:,.0f}"
            )

            findings.append(Finding(
                cluster_id=f"mule_{acct}",
                detector=self.name,
                members=[acct],
                score=score,
                features={
                    "in_degree": int(row["in_degree"]),
                    "distinct_senders": int(row["distinct_senders"]),
                    "total_received": round(row["total_received"], 2),
                },
                score_breakdown=bd,
                reason=reason,
                rules_fired=rules_fired,
                action=action,
                evidence_txn_ids=evidence,
            ))

        return findings
