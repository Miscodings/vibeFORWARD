"""
FraudWhisperer - Agent 2 . Ranker
Reads finder_output, scores ring severity 0-100.
Writes to namespace: ranker_output
"""

import numpy as np

from fraudwhisperer.memory_layer import log_handoff, read_entities, write_entities


def run() -> dict:
    log_handoff("Agent 2 . Ranker", "READ FROM MEMORY",
        "Querying namespace=finder_output for Ring entities")

    rings = read_entities("finder_output", "Ring")

    log_handoff("Agent 2 . Ranker", "MEMORY RESULT",
        f"namespace=finder_output -> {len(rings)} Ring entities loaded")

    # -- Score each ring
    for ring in rings:
        amounts = ring.get("amounts", [])
        total   = ring.get("total_cycled", 0)
        hops    = ring.get("hops", 0)

        # Dollar volume score (0-40)
        vol_score = min(int(total / 1000), 40)

        # Hop tightness - fewer hops = tighter ring = more suspicious (0-25)
        hop_score = max(25 - (hops * 4), 0)

        # Threshold proximity - how close to $10k (0-20)
        threshold_score = 0
        if amounts:
            avg_proximity = sum(
                max(0, 20 - abs(a - 10000) / 100) for a in amounts
            ) / len(amounts)
            threshold_score = int(min(avg_proximity, 20))

        # Consistency score - low variance in amounts = coordinated (0-15)
        if len(amounts) > 1:
            variance = float(np.var(amounts))
            consistency = max(0, 15 - int(variance / 10000))
        else:
            consistency = 0

        severity = min(vol_score + hop_score + threshold_score + consistency, 100)

        ring["entity_type"]     = "RankedRing"
        ring["severity_score"]  = severity
        ring["score_breakdown"] = {
            "dollar_volume":       vol_score,
            "hop_tightness":       hop_score,
            "threshold_proximity": threshold_score,
            "consistency":         consistency,
        }
        ring["verdict_hint"] = (
            "ESCALATE" if severity >= 70 else
            "WATCH"    if severity >= 40 else
            "CLEAR"
        )

    rings.sort(key=lambda r: r["severity_score"], reverse=True)
    for i, r in enumerate(rings):
        r["rank"] = i + 1

    write_entities("ranker_output", rings)

    log_handoff("Agent 2 . Ranker", "WROTE TO MEMORY",
        f"namespace=ranker_output -> {len(rings)} RankedRing entities "
        f"(top severity: {rings[0]['severity_score'] if rings else 0})")

    return {"ranked_rings": rings}
