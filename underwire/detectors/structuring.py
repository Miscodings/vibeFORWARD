"""
StructuringDetector — rolling-window sub-threshold inflow detection.

For each receiving account: compute rolling 7-day inflow sum.
IsolationForest on [amount, count_in_window, frac_just_below_threshold].
Expected to return few/none on the provided dataset (no $10k structuring).
"""
from __future__ import annotations

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest

from .base import Detector, Finding


_THRESHOLD = 10_000.0   # CTR trigger
_JUST_BELOW = 0.10      # "just below" = within 10% of threshold


class StructuringDetector(Detector):
    name = "structuring"

    def __init__(self, config: dict | None = None):
        self.config = config or {
            "contamination": 0.02,
            "window_days": 7,
            "min_txns": 3,
            "exclude": [],
        }

    def detect(self, df: pd.DataFrame) -> list[Finding]:
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])

        exclude_cats = {e.get("merchant_category") for e in self.config.get("exclude", []) if "merchant_category" in e}
        if exclude_cats:
            df = df[~df["merchant_category"].isin(exclude_cats)]

        # Only cash-flow-type inflows (non-A2A for now; A2A handled by A2A detector)
        inflow = df[~df["counterparty_id"].str.startswith("AC-")].copy()
        if len(inflow) < 10:
            return []

        window_days = self.config["window_days"]
        threshold   = _THRESHOLD
        records = []

        for acct, grp in inflow.groupby("account_id"):
            grp = grp.sort_values("timestamp")
            grp["rolling_sum"] = (
                grp.set_index("timestamp")["amount"]
                .rolling(f"{window_days}D")
                .sum()
                .values
            )
            grp["rolling_cnt"] = (
                grp.set_index("timestamp")["amount"]
                .rolling(f"{window_days}D")
                .count()
                .values
            )
            grp["just_below"] = (grp["amount"] >= threshold * (1 - _JUST_BELOW)) & (grp["amount"] < threshold)
            grp["frac_just_below"] = grp["just_below"].cumsum() / (grp.index.to_series().rank())

            if len(grp) < self.config["min_txns"]:
                continue

            for _, row in grp.iterrows():
                records.append({
                    "account_id": acct,
                    "txn_id": row["txn_id"],
                    "amount": row["amount"],
                    "count_in_window": row["rolling_cnt"],
                    "frac_just_below": float(row["just_below"]),
                    "rolling_sum": row["rolling_sum"],
                })

        if not records:
            return []

        feat_df = pd.DataFrame(records)
        X = feat_df[["amount", "count_in_window", "frac_just_below"]].fillna(0)

        if len(X) < 5:
            return []

        contamination = max(0.001, min(self.config["contamination"], 0.499))
        iso = IsolationForest(contamination=contamination, random_state=42)
        feat_df["anomaly"] = iso.fit_predict(X)   # -1 = anomalous

        flagged_accts = feat_df[feat_df["anomaly"] == -1]["account_id"].unique()
        if len(flagged_accts) == 0:
            return []

        findings = []
        for acct in flagged_accts:
            acct_rows = feat_df[feat_df["account_id"] == acct]
            total_inflow = acct_rows["rolling_sum"].max()
            n_txns = len(acct_rows)
            mean_amt = acct_rows["amount"].mean()

            # Each component is capped at 50 so the breakdown always sums to the
            # score (which is itself capped at 100). Capping per-component instead
            # of only the joint sum keeps score_breakdown == score; otherwise a
            # large inflow makes the breakdown undercount and Finding.__post_init__
            # would reject the finding.
            inflow_pts = round(min((total_inflow / threshold) * 50, 50), 2)
            just_below_pts = round(min(acct_rows["frac_just_below"].mean() * 50, 50), 2)
            bd = {
                "inflow_ratio": inflow_pts,
                "just_below_frac": just_below_pts,
            }
            score = round(min(inflow_pts + just_below_pts, 100), 2)
            action = Finding.action_for(score)
            rules_fired = int((acct_rows["amount"] >= threshold * 0.9).sum())

            reason = (
                f"Structuring: {n_txns} txns, rolling 7-day inflow ${total_inflow:,.0f}, "
                f"mean_amount=${mean_amt:,.0f}, rules_fired={rules_fired}"
            )

            findings.append(Finding(
                cluster_id=f"struct_{acct}",
                detector=self.name,
                members=[acct],
                score=score,
                features={"total_inflow": round(total_inflow, 2), "n_txns": n_txns, "mean_amount": round(mean_amt, 2)},
                score_breakdown=bd,
                reason=reason,
                rules_fired=rules_fired,
                action=action,
                evidence_txn_ids=acct_rows["txn_id"].tolist(),
            ))

        return findings
