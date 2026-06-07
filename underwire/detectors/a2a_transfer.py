"""
A2ATransferDetector — detects circular layering in account-to-account flows.

Score formula (0–100):
  30 * value_norm          (edge weights vs 10× pop median, capped at 1)
  25 * night_frac          (share of transfers 02:00–04:00)
  20 * amount_lift         (cell mean vs 10× pop median, capped at 1)
  15 * counterparty_conc   (1 − distinct_counterparties / txns)
  10 * burst_opening       (share of members opened in the modal recent month)
"""
from __future__ import annotations

import pandas as pd
import numpy as np
import networkx as nx

from .base import Detector, Finding


class A2ATransferDetector(Detector):
    name = "a2a_transfer"

    def __init__(self, config: dict | None = None):
        self.config = config or {
            "min_members": 2,
            "min_score": 0.0,
        }

    def detect(self, df: pd.DataFrame) -> list[Finding]:
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df["account_open_date"] = pd.to_datetime(df["account_open_date"])

        pop_median = df["amount"].median()

        # Keep only account→account edges
        a2a = df[df["counterparty_id"].str.startswith("AC-")].copy()
        if a2a.empty:
            return []

        G = nx.DiGraph()
        for _, row in a2a.iterrows():
            src, dst = row["account_id"], row["counterparty_id"]
            if G.has_edge(src, dst):
                G[src][dst]["weight"] += row["amount"]
                G[src][dst]["txns"].append(row["txn_id"])
            else:
                G.add_edge(src, dst, weight=row["amount"], txns=[row["txn_id"]])

        findings = []
        for component in nx.weakly_connected_components(G):
            if len(component) < self.config["min_members"]:
                continue

            members = sorted(component)
            sub_a2a = a2a[
                a2a["account_id"].isin(component) | a2a["counterparty_id"].isin(component)
            ]

            # ── feature computation ───────────────────────────────────────
            total_value = sub_a2a["amount"].sum()
            value_norm = min(total_value / (10 * pop_median * max(len(members), 1)), 1.0)

            night_mask = sub_a2a["timestamp"].dt.hour.between(2, 3)
            night_frac = night_mask.mean() if len(sub_a2a) > 0 else 0.0

            cell_mean = sub_a2a["amount"].mean()
            amount_lift = min(cell_mean / (10 * pop_median) if pop_median > 0 else 0, 1.0)

            distinct_cp = sub_a2a["counterparty_id"].nunique()
            n_txns = len(sub_a2a)
            counterparty_conc = 1 - (distinct_cp / n_txns) if n_txns > 0 else 0.0

            open_months = (
                df[df["account_id"].isin(members)]["account_open_date"]
                .dt.to_period("M")
                .value_counts()
            )
            burst_opening = float(open_months.iloc[0] / len(members)) if len(open_months) > 0 else 0.0

            # ── score ─────────────────────────────────────────────────────
            bd = {
                "value_norm":       round(30 * value_norm, 2),
                "night_frac":       round(25 * night_frac, 2),
                "amount_lift":      round(20 * amount_lift, 2),
                "counterparty_conc":round(15 * counterparty_conc, 2),
                "burst_opening":    round(10 * burst_opening, 2),
            }
            score = round(sum(bd.values()), 2)
            action = Finding.action_for(score)

            rules_fired = int(
                (sub_a2a["amount"] >= 1000).sum()
            )

            reason = (
                f"A2A ring: {len(members)} accounts, {n_txns} transfers, "
                f"total ${total_value:,.0f}, night_frac={night_frac:.0%}, "
                f"mean_amount=${cell_mean:,.0f}, rules_fired={rules_fired}"
            )

            cid = "a2a_" + "_".join(sorted(members)[:3]) + (f"_+{len(members)-3}" if len(members) > 3 else "")

            findings.append(Finding(
                cluster_id=cid,
                detector=self.name,
                members=members,
                score=score,
                features={
                    "total_value": round(total_value, 2),
                    "cell_mean_amount": round(cell_mean, 2),
                    "pop_median": round(pop_median, 2),
                    "n_txns": n_txns,
                    "night_frac": round(night_frac, 4),
                    "distinct_counterparties": distinct_cp,
                },
                score_breakdown=bd,
                reason=reason,
                rules_fired=rules_fired,
                action=action,
                evidence_txn_ids=sub_a2a["txn_id"].tolist(),
            ))

        return findings
