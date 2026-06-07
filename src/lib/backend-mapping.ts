/**
 * Maps Underwire BackendFinding objects to frontend Case + CaseExtras.
 *
 * Backend scores can exceed 100 (the formula sums sub-scores without a hard cap),
 * so we clamp fraud_prob to [1, 99].
 */
import type { Case, Severity } from "./cases-data";
import type { CaseExtras, CaseStatus } from "./cases-extras";
import type { BackendFinding } from "./api-client";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function actionToSeverity(action: BackendFinding["action"]): Severity {
  if (action === "escalate") return "CRITICAL";
  if (action === "watch") return "HIGH";
  return "REVIEW";
}

function actionToStatus(action: BackendFinding["action"]): CaseStatus {
  if (action === "escalate" || action === "watch") return "UNDER REVIEW";
  return "CLEARED";
}

function actionToRecommendation(
  action: BackendFinding["action"],
  detector: string,
): string {
  if (action === "escalate") {
    if (detector === "a2a_transfer") return "File SAR + freeze ring accounts";
    if (detector === "structuring") return "File SAR — structuring pattern";
    if (detector === "mule_fanin") return "Freeze account + trace senders";
    return "Escalate to compliance officer";
  }
  if (action === "watch") return "Flag for enhanced monitoring";
  return "No immediate action required";
}

function buildEvidence(f: BackendFinding): string[] {
  const ev: string[] = [f.reason];
  const feat = f.features;
  if (feat.total_value)
    ev.push(`Total value at risk: $${feat.total_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  if (feat.night_frac != null && feat.night_frac > 0)
    ev.push(`${Math.round(feat.night_frac * 100)}% of transfers occurred 02:00–04:00 AM`);
  if (feat.n_txns)
    ev.push(`${feat.n_txns} transactions captured as evidence`);
  if (f.evidence_txn_ids?.length)
    ev.push(`Sample transaction IDs: ${f.evidence_txn_ids.slice(0, 4).join(", ")}${f.evidence_txn_ids.length > 4 ? " …" : ""}`);
  return ev.filter(Boolean);
}

function buildEvadedRule(f: BackendFinding): string {
  if (f.rules_fired === 0) {
    if (f.detector === "a2a_transfer")
      return "amount-threshold alert (transfers kept $450–$850, below $1,000 trigger)";
    if (f.detector === "structuring")
      return "CTR threshold ($10,000 single-transaction rule)";
    if (f.detector === "mule_fanin")
      return "fan-in velocity rule";
  }
  return `${f.rules_fired} rule${f.rules_fired !== 1 ? "s" : ""} triggered`;
}

function buildTriggeredRules(f: BackendFinding): string[] {
  const codes: string[] = [];
  const bd = f.score_breakdown ?? {};
  if (bd.night_frac > 0) codes.push("NIGHT-TRANSFER-01");
  if (bd.burst_opening > 0) codes.push("NEW-ACCT-BURST-02");
  if (bd.counterparty_conc > 0) codes.push("COUNTERPARTY-CONC-03");
  if (bd.value_norm > 15) codes.push("HIGH-VALUE-XFER-04");
  if (f.detector === "mule_fanin") codes.push("MULE-FANIN-07");
  if (f.detector === "structuring") codes.push("STRUCTURING-09");
  if (codes.length === 0 && f.rules_fired > 0) codes.push("GENERIC-FLAG-00");
  return codes;
}

function buildFlow(f: BackendFinding): CaseExtras["flow"] {
  if (f.members.length < 2) return [];
  return f.members.map((acct, i) => ({
    account: acct,
    amount: i > 0 ? Math.round((f.features.cell_mean_amount ?? f.features.total_value / f.members.length) ?? 0) || undefined : undefined,
    date: i > 0 ? "Recent" : undefined,
  }));
}

/** Convert one BackendFinding into the frontend Case shape. */
export function findingToCase(f: BackendFinding): Case {
  const prob = clamp(Math.round(f.score), 1, 99);
  const memberLabel =
    f.members.length === 1
      ? f.members[0]
      : f.members.length === 2
      ? `${f.members[0]} + ${f.members[1]}`
      : `${f.members[0]} +${f.members.length - 1}`;

  return {
    id: f.cluster_id,
    account_id: memberLabel,
    severity: actionToSeverity(f.action),
    exposure: Math.round(f.features.total_value ?? 0),
    reason: f.reason,
    evidence: buildEvidence(f),
    evaded_rule: buildEvadedRule(f),
    fraud_prob: prob,
    fraud_ci: [clamp(prob - 8, 1, 99), clamp(prob + 6, 1, 99)],
    recommended_action: actionToRecommendation(f.action, f.detector),
    action_reason: `detected by ${f.detector.replace(/_/g, " ")} — score ${f.score.toFixed(1)}`,
    status: "open",
  };
}

/** Convert one BackendFinding into the frontend CaseExtras shape. */
export function findingToExtras(f: BackendFinding): CaseExtras {
  const slaByAction = { escalate: 14, watch: 48, clear: 96 } as const;
  return {
    sla_hours: slaByAction[f.action],
    case_status: actionToStatus(f.action),
    triggered_rules: buildTriggeredRules(f),
    evaded_rules: [{ code: buildEvadedRule(f).split(" ")[0].toUpperCase() }],
    flow: buildFlow(f),
    audit_seed: [
      {
        time: new Date().toTimeString().slice(0, 8),
        text: `Underwire detected ${f.cluster_id} via ${f.detector} — score ${f.score.toFixed(1)}, action: ${f.action}`,
      },
    ],
  };
}
