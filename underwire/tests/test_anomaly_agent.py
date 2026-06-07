"""
Integration test: AnomalyAgent.run(df) writes findings to the store AND returns
them ranked descending; get_alerted_accounts reflects stored findings.
"""
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from memory.store import MemoryStore
from agents.anomaly_agent import AnomalyAgent

CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "transactions.csv")


@pytest.fixture()
def store(tmp_path):
    return MemoryStore(force_local=True, db_path=str(tmp_path / "agent.db"))


@pytest.fixture(scope="module")
def real_df():
    return pd.read_csv(CSV_PATH)


def test_run_writes_findings_to_store(store, real_df):
    agent = AnomalyAgent(store=store)
    returned = agent.run(real_df)
    assert returned, "expected findings from the real dataset"

    stored = store.all_findings()
    assert len(stored) > 0
    # every returned finding must be persisted in the store
    returned_ids = {f.cluster_id for f in returned}
    stored_ids = {fd["cluster_id"] for fd in stored}
    assert returned_ids <= stored_ids


def test_run_returns_ranked_descending(store, real_df):
    agent = AnomalyAgent(store=store)
    returned = agent.run(real_df)
    scores = [f.score for f in returned]
    assert scores == sorted(scores, reverse=True)


def test_get_alerted_accounts_reflects_store(store, real_df):
    agent = AnomalyAgent(store=store)
    returned = agent.run(real_df)

    expected = set()
    for f in returned:
        if f.action in ("escalate", "watch"):
            expected.update(f.members)

    alerted = agent.get_alerted_accounts(min_action="watch")
    assert alerted == expected

    # escalate-only subset
    escalate_only = set()
    for f in returned:
        if f.action == "escalate":
            escalate_only.update(f.members)
    assert agent.get_alerted_accounts(min_action="escalate") == escalate_only


def test_run_persists_across_store_instances(tmp_path, real_df):
    db = str(tmp_path / "persist_agent.db")
    AnomalyAgent(store=MemoryStore(force_local=True, db_path=db)).run(real_df)
    # fresh store on same DB reads the findings back
    s2 = MemoryStore(force_local=True, db_path=db)
    assert len(s2.all_findings()) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
