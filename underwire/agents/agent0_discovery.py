"""
Agent0Discovery — residual z-score pattern discovery.

Algorithm:
  1. Compute residual accounts (not in any existing Finding).
  2. Engineer features: mean_amt, night_frac, n_regions, n_devices, n_merch, frac_highval.
  3. Z-score; flag account on a feature when |z| > threshold (default 3).
  4. Group by driving feature; require >= min_members.
  5. Dedup/merge: if two groups overlap >50%, merge and keep more specific feature.
  6. For each surviving group, call LLM (Haiku) to name the pattern.
  7. Append a new threshold Detector to registry; persist column spec to memory.
"""
from __future__ import annotations

import json
import pandas as pd
import numpy as np
from typing import TYPE_CHECKING

from memory.store import MemoryStore
from detectors.registry import append_detector, get_detectors
from detectors.base import Detector, Finding

if TYPE_CHECKING:
    from llm.client import LLMClient


_HIGH_VAL_THRESHOLD = 200.0    # $200+ is "high value" for median-pop comparison
_NIGHT_HOURS = (2, 4)          # 02:00–04:00


def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["is_night"] = df["timestamp"].dt.hour.between(*_NIGHT_HOURS)
    df["is_highval"] = df["amount"] > _HIGH_VAL_THRESHOLD

    agg = df.groupby("account_id").agg(
        mean_amt    = ("amount", "mean"),
        night_frac  = ("is_night", "mean"),
        n_regions   = ("ip_region", "nunique"),
        n_devices   = ("device_id", "nunique"),
        n_merch     = ("merchant_category", "nunique"),
        frac_highval= ("is_highval", "mean"),
        n_txns      = ("txn_id", "count"),
    ).reset_index()
    return agg


