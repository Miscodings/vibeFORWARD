"""
FraudWhisperer - Agent 1 . Finder
Detects circular-flow rings, structuring, and mule/fan-in clusters.
Writes to namespace: finder_output
"""

from collections import defaultdict

import networkx as nx

from fraudwhisperer.memory_layer import log_handoff, write_entities


def run(transactions: list[dict]) -> dict:
    log_handoff("Agent 1 . Finder", "START",
        f"Scanning {len(transactions)} transactions for fraud patterns")

    # -- Build directed graph for ring detection
    G = nx.DiGraph()
    for t in transactions:
        G.add_edge(
            t["account_id"],
            t["counterparty_id"],
            txn_id=t["txn_id"],
            amount=float(t["amount"]),
            timestamp=t["timestamp"],
        )

    # -- Circular ring detection (networkx - not hand-rolled)
    raw_cycles = list(nx.simple_cycles(G))
    rings = []
    for i, cycle in enumerate(raw_cycles):
        if len(cycle) < 3:
            continue
        amounts = []
        txn_ids = []
        for j in range(len(cycle)):
            src = cycle[j]
            dst = cycle[(j + 1) % len(cycle)]
            edge = G.get_edge_data(src, dst)
            if edge:
                amounts.append(edge.get("amount", 0))
                txn_ids.append(edge.get("txn_id", ""))

        rings.append({
            "entity_type":  "Ring",
            "ring_id":      f"RING-{i+1:03d}",
            "path":         cycle + [cycle[0]],
            "hops":         len(cycle),
            "amounts":      amounts,
            "txn_ids":      txn_ids,
            "total_cycled": round(sum(amounts), 2),
            "avg_amount":   round(sum(amounts) / len(amounts), 2) if amounts else 0,
            "fraud_type":   "circular_flow",
        })

    # -- Structuring detection (amounts just under round thresholds)
    structuring = []
    thresholds = [10000, 5000, 3000]
    for t in transactions:
        amt = float(t["amount"])
        for threshold in thresholds:
            if threshold * 0.9 <= amt < threshold:
                structuring.append({
                    "entity_type":     "StructuringAlert",
                    "txn_id":          t["txn_id"],
                    "account_id":      t["account_id"],
                    "counterparty_id": t["counterparty_id"],
                    "amount":          amt,
                    "threshold":       threshold,
                    "below_by":        round(threshold - amt, 2),
                    "fraud_type":      "structuring",
                })
                break

    # -- Mule / fan-in detection (many accounts -> one counterparty)
    fan_in = defaultdict(list)
    for t in transactions:
        fan_in[t["counterparty_id"]].append(t["account_id"])

    mules = []
    for counterparty, senders in fan_in.items():
        unique_senders = list(set(senders))
        if len(unique_senders) >= 5:
            mules.append({
                "entity_type":     "MuleCluster",
                "counterparty_id": counterparty,
                "sender_count":    len(unique_senders),
                "sender_ids":      unique_senders,
                "fraud_type":      "mule_fan_in",
            })

    # -- Collect all flagged txn IDs (used by Agent 0)
    flagged_txn_ids = set()
    for r in rings:
        flagged_txn_ids.update(r["txn_ids"])
    for s in structuring:
        flagged_txn_ids.add(s["txn_id"])

    # -- Transaction summary so later agents can query accounts
    txn_summary = {
        "entity_type":     "TransactionSummary",
        "total":           len(transactions),
        "unique_accounts": len(set(t["account_id"] for t in transactions)),
        "date_range":      f"{min(t['timestamp'] for t in transactions)[:10]} to "
                           f"{max(t['timestamp'] for t in transactions)[:10]}",
        "flagged_txn_ids": list(flagged_txn_ids),
    }

    write_entities("finder_output", rings + structuring + mules + [txn_summary])

    log_handoff("Agent 1 . Finder", "WROTE TO MEMORY",
        f"namespace=finder_output -> {len(rings)} Ring + {len(structuring)} StructuringAlert "
        f"+ {len(mules)} MuleCluster entities written")

    return {
        "rings":           rings,
        "structuring":     structuring,
        "mules":           mules,
        "flagged_txn_ids": list(flagged_txn_ids),
    }
