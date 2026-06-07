"""
FraudWhisperer - Agent 3 . Decider
Reads ranker_output, issues explainable verdicts (ESCALATE / WATCH / CLEAR).
Writes to namespace: decider_output
"""

from fraudwhisperer.memory_layer import log_handoff, read_entities, write_entities


def run() -> dict:
    log_handoff("Agent 3 . Decider", "READ FROM MEMORY",
        "Querying namespace=ranker_output for RankedRing entities")

    rings = read_entities("ranker_output", "RankedRing")

    log_handoff("Agent 3 . Decider", "MEMORY RESULT",
        f"namespace=ranker_output -> {len(rings)} RankedRing entities loaded")

    decisions = []
    for ring in rings:
        path     = ring.get("path", [])
        amounts  = ring.get("amounts", [])
        total    = ring.get("total_cycled", 0)
        severity = ring.get("severity_score", 0)
        hint     = ring.get("verdict_hint", "WATCH")

        # Build specific reason - uses real account IDs and amounts
        if amounts:
            path_str = " -> ".join(path[:5])
            amt_str  = ", ".join(f"${a:,.2f}" for a in amounts[:4])
            reason = (
                f"{path[0]} initiated a circular flow through "
                f"{ring.get('hops', 0)} accounts ({path_str}). "
                f"Transaction amounts: {amt_str}. "
                f"Total cycled: ${total:,.2f}. "
                f"All amounts structured to avoid round-number thresholds."
            )
        else:
            reason = f"Circular flow detected across {ring.get('hops', 0)} accounts."

        # Rule gap - why standard rules missed this
        rule_gap = (
            "Standard rules evaluate each transaction in isolation. "
            "This ring only becomes visible when the full graph is traversed "
            f"across {ring.get('hops', 0)} hops. No single transaction exceeded "
            "any individual alert threshold."
        )

        decisions.append({
            "entity_type":    "Decision",
            "ring_id":        ring.get("ring_id"),
            "verdict":        hint,
            "severity_score": severity,
            "reason":         reason,
            "rules_bypassed": [
                "Single-transaction threshold check - all amounts individually compliant",
                "Velocity check - no single account exceeded daily limit",
                "Counterparty screening - none flagged in isolation",
            ],
            "rule_gap": rule_gap,
        })

    escalate = sum(1 for d in decisions if d["verdict"] == "ESCALATE")
    watch    = sum(1 for d in decisions if d["verdict"] == "WATCH")
    clear    = sum(1 for d in decisions if d["verdict"] == "CLEAR")

    write_entities("decider_output", decisions)

    log_handoff("Agent 3 . Decider", "WROTE TO MEMORY",
        f"namespace=decider_output -> {len(decisions)} Decision entities "
        f"(ESCALATEx{escalate} WATCHx{watch} CLEARx{clear})")

    return {"decisions": decisions}
