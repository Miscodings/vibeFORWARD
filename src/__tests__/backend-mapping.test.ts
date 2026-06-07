import { describe, it, expect } from "vitest";
import { findingToCase, findingToExtras } from "@/lib/backend-mapping";
import type { BackendFinding } from "@/lib/api-client";

function makeFinding(overrides: Partial<BackendFinding> = {}): BackendFinding {
  return {
    cluster_id: "CL-001",
    detector: "a2a_transfer",
    members: ["ACC-1", "ACC-2", "ACC-3"],
    score: 72.4,
    features: {
      total_value: 87400,
      night_frac: 0.62,
      n_txns: 11,
      cell_mean_amount: 9600,
    },
    score_breakdown: {
      night_frac: 12,
      burst_opening: 4,
      counterparty_conc: 8,
      value_norm: 20,
    },
    reason: "Circular money flow across new accounts",
    rules_fired: 0,
    action: "escalate",
    evidence_txn_ids: ["T1", "T2", "T3", "T4", "T5"],
    ...overrides,
  };
}

describe("findingToCase score clamping", () => {
  it("clamps score > 100 down to 99", () => {
    const c = findingToCase(makeFinding({ score: 150 }));
    expect(c.fraud_prob).toBe(99);
  });

  it("clamps score < 1 up to 1", () => {
    const c = findingToCase(makeFinding({ score: 0.2 }));
    expect(c.fraud_prob).toBe(1);
  });

  it("rounds an in-range score", () => {
    const c = findingToCase(makeFinding({ score: 72.4 }));
    expect(c.fraud_prob).toBe(72);
  });

  it("keeps the confidence interval within [1, 99]", () => {
    const c = findingToCase(makeFinding({ score: 99 }));
    expect(c.fraud_ci[0]).toBeGreaterThanOrEqual(1);
    expect(c.fraud_ci[1]).toBeLessThanOrEqual(99);
  });
});

describe("findingToCase severity / status / recommendation by action", () => {
  it("escalate → CRITICAL severity", () => {
    expect(findingToCase(makeFinding({ action: "escalate" })).severity).toBe("CRITICAL");
  });
  it("watch → HIGH severity", () => {
    expect(findingToCase(makeFinding({ action: "watch" })).severity).toBe("HIGH");
  });
  it("clear → REVIEW severity", () => {
    expect(findingToCase(makeFinding({ action: "clear" })).severity).toBe("REVIEW");
  });

  it("escalate + a2a_transfer → file SAR + freeze ring", () => {
    const c = findingToCase(makeFinding({ action: "escalate", detector: "a2a_transfer" }));
    expect(c.recommended_action).toBe("File SAR + freeze ring accounts");
  });
  it("escalate + structuring → file SAR structuring", () => {
    const c = findingToCase(makeFinding({ action: "escalate", detector: "structuring" }));
    expect(c.recommended_action).toBe("File SAR — structuring pattern");
  });
  it("escalate + mule_fanin → freeze + trace senders", () => {
    const c = findingToCase(makeFinding({ action: "escalate", detector: "mule_fanin" }));
    expect(c.recommended_action).toBe("Freeze account + trace senders");
  });
  it("escalate + unknown detector → generic escalate", () => {
    const c = findingToCase(makeFinding({ action: "escalate", detector: "whatever" }));
    expect(c.recommended_action).toBe("Escalate to compliance officer");
  });
  it("watch → enhanced monitoring", () => {
    expect(findingToCase(makeFinding({ action: "watch" })).recommended_action).toBe(
      "Flag for enhanced monitoring",
    );
  });
  it("clear → no immediate action", () => {
    expect(findingToCase(makeFinding({ action: "clear" })).recommended_action).toBe(
      "No immediate action required",
    );
  });
});

describe("findingToCase member label + exposure", () => {
  it("labels a single member with the bare account", () => {
    const c = findingToCase(makeFinding({ members: ["ACC-9"] }));
    expect(c.account_id).toBe("ACC-9");
  });
  it("labels two members joined with +", () => {
    const c = findingToCase(makeFinding({ members: ["ACC-1", "ACC-2"] }));
    expect(c.account_id).toBe("ACC-1 + ACC-2");
  });
  it("labels >2 members with an overflow count", () => {
    const c = findingToCase(makeFinding({ members: ["ACC-1", "ACC-2", "ACC-3"] }));
    expect(c.account_id).toBe("ACC-1 +2");
  });
  it("rounds exposure from total_value", () => {
    const c = findingToCase(makeFinding({ features: { total_value: 87400.7 } }));
    expect(c.exposure).toBe(87401);
  });
});

