import { describe, it, expect } from "vitest";
import { buildReasoning, isCircularFlow } from "@/lib/case-reasoning";
import type { Case } from "@/lib/cases-data";
import type { CaseExtras } from "@/lib/cases-extras";

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: "c1",
    account_id: "ACC-1",
    severity: "CRITICAL",
    exposure: 87400,
    reason: "Hub of circular money flow",
    evidence: ["e1", "e2", "e3"],
    evaded_rule: "structuring below alert threshold",
    fraud_prob: 87,
    fraud_ci: [79, 93],
    recommended_action: "Freeze account",
    action_reason: "hub of circular flow",
    status: "open",
    ...overrides,
  };
}

function makeExtras(overrides: Partial<CaseExtras> = {}): CaseExtras {
  return {
    sla_hours: 14,
    case_status: "UNDER REVIEW",
    triggered_rules: ["VELOCITY-04", "DUP-TXN-11"],
    evaded_rules: [{ code: "THRESHOLD-10K", note: "amounts kept below $10K" }],
    flow: [],
    audit_seed: [],
    ...overrides,
  };
}

describe("buildReasoning reconciliation invariant", () => {
  it("baseline + Σ factor points === total === fraud_prob", () => {
    const c = makeCase();
    const r = buildReasoning(c, makeExtras());
    const sum = r.baseline + r.factors.reduce((s, f) => s + f.points, 0);
    expect(sum).toBe(r.total);
    expect(r.total).toBe(c.fraud_prob);
  });

  it("reconciles across a range of cases (with and without extras)", () => {
    const cases: Case[] = [
      makeCase({ fraud_prob: 41, severity: "REVIEW", exposure: 9200, evidence: ["only-one"] }),
      makeCase({ fraud_prob: 58, severity: "HIGH", exposure: 18400 }),
      makeCase({ fraud_prob: 99, severity: "CRITICAL", exposure: 250000 }),
    ];
    for (const c of cases) {
      const r1 = buildReasoning(c);
      const r2 = buildReasoning(c, makeExtras());
      for (const r of [r1, r2]) {
        const sum = r.baseline + r.factors.reduce((s, f) => s + f.points, 0);
        expect(sum).toBe(c.fraud_prob);
      }
    }
  });

  it("adds an explicit calibration factor when raw sum != fraud_prob", () => {
    // Low fraud_prob forces a negative calibration term.
    const c = makeCase({ fraud_prob: 41, severity: "REVIEW", exposure: 9200, evidence: ["one"] });
    const r = buildReasoning(c, makeExtras());
    const calibration = r.factors.find((f) => f.label === "Model calibration");
    expect(calibration).toBeDefined();
    // Still reconciles to the published score.
    expect(r.baseline + r.factors.reduce((s, f) => s + f.points, 0)).toBe(41);
  });
});

describe("buildReasoning factor contents", () => {
  it("includes a severity factor first", () => {
    const r = buildReasoning(makeCase());
    expect(r.factors[0].label).toContain("Severity");
  });

  it("includes a rules-fired factor scaled by triggered rule count", () => {
    const r = buildReasoning(makeCase(), makeExtras({ triggered_rules: ["A", "B", "C"] }));
    const rules = r.factors.find((f) => f.label.startsWith("Rules fired"));
    expect(rules?.points).toBe(18); // 3 * 6
  });

  it("adds a circular-flow factor when the flow loops back", () => {
    const loop = makeExtras({
      flow: [{ account: "ACC-1" }, { account: "ACC-2" }, { account: "ACC-1" }],
    });
    const r = buildReasoning(makeCase(), loop);
    expect(r.factors.some((f) => f.label === "Circular flow")).toBe(true);
  });
});

describe("isCircularFlow", () => {
  it("is true when first and last account match and length >= 3", () => {
    expect(
      isCircularFlow(
        makeExtras({ flow: [{ account: "A" }, { account: "B" }, { account: "A" }] }),
      ),
    ).toBe(true);
  });
  it("is false for short flows", () => {
    expect(isCircularFlow(makeExtras({ flow: [{ account: "A" }, { account: "A" }] }))).toBe(false);
  });
  it("is false when it does not return to origin", () => {
    expect(
      isCircularFlow(
        makeExtras({ flow: [{ account: "A" }, { account: "B" }, { account: "C" }] }),
      ),
    ).toBe(false);
  });
  it("is false when extras is undefined", () => {
    expect(isCircularFlow(undefined)).toBe(false);
  });
});
