"""
Unit tests for each detector on small synthetic DataFrames AND on the real
data/transactions.csv.

Asserts for every Finding produced:
  * the 10-field contract shape & types
  * score_breakdown sums to score (+/- 2)
  * action thresholds (>=70 escalate, 45..70 watch, <45 clear)
  * rules_fired semantics
"""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from detectors.a2a_transfer import A2ATransferDetector
from detectors.structuring import StructuringDetector
from detectors.mule_fanin import MuleFanInDetector
from detectors.base import Finding

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "transactions.csv")

CONTRACT_TYPES = {
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


# ── shared assertions ────────────────────────────────────────────────────────

def assert_finding_contract(f: Finding):
    assert isinstance(f, Finding)
    d = f.to_dict()
    assert set(d.keys()) == set(CONTRACT_TYPES.keys()), set(d.keys())
    for key, typ in CONTRACT_TYPES.items():
        assert isinstance(d[key], typ), f"{key}={d[key]!r} not {typ}"
    assert all(isinstance(m, str) for m in d["members"])
    assert all(isinstance(t, str) for t in d["evidence_txn_ids"])
    assert d["action"] in ("escalate", "watch", "clear")
    assert d["rules_fired"] >= 0


def assert_breakdown_sums(f: Finding):
    bd_sum = sum(f.score_breakdown.values())
    assert abs(bd_sum - f.score) <= 2.0, (
        f"{f.cluster_id}: breakdown sums to {bd_sum:.2f} but score={f.score:.2f}"
    )


def assert_action_threshold(f: Finding):
    expected = Finding.action_for(f.score)
    assert f.action == expected, (
        f"{f.cluster_id}: score={f.score} -> expected {expected} but got {f.action}"
    )
    if f.score >= 70:
        assert f.action == "escalate"
    elif f.score >= 45:
        assert f.action == "watch"
    else:
        assert f.action == "clear"


def check_all(findings):
    for f in findings:
        assert_finding_contract(f)
        assert_breakdown_sums(f)
        assert_action_threshold(f)


# ── fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real_df():
    return pd.read_csv(CSV_PATH)


def _synthetic_a2a_ring():
    """A small circular A2A ring of 3 accounts, sub-$1000 transfers at night."""
    rows = []
    edges = [("AC-1001", "AC-1002"), ("AC-1002", "AC-1003"), ("AC-1003", "AC-1001")]
    tid = 0
    for _ in range(4):
        for src, dst in edges:
            tid += 1
            rows.append({
                "txn_id": f"TXN-{tid:04d}",
                "account_id": src,
                "counterparty_id": dst,
                "amount": 600.0,
                "timestamp": "2026-01-10 03:00:00",
                "merchant_category": "transfer",
                "device_id": "DEV-1",
                "ip_region": "us-west",
                "account_open_date": "2025-12-01",
            })
    return pd.DataFrame(rows)


def _synthetic_inflow(n=30):
    """Plain merchant inflows (non-A2A) for structuring detector."""
    rows = []
    for i in range(n):
        rows.append({
            "txn_id": f"TXN-S{i:04d}",
            "account_id": f"AC-{2000 + (i % 5):04d}",
            "counterparty_id": f"MR-{9000 + i}",
            "amount": 9500.0 if i % 7 == 0 else 120.0,
            "timestamp": f"2026-02-{1 + (i % 27):02d} 10:00:00",
            "merchant_category": "retail",
            "device_id": "DEV-2",
            "ip_region": "us-east",
            "account_open_date": "2025-01-01",
        })
    return pd.DataFrame(rows)


# ══ A2A transfer detector ════════════════════════════════════════════════════

def test_a2a_synthetic_ring_detected():
    det = A2ATransferDetector()
    findings = det.detect(_synthetic_a2a_ring())
    assert findings, "expected at least one A2A finding for synthetic ring"
    check_all(findings)
    members = set()
    for f in findings:
        members.update(f.members)
    assert {"AC-1001", "AC-1002", "AC-1003"} <= members


def test_a2a_rules_fired_sub_threshold_is_zero():
    # all transfers are $600 (< $1000) -> rules_fired must be 0
    det = A2ATransferDetector()
    findings = det.detect(_synthetic_a2a_ring())
    for f in findings:
        assert f.rules_fired == 0, f"{f.cluster_id} rules_fired={f.rules_fired}"


def test_a2a_empty_when_no_a2a_edges():
    det = A2ATransferDetector()
    df = _synthetic_inflow()  # no AC- counterparties
    assert det.detect(df) == []


def test_a2a_on_real_csv(real_df):
    det = A2ATransferDetector()
    findings = det.detect(real_df)
    assert findings, "expected A2A findings on real dataset"
    check_all(findings)


# ══ Structuring detector ═════════════════════════════════════════════════════

def test_structuring_synthetic_shape():
    det = StructuringDetector()
    findings = det.detect(_synthetic_inflow())
    # may or may not flag, but whatever it returns must obey the contract
    check_all(findings)


def test_structuring_rules_fired_semantics():
    det = StructuringDetector()
    findings = det.detect(_synthetic_inflow())
    for f in findings:
        # rules_fired counts txns >= 90% of $10k threshold ($9000)
        assert f.rules_fired >= 0


def test_structuring_on_real_csv(real_df):
    det = StructuringDetector()
    findings = det.detect(real_df)
    check_all(findings)  # dataset has no $10k structuring; any output must be valid


def _synthetic_high_inflow():
    """Inflows well above the $10k CTR threshold for one account.

    Regression guard: with a large rolling inflow the inflow component exceeds
    50 points; score_breakdown must still sum to score (Finding.__post_init__
    would otherwise raise).
    """
    rows = []
    # AC-4000 receives many large ($9,500) merchant inflows in a tight window
    for i in range(12):
        rows.append({
            "txn_id": f"TXN-H{i:04d}",
            "account_id": "AC-4000",
            "counterparty_id": f"MR-{8000 + i}",
            "amount": 9500.0,
            "timestamp": f"2026-04-0{1 + (i % 5)} 0{i % 9}:00:00",
            "merchant_category": "retail",
            "device_id": "DEV-4",
            "ip_region": "us-east",
            "account_open_date": "2025-01-01",
        })
    # baseline noise accounts so the IsolationForest has a population
    for i in range(20):
        rows.append({
            "txn_id": f"TXN-N{i:04d}",
            "account_id": f"AC-{4100 + i:04d}",
            "counterparty_id": f"MR-{7000 + i}",
            "amount": 80.0,
            "timestamp": f"2026-04-1{i % 9} 12:00:00",
            "merchant_category": "retail",
            "device_id": "DEV-4",
            "ip_region": "us-east",
            "account_open_date": "2025-01-01",
        })
    return pd.DataFrame(rows)


def test_structuring_high_inflow_breakdown_consistent():
    det = StructuringDetector()
    findings = det.detect(_synthetic_high_inflow())
    # The contract (breakdown sums to score) must hold even when inflow is huge.
    check_all(findings)


# ══ Mule fan-in detector ═════════════════════════════════════════════════════

def _synthetic_fanin():
    """Many senders -> one collector account."""
    rows = []
    tid = 0
    # 8 senders all fund AC-3000 (high in-degree collector)
    for i in range(8):
        tid += 1
        rows.append({
            "txn_id": f"TXN-M{tid:04d}",
            "account_id": f"AC-{3100 + i:04d}",
            "counterparty_id": "AC-3000",
            "amount": 5000.0,
            "timestamp": "2026-03-01 12:00:00",
            "merchant_category": "transfer",
            "device_id": "DEV-3",
            "ip_region": "us-east",
            "account_open_date": "2025-06-01",
        })
    # a few low-degree noise edges to give LOF a baseline
    for i in range(6):
        tid += 1
        rows.append({
            "txn_id": f"TXN-M{tid:04d}",
            "account_id": f"AC-{3200 + i:04d}",
            "counterparty_id": f"AC-{3300 + i:04d}",
            "amount": 100.0,
            "timestamp": "2026-03-02 12:00:00",
            "merchant_category": "transfer",
            "device_id": "DEV-3",
            "ip_region": "us-east",
            "account_open_date": "2025-06-01",
        })
    return pd.DataFrame(rows)


def test_mule_synthetic_shape():
    det = MuleFanInDetector()
    findings = det.detect(_synthetic_fanin())
    check_all(findings)


def test_mule_rules_fired_equals_in_degree():
    det = MuleFanInDetector()
    findings = det.detect(_synthetic_fanin())
    for f in findings:
        # rules_fired == in_degree per detector implementation
        assert f.rules_fired == f.features["in_degree"]


def test_mule_on_real_csv(real_df):
    det = MuleFanInDetector()
    findings = det.detect(real_df)
    check_all(findings)


# ══ Cross-detector: full registry over real CSV ══════════════════════════════

def test_all_detectors_real_csv_contract(real_df):
    for det in (A2ATransferDetector(), StructuringDetector(), MuleFanInDetector()):
        check_all(det.detect(real_df))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
