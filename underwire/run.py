"""
Underwire — one-command pipeline.

Usage:
    python run.py [path/to/transactions.csv]

Prints the ranked case queue to stdout.
"""
from __future__ import annotations
import sys
import os
import json
import pandas as pd

# Ensure the underwire package root is importable when run directly
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from detectors.registry import get_detectors
from memory.store import MemoryStore


def load_df(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["account_open_date"] = pd.to_datetime(df["account_open_date"])
    return df


def run_pipeline(csv_path: str, store: MemoryStore | None = None) -> list[dict]:
    if store is None:
        store = MemoryStore()

    df = load_df(csv_path)
    print(f"Loaded {len(df):,} transactions from {csv_path}")

    all_findings = []
    for det in get_detectors():
        findings = det.detect(df)
        for f in findings:
            store.set(f"findings:{det.name}:{f.cluster_id}", f.to_dict())
        all_findings.extend(findings)
        print(f"  [{det.name}] → {len(findings)} finding(s)")

    # Rank by score descending — score IS the rank
    ranked = sorted(all_findings, key=lambda f: f.score, reverse=True)

    print(f"\n{'='*70}")
    print(f"{'RANK':<5} {'CLUSTER':<40} {'SCORE':>6}  {'ACTION':<10}  MEMBERS")
    print(f"{'-'*70}")
    for i, f in enumerate(ranked, 1):
        members_str = ", ".join(f.members[:4]) + ("..." if len(f.members) > 4 else "")
        print(f"{i:<5} {f.cluster_id:<40} {f.score:>6.1f}  {f.action:<10}  {members_str}")
        print(f"      {f.reason}")
        print()

    escalated = [f for f in ranked if f.action == "escalate"]
    print(f"Summary: {len(ranked)} total findings, {len(escalated)} escalated, "
          f"{len([f for f in ranked if f.action=='watch'])} watched, "
          f"{len([f for f in ranked if f.action=='clear'])} cleared")

    return [f.to_dict() for f in ranked]


if __name__ == "__main__":
    csv_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(__file__), "data", "transactions.csv"
    )
    if not os.path.exists(csv_path):
        print(f"ERROR: CSV not found at {csv_path}")
        print("Generate it first: python data/generate_dataset.py")
        sys.exit(1)

    run_pipeline(csv_path)
