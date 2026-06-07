from __future__ import annotations
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
from typing import Any
import pandas as pd


@dataclass
class Finding:
    cluster_id: str
    detector: str
    members: list[str]          # account_ids
    score: float                # 0–100
    features: dict[str, Any]   # raw numbers behind the score
    score_breakdown: dict[str, float]   # per-component points; must sum ~= score
    reason: str                 # templated machine reason — no LLM
    rules_fired: int            # txns a standard threshold rule would have caught
    action: str                 # escalate / watch / clear
    evidence_txn_ids: list[str]

    def __post_init__(self):
        if self.action not in ("escalate", "watch", "clear"):
            raise ValueError(f"invalid action: {self.action!r}")
        bd_sum = sum(self.score_breakdown.values())
        if abs(bd_sum - self.score) > 2.0:
            raise ValueError(
                f"{self.cluster_id}: score_breakdown sums to {bd_sum:.1f} but score={self.score:.1f}"
            )

    @classmethod
    def action_for(cls, score: float) -> str:
        if score >= 70:
            return "escalate"
        if score >= 45:
            return "watch"
        return "clear"

    def to_dict(self) -> dict:
        return {
            "cluster_id": self.cluster_id,
            "detector": self.detector,
            "members": self.members,
            "score": self.score,
            "features": self.features,
            "score_breakdown": self.score_breakdown,
            "reason": self.reason,
            "rules_fired": self.rules_fired,
            "action": self.action,
            "evidence_txn_ids": self.evidence_txn_ids,
        }


class Detector(ABC):
    name: str
    config: dict

    @abstractmethod
    def detect(self, df: pd.DataFrame) -> list[Finding]:
        ...
