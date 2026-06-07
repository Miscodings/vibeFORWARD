// CSV import: pure, testable helpers for turning a CSV of cases into normalized
// CaseInput rows. Extracted from CaseDesk.tsx so the parser can be unit-tested
// in isolation. Behavior is identical to the original inline implementation.
import type { Severity } from "./cases-data";

// Normalized inputs for one case, shared by the manual form and the CSV importer.
export interface CaseInput {
  account_id: string;
  severity: Severity;
  exposure: number;
  reason: string;
  recommended_action?: string;
  action_reason?: string;
  evaded_rule?: string;
  fraud_prob: number;
  evidence: string[];
  triggered_rules: string[];
  sla_hours: number;
  counterparty?: string;
}

// Tiny RFC-4180-ish parser: handles quoted fields, embedded commas/newlines,
// and "" escapes. Header row drives a flexible column → field mapping.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const COLUMN_ALIASES: Record<keyof CaseInput, string[]> = {
  account_id: ["account_id", "account", "acct", "account id"],
  severity: ["severity", "sev"],
  exposure: ["exposure", "amount", "amount_at_risk", "exposure_usd", "value"],
  reason: ["reason", "description", "summary", "desc"],
  recommended_action: ["recommended_action", "action", "recommendation"],
  action_reason: ["action_reason", "action_rationale", "rationale"],
  evaded_rule: ["evaded_rule", "evaded", "evaded rule"],
  fraud_prob: ["fraud_prob", "risk", "risk_score", "score", "probability", "fraud_probability"],
  evidence: ["evidence", "exhibits"],
  triggered_rules: ["triggered_rules", "rules", "triggered"],
  sla_hours: ["sla_hours", "sla", "deadline_hours"],
  counterparty: ["counterparty", "flow_counterparty", "beneficiary", "to"],
};

export const parseNum = (s: string, fallback: number) => {
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};
// Evidence keeps natural commas; only split on | or ;. Rules also split on commas.
export const splitEvidence = (s: string) => s.split(/[|;]/).map((x) => x.trim()).filter(Boolean);
export const splitRules = (s: string) => s.split(/[|;,]/).map((x) => x.trim()).filter(Boolean);

export function normSeverity(v: string, prob: number): Severity {
  const s = v.trim().toUpperCase();
  if (s === "CRITICAL" || s === "HIGH" || s === "REVIEW") return s;
  return prob >= 80 ? "CRITICAL" : prob >= 50 ? "HIGH" : "REVIEW";
}

// Parse CSV text into normalized case inputs. Rows without an account id are skipped.
export function csvToCaseInputs(text: string): CaseInput[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {} as Partial<Record<keyof CaseInput, number>>;
  header.forEach((h, i) => {
    (Object.keys(COLUMN_ALIASES) as (keyof CaseInput)[]).forEach((field) => {
      if (col[field] === undefined && COLUMN_ALIASES[field].includes(h)) col[field] = i;
    });
  });
  const get = (row: string[], field: keyof CaseInput) => {
    const i = col[field];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const inputs: CaseInput[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const account_id = get(row, "account_id");
    if (!account_id) continue;
    const prob = parseNum(get(row, "fraud_prob"), 60);
    inputs.push({
      account_id,
      severity: normSeverity(get(row, "severity"), prob),
      exposure: parseNum(get(row, "exposure"), 0),
      reason: get(row, "reason"),
      recommended_action: get(row, "recommended_action") || undefined,
      action_reason: get(row, "action_reason") || undefined,
      evaded_rule: get(row, "evaded_rule") || undefined,
      fraud_prob: prob,
      evidence: splitEvidence(get(row, "evidence")),
      triggered_rules: splitRules(get(row, "triggered_rules")),
      sla_hours: Math.round(parseNum(get(row, "sla_hours"), 48)),
      counterparty: get(row, "counterparty") || undefined,
    });
  }
  return inputs;
}
