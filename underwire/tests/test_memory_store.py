"""
MemoryStore round-trip tests against an isolated temp SQLite DB.

CRITICAL: proves that data written is actually read back correctly — i.e. that
findings/labels/config are persisted and retrievable, not just held in memory.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory.store import MemoryStore


@pytest.fixture()
def store(tmp_path):
    db = tmp_path / "test_underwire.db"
    return MemoryStore(force_local=True, db_path=str(db))


def _finding(cluster_id="a2a_AC-0001", detector="a2a_transfer", action="escalate"):
    return {
        "cluster_id": cluster_id,
        "detector": detector,
        "members": ["AC-0001", "AC-0002"],
        "score": 80.0,
        "features": {"n_txns": 5},
        "score_breakdown": {"x": 80.0},
        "reason": "test",
        "rules_fired": 0,
        "action": action,
        "evidence_txn_ids": ["TXN-1", "TXN-2"],
    }


# ── findings round-trip ──────────────────────────────────────────────────────

def test_set_and_all_findings_roundtrip(store):
    f = _finding()
    store.set_finding(f)
    all_f = store.all_findings()
    assert len(all_f) == 1
    assert all_f[0]["cluster_id"] == f["cluster_id"]
    assert all_f[0]["members"] == ["AC-0001", "AC-0002"]
    assert all_f[0]["score"] == 80.0
    assert all_f[0]["evidence_txn_ids"] == ["TXN-1", "TXN-2"]


def test_get_finding(store):
    f = _finding()
    store.set_finding(f)
    got = store.get_finding("a2a_transfer", "a2a_AC-0001")
    assert got is not None
    assert got["cluster_id"] == "a2a_AC-0001"
    assert store.get_finding("a2a_transfer", "nonexistent") is None


def test_set_finding_overwrite(store):
    f = _finding()
    store.set_finding(f)
    f2 = _finding()
    f2["score"] = 95.0
    store.set_finding(f2)
    assert len(store.all_findings()) == 1  # same key -> overwrite
    assert store.get_finding("a2a_transfer", "a2a_AC-0001")["score"] == 95.0


# ── labels ───────────────────────────────────────────────────────────────────

def test_set_label_appends_and_counts(store):
    store.set_label("c1", "approve")
    store.set_label("c1", "reject")
    store.set_label("c2", "approve")
    assert store.get("labels:c1") == ["approve", "reject"]
    assert store.total_label_count() == 3
    all_labels = store.all_labels()
    assert all_labels["c1"] == ["approve", "reject"]
    assert all_labels["c2"] == ["approve"]


# ── config get/set + versions ────────────────────────────────────────────────

def test_config_get_set(store):
    assert store.get_config("a2a_transfer") is None
    store.set_config("a2a_transfer", {"min_members": 3})
    assert store.get_config("a2a_transfer") == {"min_members": 3}


def test_config_versions_append(store):
    assert store.get_config_versions("a2a_transfer") == []
    store.append_config_version("a2a_transfer", {"v": 1, "patch": {"a": 1}})
    store.append_config_version("a2a_transfer", {"v": 2, "patch": {"a": 2}})
    versions = store.get_config_versions("a2a_transfer")
    assert len(versions) == 2
    assert versions[0]["v"] == 1
    assert versions[1]["v"] == 2


# ── list_keys prefix filtering ───────────────────────────────────────────────

def test_list_keys_prefix_filtering(store):
    store.set_finding(_finding(cluster_id="a2a_X"))
    store.set_label("c1", "approve")
    store.set_config("a2a_transfer", {"k": 1})
    store.set_column("pattern_x", {"detector_name": "agent0_x"})

    finding_keys = store.list_keys("findings:")
    label_keys = store.list_keys("labels:")
    config_keys = store.list_keys("config:")
    column_keys = store.list_keys("columns:")

    assert all(k.startswith("findings:") for k in finding_keys)
    assert all(k.startswith("labels:") for k in label_keys)
    assert len(finding_keys) == 1
    assert len(label_keys) == 1
    assert len(column_keys) == 1
    # config: prefix should NOT match config_versions: by virtue of exact prefix,
    # but LIKE 'config:%' also matches 'config_versions' is false because of the colon.
    assert all(k.startswith("config:") for k in config_keys)


# ── persistence across store instances (proves on-disk write) ────────────────

def test_persistence_across_instances(tmp_path):
    db = str(tmp_path / "persist.db")
    s1 = MemoryStore(force_local=True, db_path=db)
    s1.set_finding(_finding())
    s1.set_label("c1", "approve")

    s2 = MemoryStore(force_local=True, db_path=db)
    assert len(s2.all_findings()) == 1
    assert s2.total_label_count() == 1


def test_delete(store):
    store.set("k", {"v": 1})
    assert store.get("k") == {"v": 1}
    store.delete("k")
    assert store.get("k") is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
