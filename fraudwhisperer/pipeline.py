"""
FraudWhisperer - Pipeline
Orchestrates the 5-agent fraud investigation handoff chain:
Finder -> Ranker -> Decider -> Explainer -> Agent 0 (Discovery)

Run directly with: python -m fraudwhisperer.pipeline
"""

from pathlib import Path

import pandas as pd

from fraudwhisperer.agents import (
    agent_decider,
    agent_explainer,
    agent_finder,
    agent_ranker,
    agent_zero,
)
from fraudwhisperer.memory_layer import clear_memory, handoff_log, log_handoff

DEFAULT_TRANSACTIONS_CSV = Path(__file__).resolve().parent / "transactions.csv"


def load_transactions(path: str | Path = DEFAULT_TRANSACTIONS_CSV) -> list[dict]:
    df = pd.read_csv(path, dtype=str)
    return df.to_dict(orient="records")


def run_pipeline(transactions: list[dict]) -> dict:
    handoff_log.clear()

    clear_memory()

    finder_result    = agent_finder.run(transactions)
    ranker_result    = agent_ranker.run()
    decider_result   = agent_decider.run()
    explainer_result = agent_explainer.run()
    agent0_result    = agent_zero.run(transactions)

    log_handoff("Pipeline", "COMPLETE",
        f"Verdict={explainer_result.get('verdict')} "
        f"Confidence={explainer_result.get('confidence')}%")

    return {
        "handoff_log": list(handoff_log),
        "finder":      finder_result,
        "ranker":      ranker_result,
        "decider":     decider_result,
        "explainer":   explainer_result,
        "agent0":      agent0_result,
    }


if __name__ == "__main__":
    transactions = load_transactions()
    print(f"Loaded {len(transactions)} transactions from CSV")

    result = run_pipeline(transactions)

    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
    print(f"Rings found:        {len(result['finder']['rings'])}")
    print(f"Structuring alerts: {len(result['finder']['structuring'])}")
    print(f"Decisions issued:   {len(result['decider']['decisions'])}")
    print(f"Verdict:            {result['explainer'].get('verdict')}")
    print(f"Confidence:         {result['explainer'].get('confidence')}%")
    new_pattern = result["agent0"].get("new_pattern")
    print(f"New pattern found:  {new_pattern.get('pattern_name') if new_pattern else 'None'}")
    print(f"\nMemory handoff log ({len(result['handoff_log'])} entries):")
    for entry in result["handoff_log"]:
        print(f"  [{entry['timestamp']}] {entry['agent']} | {entry['action']}")