describe("buildEvidence (via findingToCase.evidence)", () => {
  it("includes total_value, night_frac, n_txns and sample ids", () => {
    const c = findingToCase(makeFinding());
    const joined = c.evidence.join(" | ");
    expect(c.evidence[0]).toBe("Circular money flow across new accounts");
    expect(joined).toContain("Total value at risk: $87,400");
    expect(joined).toContain("62% of transfers occurred 02:00–04:00 AM");
    expect(joined).toContain("11 transactions captured as evidence");
    expect(joined).toContain("Sample transaction IDs: T1, T2, T3, T4 …");
  });

  it("omits the ellipsis when 4 or fewer sample ids", () => {
    const c = findingToCase(makeFinding({ evidence_txn_ids: ["T1", "T2"] }));
    const joined = c.evidence.join(" | ");
    expect(joined).toContain("Sample transaction IDs: T1, T2");
    expect(joined).not.toContain("…");
  });

  it("omits night_frac line when zero", () => {
    const c = findingToCase(makeFinding({ features: { total_value: 100, night_frac: 0, n_txns: 2 } }));
    expect(c.evidence.join(" | ")).not.toContain("02:00");
  });
});

describe("buildTriggeredRules (via findingToExtras.triggered_rules)", () => {
  it("emits codes from score_breakdown signals", () => {
    const rules = findingToExtras(makeFinding()).triggered_rules;
    expect(rules).toContain("NIGHT-TRANSFER-01");
    expect(rules).toContain("NEW-ACCT-BURST-02");
    expect(rules).toContain("COUNTERPARTY-CONC-03");
    expect(rules).toContain("HIGH-VALUE-XFER-04");
  });

  it("adds detector-specific codes", () => {
    expect(findingToExtras(makeFinding({ detector: "mule_fanin" })).triggered_rules).toContain(
      "MULE-FANIN-07",
    );
    expect(findingToExtras(makeFinding({ detector: "structuring" })).triggered_rules).toContain(
      "STRUCTURING-09",
    );
  });

  it("falls back to GENERIC-FLAG-00 when nothing else fires but rules_fired > 0", () => {
    const f = makeFinding({
      detector: "other",
      score_breakdown: {},
      rules_fired: 2,
    });
    expect(findingToExtras(f).triggered_rules).toEqual(["GENERIC-FLAG-00"]);
  });

  it("emits no codes when nothing fires and rules_fired is 0", () => {
    const f = makeFinding({ detector: "other", score_breakdown: {}, rules_fired: 0 });
    expect(findingToExtras(f).triggered_rules).toEqual([]);
  });
});

describe("buildFlow (via findingToExtras.flow)", () => {
  it("maps each member to a flow node", () => {
    const flow = findingToExtras(makeFinding()).flow;
    expect(flow.map((n) => n.account)).toEqual(["ACC-1", "ACC-2", "ACC-3"]);
  });

  it("leaves the first node without amount/date and gives later nodes amounts", () => {
    const flow = findingToExtras(makeFinding()).flow;
    expect(flow[0].amount).toBeUndefined();
    expect(flow[0].date).toBeUndefined();
    expect(flow[1].amount).toBe(9600);
    expect(flow[1].date).toBe("Recent");
  });

  it("returns an empty flow for fewer than 2 members", () => {
    expect(findingToExtras(makeFinding({ members: ["ACC-1"] })).flow).toEqual([]);
  });
});

describe("findingToExtras sla_hours + case_status by action", () => {
  it("escalate → 14h, UNDER REVIEW", () => {
    const e = findingToExtras(makeFinding({ action: "escalate" }));
    expect(e.sla_hours).toBe(14);
    expect(e.case_status).toBe("UNDER REVIEW");
  });
  it("watch → 48h, UNDER REVIEW", () => {
    const e = findingToExtras(makeFinding({ action: "watch" }));
    expect(e.sla_hours).toBe(48);
    expect(e.case_status).toBe("UNDER REVIEW");
  });
  it("clear → 96h, CLEARED", () => {
    const e = findingToExtras(makeFinding({ action: "clear" }));
    expect(e.sla_hours).toBe(96);
    expect(e.case_status).toBe("CLEARED");
  });

  it("seeds an audit entry referencing the cluster and detector", () => {
    const e = findingToExtras(makeFinding());
    expect(e.audit_seed).toHaveLength(1);
    expect(e.audit_seed[0].text).toContain("CL-001");
    expect(e.audit_seed[0].text).toContain("a2a_transfer");
  });
});
