"""
UpdaterAgent — self-tuning feedback loop.

On each call it:
  1. Counts analyst Approve (confirm) and Reject labels in memory.
  2. Enforces gates before proposing any config change.
  3. Calls LLM (Haiku) to diagnose rejects and suggest ONE param patch.
  4. Validates the patch (contamination delta ≤ 0.004, volume gate).
  5. Writes {old, new, why, ts} to memory config_versions.
  6. Returns the patch dict (caller applies it to the detector).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from memory.store import MemoryStore
from detectors.registry import get_detectors, update_detector_config

if TYPE_CHECKING:
    from llm.client import LLMClient

# ── Gates ─────────────────────────────────────────────────────────────────────
_MIN_LABELS            = 20      # require this many decisions before tuning
_MAX_ALERT_VOLUME      = 200     # refuse if current findings > this
_MAX_CONTAMINATION_DELTA = 0.004 # max absolute change to contamination per update


class UpdaterAgent:
    def __init__(
        self,
        store: MemoryStore | None = None,
        llm_client: "LLMClient | None" = None,
    ):
        self.store = store or MemoryStore()
        self.llm   = llm_client

    def run(self) -> dict:
        """
        Attempt a single config update cycle.
        Returns a status dict:
          {
            "status": "updated" | "skipped" | "rejected",
            "reason": str,
            "patch":  dict | None,
            "detector": str | None,
          }
        """
        # 1. Gate: minimum labels
        total_labels = self.store.total_label_count()
        if total_labels < _MIN_LABELS:
            return {
                "status": "skipped",
                "reason": f"Only {total_labels} labels collected; need {_MIN_LABELS}",
                "patch": None,
                "detector": None,
            }

        # 2. Gate: alert volume
        n_findings = len(self.store.all_findings())
        if n_findings > _MAX_ALERT_VOLUME:
            return {
                "status": "skipped",
                "reason": f"Alert volume {n_findings} exceeds capacity gate {_MAX_ALERT_VOLUME}",
                "patch": None,
                "detector": None,
            }

        # 3. Build reject summary
        all_labels = self.store.all_labels()
        reject_cluster_ids = [
            cid for cid, decisions in all_labels.items()
            if decisions.count("reject") > decisions.count("approve")
        ]

        if not reject_cluster_ids:
            return {
                "status": "skipped",
                "reason": "No net-rejected clusters; nothing to tune",
                "patch": None,
                "detector": None,
            }

        # 4. Pick the detector responsible for the most rejects
        target_detector, reject_findings = self._find_reject_detector(reject_cluster_ids)
        if target_detector is None:
            return {
                "status": "skipped",
                "reason": "Could not map rejects to a registered detector",
                "patch": None,
                "detector": None,
            }

        current_cfg = self.store.get_config(target_detector) or {}

        # 5. Ask LLM for patch
        patch = self._propose_patch(target_detector, current_cfg, reject_findings)
        if not patch:
            return {
                "status": "skipped",
                "reason": "LLM did not return a usable patch",
                "patch": None,
                "detector": target_detector,
            }

        # 6. Validate contamination delta
        validation = self._validate_patch(current_cfg, patch)
        if not validation["ok"]:
            return {
                "status": "rejected",
                "reason": validation["reason"],
                "patch": patch,
                "detector": target_detector,
            }

        # 7. Apply patch and persist version
        new_cfg = {**current_cfg, **{patch["param"]: patch["value"]}}
        applied = update_detector_config(target_detector, new_cfg)
        if applied is None:
            return {
                "status": "skipped",
                "reason": f"Detector '{target_detector}' not found in registry",
                "patch": patch,
                "detector": target_detector,
            }

        self.store.set_config(target_detector, new_cfg)
        self.store.append_config_version(target_detector, {
            "old":  current_cfg,
            "new":  new_cfg,
            "why":  patch.get("reason", ""),
            "ts":   datetime.now(timezone.utc).isoformat(),
        })

        return {
            "status":   "updated",
            "reason":   patch.get("reason", ""),
            "patch":    patch,
            "detector": target_detector,
        }

    # ── Internal ──────────────────────────────────────────────────────────────

    def _find_reject_detector(
        self, reject_cluster_ids: list[str]
    ) -> tuple[str | None, list[dict]]:
        """
        Return (detector_name, list_of_reject_findings) for the detector
        responsible for the most rejected clusters.
        """
        detector_counts: dict[str, list[dict]] = {}
        for fd in self.store.all_findings():
            cid = fd.get("cluster_id")
            det = fd.get("detector")
            if cid in reject_cluster_ids and det:
                detector_counts.setdefault(det, []).append(fd)

        if not detector_counts:
            return None, []

        target = max(detector_counts, key=lambda d: len(detector_counts[d]))
        return target, detector_counts[target]

    def _propose_patch(
        self,
        detector_name: str,
        current_cfg: dict,
        reject_findings: list[dict],
    ) -> dict | None:
        payload = {
            "detector": detector_name,
            "current_config": current_cfg,
            "rejected_findings": [
                {
                    "cluster_id": f.get("cluster_id"),
                    "score": f.get("score"),
                    "features": f.get("features", {}),
                    "score_breakdown": f.get("score_breakdown", {}),
                    "reason": f.get("reason"),
                }
                for f in reject_findings[:10]  # cap at 10 for brevity
            ],
            "n_total_rejects": len(reject_findings),
        }

        if self.llm is None:
            return self._heuristic_patch(current_cfg, reject_findings)

        try:
            result = self.llm.diagnose_rejects(payload)
            if not isinstance(result, dict):
                return None
            if "param" not in result or "value" not in result:
                return None
            return result
        except Exception:
            return self._heuristic_patch(current_cfg, reject_findings)

    def _heuristic_patch(self, current_cfg: dict, reject_findings: list[dict]) -> dict | None:
        """Fallback: slightly lower contamination when many rejects exist."""
        current_contamination = float(current_cfg.get("contamination", 0.05))
        new_val = round(max(0.01, current_contamination - 0.002), 4)
        if new_val == current_contamination:
            return None
        return {
            "param": "contamination",
            "value": new_val,
            "reason": (
                f"Heuristic: lowered contamination {current_contamination}→{new_val} "
                f"based on {len(reject_findings)} rejected findings"
            ),
        }

    def _validate_patch(self, current_cfg: dict, patch: dict) -> dict:
        param = patch.get("param", "")
        new_val = patch.get("value")

        # Only gate on contamination changes
        if param == "contamination":
            old_val = float(current_cfg.get("contamination", 0.05))
            try:
                new_float = float(new_val)
            except (TypeError, ValueError):
                return {"ok": False, "reason": f"contamination value '{new_val}' is not numeric"}

            delta = abs(new_float - old_val)
            if delta > _MAX_CONTAMINATION_DELTA:
                return {
                    "ok": False,
                    "reason": (
                        f"contamination delta {delta:.4f} exceeds max {_MAX_CONTAMINATION_DELTA}; "
                        "propose a smaller step"
                    ),
                }
            if new_float <= 0 or new_float >= 1:
                return {
                    "ok": False,
                    "reason": f"contamination must be in (0, 1), got {new_float}",
                }

        return {"ok": True, "reason": ""}
