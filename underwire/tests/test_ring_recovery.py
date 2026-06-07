"""
Integration test: A2ATransferDetector must escalate the 9-account ring
embedded in the synthetic dataset, with rules_fired == 0.

Ground truth ring accounts:
  Cell A: AC-0001, AC-0002
  Cell B: AC-0005, AC-0006, AC-0007, AC-0009
  Cell C: AC-0003, AC-0010, AC-0011
"""
import os
import sys
import pytest
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from detectors.a2a_transfer import A2ATransferDetector

RING_ACCOUNTS = {
    "AC-0001", "AC-0002",
    "AC-0005", "AC-0006", "AC-0007", "AC-0009",
    "AC-0003", "AC-0010", "AC-0011",
}

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "transactions.csv")


@pytest.fixture(scope="module")
def df():
    return pd.read_csv(CSV_PATH)


@pytest.fixture(scope="module")
def findings(df):
    det = A2ATransferDetector()
    return det.detect(df)


def test_ring_accounts_escalated(findings):
    found = set()
    for f in findings:
        if f.action == "escalate":
            found.update(f.members)

    missing = RING_ACCOUNTS - found
    assert not missing, (
        f"Ring accounts not escalated: {sorted(missing)}. "
        f"Escalated findings: {[(f.cluster_id, f.members, f.score) for f in findings if f.action == 'escalate']}"
    )


def test_ring_rules_fired_zero(findings):
    """
    Ring transfers are $450–$850 — below $1000 threshold — so rules_fired must be 0
    for the cells that consist purely of ring members.
    """
    ring_findings = [
        f for f in findings
        if f.action == "escalate" and set(f.members).issubset(RING_ACCOUNTS)
    ]
    assert ring_findings, "No escalated finding that is a subset of ring accounts"
    for f in ring_findings:
        assert f.rules_fired == 0, (
            f"{f.cluster_id}: expected rules_fired=0 but got {f.rules_fired}. "
            f"features={f.features}"
        )


def test_all_cells_covered(findings):
    """Each of the three ring cells has at least one escalated finding covering it."""
    cells = [
        {"AC-0001", "AC-0002"},
        {"AC-0005", "AC-0006", "AC-0007", "AC-0009"},
        {"AC-0003", "AC-0010", "AC-0011"},
    ]
    escalated_member_sets = [set(f.members) for f in findings if f.action == "escalate"]

    for cell in cells:
        covered = any(cell <= s for s in escalated_member_sets)
        assert covered, f"Cell {cell} not covered by any escalated finding"


def test_score_breakdown_sums(findings):
    """score_breakdown must sum to within 2 points of score."""
    for f in findings:
        bd_sum = sum(f.score_breakdown.values())
        assert abs(bd_sum - f.score) <= 2.0, (
            f"{f.cluster_id}: breakdown={bd_sum:.2f} score={f.score:.2f}"
        )


def test_action_thresholds(findings):
    for f in findings:
        if f.score >= 70:
            assert f.action == "escalate", f"{f.cluster_id} score={f.score} but action={f.action}"
        elif f.score >= 45:
            assert f.action == "watch"
        else:
            assert f.action == "clear"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
