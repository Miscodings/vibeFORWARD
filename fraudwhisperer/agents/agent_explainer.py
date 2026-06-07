"""
FraudWhisperer - Agent 4 . Explainer
Reads ALL namespaces and writes the analyst-facing case brief.
Writes to namespace: explainer_output
"""

from datetime import datetime

from anthropic import Anthropic

from fraudwhisperer.memory_layer import log_handoff, read_entities, write_entities

anthropic_client = Anthropic()


def run() -> dict:
    log_handoff("Agent 4 . Explainer", "READ FROM MEMORY",
        "Querying ALL namespaces: finder_output, ranker_output, decider_output")

    rings     = read_entities("ranker_output", "RankedRing")
    decisions = read_entities("decider_output", "Decision")
    alerts    = read_entities("finder_output", "StructuringAlert")
    mules     = read_entities("finder_output", "MuleCluster")

    log_handoff("Agent 4 . Explainer", "MEMORY RESULT",
        f"{len(rings)} RankedRing + {len(decisions)} Decision "
        f"+ {len(alerts)} StructuringAlert + {len(mules)} MuleCluster loaded")

    # -- Build narrative context
    top_ring     = rings[0]     if rings     else None
    top_decision = decisions[0] if decisions else None

    ring_desc = "No rings detected."
    if top_ring:
        ring_desc = (
            f"Primary ring: {' -> '.join(top_ring.get('path', [])[:6])}\n"
            f"Hops: {top_ring.get('hops')}, "
            f"Total cycled: ${top_ring.get('total_cycled', 0):,.2f}, "
            f"Severity: {top_ring.get('severity_score')}/100"
        )

    decision_desc = "No decisions issued."
    if top_decision:
        decision_desc = (
            f"Verdict: {top_decision.get('verdict')}\n"
            f"Reason: {top_decision.get('reason')}\n"
            f"Rule gap: {top_decision.get('rule_gap')}"
        )

    structuring_desc = (
        f"{len(alerts)} transactions structured just under round-number thresholds."
        if alerts else "No structuring detected."
    )

    mule_desc = (
        f"{len(mules)} mule/fan-in clusters detected."
        if mules else "No mule activity detected."
    )

    # -- Generate detective narrative
    prompt = f"""You are a senior financial crimes investigator writing a case brief
for an analyst who has 3 minutes to make a decision.

CASE DATA FROM MEMORY:
{ring_desc}

DECISION:
{decision_desc}

STRUCTURING: {structuring_desc}
MULE ACTIVITY: {mule_desc}

Write the brief in exactly 4 parts:
1. THE OPENING (2 sentences): What this looks like vs what it really is.
2. HOW THEY DID IT (1 paragraph): Walk through the ring step by step.
   Name the accounts. Name the amounts. Name the timestamps. Be specific.
3. WHY THE RULES MISSED IT (3 bullet points): Reference actual amounts
   and specific rules that were bypassed.
4. THE VERDICT (2 sentences): Your recommendation and confidence level.

Rules:
- Use account IDs literally (AC-0031 not "Account A")
- Every claim references a specific amount, account, or timestamp
- No hedge words - state what happened
- End with: Confidence: X%"""

    response = anthropic_client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )
    narrative = response.content[0].text

    # -- Evidence-weighted confidence (explainable formula)
    confidence = 0
    if top_ring:
        confidence += min(top_ring.get("severity_score", 0) * 0.5, 50)
    confidence += min(len(alerts) * 2, 20)
    confidence += min(len(mules) * 5, 15)
    if top_decision and top_decision.get("verdict") == "ESCALATE":
        confidence += 15
    confidence = min(int(confidence), 98)

    brief = {
        "entity_type":        "CaseBrief",
        "case_id":            f"CASE-{datetime.now().strftime('%Y%m%d-%H%M')}",
        "narrative":          narrative,
        "confidence":         confidence,
        "verdict":            top_decision.get("verdict") if top_decision else "INSUFFICIENT DATA",
        "top_ring_id":        top_ring.get("ring_id") if top_ring else None,
        "rings_found":        len(rings),
        "structuring_alerts": len(alerts),
        "mule_clusters":      len(mules),
    }

    write_entities("explainer_output", [brief])

    log_handoff("Agent 4 . Explainer", "WROTE TO MEMORY",
        f"namespace=explainer_output -> CaseBrief written "
        f"(verdict={brief['verdict']}, confidence={confidence}%)")

    return brief