def _zscore_df(feat: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = feat.copy()
    for col in cols:
        mu, sigma = out[col].mean(), out[col].std()
        out[f"z_{col}"] = (out[col] - mu) / sigma if sigma > 0 else 0.0
    return out


FEATURE_COLS = ["mean_amt", "night_frac", "n_regions", "n_devices", "n_merch", "frac_highval"]


class _ThresholdDetector(Detector):
    """Dynamically generated threshold detector from Agent 0."""

    def __init__(self, name: str, pattern_name: str, driving_feature: str,
                 member_accounts: list[str], threshold_val: float, config: dict):
        self.name = name
        self.pattern_name = pattern_name
        self.driving_feature = driving_feature
        self._member_accounts = set(member_accounts)
        self._threshold_val = threshold_val
        self.config = config

    def detect(self, df: pd.DataFrame) -> list[Finding]:
        feat = _engineer_features(df)
        col = self.driving_feature
        if col not in feat.columns:
            return []

        mu, sigma = feat[col].mean(), feat[col].std()
        if sigma == 0:
            return []

        feat[f"z_{col}"] = (feat[col] - mu) / sigma
        z_thresh = self.config.get("z_threshold", 3.0)
        flagged = feat[feat[f"z_{col}"].abs() > z_thresh]
        if flagged.empty:
            return []

        members = flagged["account_id"].tolist()
        col_vals = flagged[col].tolist()
        evidence = df[df["account_id"].isin(members)]["txn_id"].tolist()
        mean_val = float(flagged[col].mean())
        pop_mean = float(feat[col].mean())

        score = min(float((flagged[f"z_{col}"].mean() / z_thresh) * 70), 100.0)
        score = round(score, 2)
        bd = {"z_deviation": round(score, 2)}
        action = Finding.action_for(score)

        reason = (
            f"{self.pattern_name}: {len(members)} accounts flagged on {col}, "
            f"mean={mean_val:.2f} vs pop_mean={pop_mean:.2f}"
        )

        return [Finding(
            cluster_id=f"agent0_{self.name}",
            detector=self.name,
            members=members,
            score=score,
            features={"driving_feature": col, "mean_val": mean_val, "pop_mean": pop_mean},
            score_breakdown=bd,
            reason=reason,
            rules_fired=0,
            action=action,
            evidence_txn_ids=evidence[:50],
        )]


class Agent0Discovery:
    def __init__(
        self,
        store: MemoryStore | None = None,
        llm_client=None,
        z_threshold: float = 2.5,
        min_members: int = 3,
        overlap_merge_ratio: float = 0.5,
    ):
        self.store = store or MemoryStore()
        self.llm = llm_client
        self.z_threshold = z_threshold
        self.min_members = min_members
        self.overlap_merge_ratio = overlap_merge_ratio

    def _get_residual_accounts(self, df: pd.DataFrame) -> set[str]:
        # Only exclude escalate/watch findings; cleared findings leave accounts available
        alerted: set[str] = set()
        for fd in self.store.all_findings():
            if fd.get("action") in ("escalate", "watch"):
                alerted.update(fd.get("members", []))
        all_accounts = set(df["account_id"].unique())
        return all_accounts - alerted

    def _name_pattern_llm(self, feature: str, members: list[str], feat_row: dict) -> dict:
        if self.llm is None:
            return {
                "pattern_name": f"anomalous_{feature}",
                "one_line_rule": f"Accounts with abnormally high {feature}",
                "why": "LLM unavailable — rule synthesized from feature signature",
            }

        summary = {
            "driving_feature": feature,
            "n_members": len(members),
            "sample_accounts": members[:5],
            "feature_stats": feat_row,
        }
        user_msg = (
            "You are a financial crime analyst reviewing a cluster of anomalous bank accounts. "
            "Return ONLY valid JSON with keys: pattern_name, one_line_rule, why.\n\n"
            f"Feature signature:\n{json.dumps(summary, indent=2)}"
        )
        try:
            result = self.llm.complete(
                system="You are a financial crime analyst. Return only valid JSON.",
                user=user_msg,
                model="claude-haiku-4-5-20251001",
                json_mode=True,
            )
            if isinstance(result, str):
                result = json.loads(result)
            return result
        except Exception:
            return {
                "pattern_name": f"anomalous_{feature}",
                "one_line_rule": f"Accounts with abnormally high {feature}",
                "why": "LLM call failed — synthesized from feature signature",
            }

    def run(self, df: pd.DataFrame) -> list[dict]:
        residual_accounts = self._get_residual_accounts(df)
        if len(residual_accounts) < self.min_members:
            return []

        feat = _engineer_features(df)
        feat = feat[feat["account_id"].isin(residual_accounts)].copy()
        if feat.empty:
            return []

        feat = _zscore_df(feat, FEATURE_COLS)

        # Group by driving feature
        groups: list[dict] = []
        for col in FEATURE_COLS:
            z_col = f"z_{col}"
            flagged = feat[feat[z_col].abs() > self.z_threshold]
            if len(flagged) < self.min_members:
                continue
            groups.append({
                "feature": col,
                "members": set(flagged["account_id"].tolist()),
                "feat_stats": {
                    "mean": round(float(flagged[col].mean()), 4),
                    "max": round(float(flagged[col].max()), 4),
                    "z_mean": round(float(flagged[z_col].abs().mean()), 4),
                },
            })

        if not groups:
            return []

        # Dedup/merge overlapping groups
        merged = self._merge_groups(groups)

        discovered = []
        for g in merged:
            feature    = g["feature"]
            members    = sorted(g["members"])
            feat_stats = g.get("feat_stats", {})

            naming = self._name_pattern_llm(feature, members, feat_stats)
            pattern_name = naming.get("pattern_name", f"anomalous_{feature}")

            det_name = f"agent0_{feature}"

            # Append to registry
            threshold_val = feat_stats.get("mean", 0.0)
            new_det = _ThresholdDetector(
                name=det_name,
                pattern_name=pattern_name,
                driving_feature=feature,
                member_accounts=members,
                threshold_val=threshold_val,
                config={"z_threshold": self.z_threshold if hasattr(self, 'z_threshold') else 2.5},
            )
            append_detector(new_det)

            col_spec = {
                "detector_name": det_name,
                "pattern_name": pattern_name,
                "driving_feature": feature,
                "one_line_rule": naming.get("one_line_rule", ""),
                "why": naming.get("why", ""),
                "members": members,
                "feat_stats": feat_stats,
            }
            self.store.set_column(pattern_name, col_spec)
            discovered.append(col_spec)

        return discovered

    def _merge_groups(self, groups: list[dict]) -> list[dict]:
        merged = list(groups)
        changed = True
        while changed:
            changed = False
            new_merged = []
            used = set()
            for i, g1 in enumerate(merged):
                if i in used:
                    continue
                for j, g2 in enumerate(merged):
                    if j <= i or j in used:
                        continue
                    overlap = len(g1["members"] & g2["members"])
                    smaller = min(len(g1["members"]), len(g2["members"]))
                    if smaller > 0 and overlap / smaller > self.overlap_merge_ratio:
                        # Keep more specific (smaller) group's feature; merge members
                        keep = g1 if len(g1["members"]) <= len(g2["members"]) else g2
                        new_group = {
                            "feature": keep["feature"],
                            "members": g1["members"] | g2["members"],
                            "feat_stats": keep["feat_stats"],
                        }
                        new_merged.append(new_group)
                        used.add(i)
                        used.add(j)
                        changed = True
                        break
                if i not in used:
                    new_merged.append(g1)
            merged = new_merged
        return merged
