"""
FraudWhisperer - Agent 0 . Pattern Discovery
Finds what Agents 1-4 missed by clustering unexplained residual transactions.
Writes to namespace: agent0_output
"""

import json
import re
from collections import Counter

from anthropic import Anthropic
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler

from fraudwhisperer.memory_layer import log_handoff, read_entities, write_entities

anthropic_client = Anthropic()


def run(transactions: list[dict]) -> dict:
    log_handoff("Agent 0 . Discovery", "READ FROM MEMORY",
        "Querying namespace=finder_output for flagged transaction IDs (collecting residuals)")

    # Collect all explained txn IDs already written by Agent 1
    explained_ids = set()
    for entity_type in ["Ring", "StructuringAlert", "MuleCluster", "TransactionSummary"]:
        for e in read_entities("finder_output", entity_type):
            explained_ids.update(e.get("txn_ids", []))
            explained_ids.update(e.get("flagged_txn_ids", []))
            if "txn_id" in e:
                explained_ids.add(e["txn_id"])

    residuals = [t for t in transactions if t["txn_id"] not in explained_ids]

    log_handoff("Agent 0 . Discovery", "RESIDUALS FOUND",
        f"{len(residuals)} of {len(transactions)} transactions unexplained by agents 1-4")

    if len(residuals) < 5:
        return {"new_pattern": None, "reason": "insufficient residuals for clustering"}

    # -- Encode features for DBSCAN
    cat_map: dict[str, int] = {}
    region_map: dict[str, int] = {}
    features = []

    for t in residuals:
        cat    = t.get("merchant_category", "unknown")
        region = t.get("ip_region", "unknown")
        cat_map.setdefault(cat, len(cat_map))
        region_map.setdefault(region, len(region_map))
        features.append([
            float(t["amount"]),
            cat_map[cat],
            region_map[region],
        ])

    X      = StandardScaler().fit_transform(features)
    labels = DBSCAN(eps=0.8, min_samples=3).fit_predict(X)
    counts = Counter(l for l in labels if l != -1)

    if not counts:
        return {"new_pattern": None, "reason": "DBSCAN found no clusters in residuals"}

    top_label = counts.most_common(1)[0][0]
    cluster   = [residuals[i] for i, l in enumerate(labels) if l == top_label]

    log_handoff("Agent 0 . Discovery", "CLUSTER FOUND",
        f"Largest unexplained cluster: {len(cluster)} transactions share similar features")

    # -- Ask Claude to name and describe the new pattern
    sample_lines = "\n".join([
        f"{t['txn_id']}: {t['account_id']} -> {t['counterparty_id']} "
        f"${float(t['amount']):,.2f} ({t['merchant_category']}, {t['ip_region']})"
        for t in cluster[:15]
    ])

    naming_response = anthropic_client.messages.create(
        model="claude-opus-4-5",
        max_tokens=500,
        messages=[{"role": "user", "content": f"""You are a financial crimes expert.
These {len(cluster)} transactions were NOT caught by structuring, circular flow,
or mule detection rules. They cluster together statistically.

SAMPLE:
{sample_lines}

Respond in JSON only (no markdown):
{{
  "pattern_name": "short descriptive name",
  "description": "one sentence: what makes these suspicious",
  "detection_rule": "specific rule to detect this in future",
  "risk_level": "HIGH or MEDIUM or LOW",
  "why_rules_missed_it": "one sentence"
}}"""}],
    )

    try:
        raw_text = naming_response.content[0].text
        clean    = re.sub(r"```json|```", "", raw_text).strip()
        pattern  = json.loads(clean)
    except (json.JSONDecodeError, IndexError):
        pattern = {
            "pattern_name":        "Unclassified Cluster",
            "description":         f"Statistical cluster of {len(cluster)} transactions with shared features",
            "detection_rule":      "Manual review required",
            "risk_level":          "MEDIUM",
            "why_rules_missed_it": "Pattern does not match known fraud typologies",
        }

    entity = {
        "entity_type":      "NewPattern",
        "discovered_by":    "Agent 0",
        "pattern_name":     pattern.get("pattern_name"),
        "description":      pattern.get("description"),
        "detection_rule":   pattern.get("detection_rule"),
        "risk_level":       pattern.get("risk_level"),
        "why_rules_missed": pattern.get("why_rules_missed_it"),
        "matched_txn_ids":  [t["txn_id"] for t in cluster],
        "matched_count":    len(cluster),
        "cluster_features": {
            "top_merchant_category": Counter(t["merchant_category"] for t in cluster).most_common(1)[0][0],
            "top_ip_region":         Counter(t["ip_region"] for t in cluster).most_common(1)[0][0],
            "avg_amount":            round(sum(float(t["amount"]) for t in cluster) / len(cluster), 2),
        },
    }

    write_entities("agent0_output", [entity])

    log_handoff("Agent 0 . Discovery", "WROTE TO MEMORY",
        f"namespace=agent0_output -> NewPattern '{entity['pattern_name']}' "
        f"({len(cluster)} transactions, risk={entity['risk_level']})")

    return {"new_pattern": entity, "cluster_size": len(cluster), "total_residuals": len(residuals)}
