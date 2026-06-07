"""
Unit tests for Finding.action_for() boundaries and Finding.__post_init__
validation (invalid action raises; breakdown-sum mismatch raises).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from detectors.base import Finding


# ── action_for boundaries ───────────────────────────────────────────────────
# Thresholds: >=70 escalate, 45..70 watch, <45 clear.

@pytest.mark.parametrize(
    "score,expected",
    [
        (100.0, "escalate"),
        (70.0, "escalate"),    # boundary: >=70 escalates
        (69.99, "watch"),
        (50.0, "watch"),
        (45.0, "watch"),       # boundary: >=45 watches
        (44.99, "clear"),
        (0.0, "clear"),
        (-5.0, "clear"),
    ],
)
def test_action_for_boundaries(score, expected):
    assert Finding.action_for(score) == expected


def _make_finding(score, breakdown, action):
    return Finding(
        cluster_id="c1",
        detector="d1",
        members=["AC-0001"],
        score=score,
        features={},
        score_breakdown=breakdown,
        reason="r",
        rules_fired=0,
        action=action,
        evidence_txn_ids=["TXN-1"],
    )


def test_valid_finding_constructs():
    f = _make_finding(70.0, {"a": 40.0, "b": 30.0}, "escalate")
    assert f.score == 70.0
    assert f.action == "escalate"


def test_invalid_action_raises():
    with pytest.raises(ValueError, match="invalid action"):
        _make_finding(70.0, {"a": 70.0}, "ESCALATE")
    with pytest.raises(ValueError, match="invalid action"):
        _make_finding(70.0, {"a": 70.0}, "flag")


def test_breakdown_sum_mismatch_raises():
    # breakdown sums to 50 but score is 70 -> mismatch > 2.0
    with pytest.raises(ValueError, match="score_breakdown"):
        _make_finding(70.0, {"a": 30.0, "b": 20.0}, "escalate")


def test_breakdown_sum_within_tolerance_ok():
    # off by exactly 2.0 -> allowed (abs diff must be > 2.0 to raise)
    f = _make_finding(70.0, {"a": 40.0, "b": 28.0}, "escalate")
    assert f.score == 70.0


def test_breakdown_just_over_tolerance_raises():
    with pytest.raises(ValueError, match="score_breakdown"):
        _make_finding(70.0, {"a": 40.0, "b": 27.9}, "escalate")  # off by 2.1


def test_to_dict_has_contract_fields():
    f = _make_finding(70.0, {"a": 70.0}, "escalate")
    d = f.to_dict()
    expected_keys = {
        "cluster_id", "detector", "members", "score", "features",
        "score_breakdown", "reason", "rules_fired", "action", "evidence_txn_ids",
    }
    assert set(d.keys()) == expected_keys


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
