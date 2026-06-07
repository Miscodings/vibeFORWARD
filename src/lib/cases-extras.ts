// Dossier-style extras layered on top of CASES without rewriting them.
import type { Severity } from "./cases-data";

export type CaseStatus = "UNDER REVIEW" | "FROZEN" | "CLEARED" | "ESCALATED";

export interface RuleChip {
  code: string;
  note?: string;
}

export interface FlowNode {
  account: string;
  amount?: number;
  date?: string;
}

export interface AuditEntry {
  time: string;
  text: string;
}

export interface CaseExtras {
  sla_hours: number;
  case_status: CaseStatus;
  triggered_rules: string[];
  evaded_rules: RuleChip[];
  flow: FlowNode[];
  audit_seed: AuditEntry[];
}

// Keyed by case id from CASES.
export const CASE_EXTRAS: Record<string, CaseExtras> = {
  c1: {
    sla_hours: 14,
    case_status: "UNDER REVIEW",
    triggered_rules: ["VELOCITY-04", "DUP-TXN-11", "RING-DETECT-02"],
    evaded_rules: [{ code: "THRESHOLD-10K", note: "amounts kept at $9,400–$9,800" }],
    flow: [
      { account: "ACC-4471" },
      { account: "ACC-2210", amount: 9600, date: "Jun 2" },
      { account: "ACC-8830", amount: 9400, date: "Jun 3" },
      { account: "ACC-9912", amount: 9750, date: "Jun 4" },
      { account: "ACC-4471", amount: 9550, date: "Jun 5" },
    ],
    audit_seed: [
      { time: "09:14:22", text: "System opened case CASE-001142 from anomaly cluster #R-014" },
      { time: "10:02:51", text: "Ranker assigned priority 1 of 23 (exposure $87,400, confidence 87%)" },
    ],
  },
  c2: {
    sla_hours: 9,
    case_status: "UNDER REVIEW",
    triggered_rules: ["MULE-IO-07", "NEW-ACCT-VELOCITY-03"],
    evaded_rules: [{ code: "NEW-ACCT-30D", note: "first activity within 36h of opening" }],
    flow: [
      { account: "ACC-PAYER-A" },
      { account: "ACC-8821", amount: 8900, date: "Jun 1" },
      { account: "ACC-8821", amount: 9100, date: "Jun 2" },
      { account: "ACC-4471", amount: 8750, date: "Jun 2" },
      { account: "ACC-4471", amount: 9300, date: "Jun 3" },
    ],
    audit_seed: [
      { time: "09:18:04", text: "System linked ACC-8821 to ring R-014 via shared device d8f1::a4" },
      { time: "10:04:11", text: "Ranker assigned priority 2 of 23 (exposure $64,200, confidence 84%)" },
    ],
  },
  c3: {
    sla_hours: 31,
    case_status: "UNDER REVIEW",
    triggered_rules: ["DUP-TXN-11", "VENDOR-NEW-08"],
    evaded_rules: [{ code: "DEDUP-EXACT-MATCH", note: "memo whitespace bypass" }],
    flow: [
      { account: "ACC-3340" },
      { account: "VEND-2210", amount: 14725, date: "May 28" },
      { account: "VEND-2210", amount: 14725, date: "May 31" },
      { account: "VEND-2210", amount: 14725, date: "Jun 3" },
      { account: "VEND-2210", amount: 14725, date: "Jun 5" },
    ],
    audit_seed: [
      { time: "09:21:47", text: "System matched 4 invoice hashes via whitespace-normalized comparison" },
      { time: "10:06:22", text: "Ranker assigned priority 3 of 23 (exposure $58,900, confidence 81%)" },
    ],
  },
  c4: {
    sla_hours: 47,
    case_status: "UNDER REVIEW",
    triggered_rules: ["GEO-VELOCITY-05", "DORMANT-WAKE-02"],
    evaded_rules: [{ code: "CARRIER-IP-WHITELIST", note: "legacy carrier-grade NAT bypass" }],
    flow: [
      { account: "ACC-9912" },
      { account: "ACC-4471", amount: 7800, date: "Jun 4" },
      { account: "ACC-4471", amount: 8200, date: "Jun 4" },
      { account: "ACC-4471", amount: 9100, date: "Jun 4" },
    ],
    audit_seed: [
      { time: "09:23:09", text: "System detected geo shift Austin TX → Lagos NG within 11 minutes" },
      { time: "10:08:55", text: "Ranker assigned priority 4 of 23 (exposure $41,300, confidence 76%)" },
    ],
  },
  c5: {
    sla_hours: 22,
    case_status: "ESCALATED",
    triggered_rules: ["CRYPTO-OFFRAMP-06", "LAYERING-09"],
    evaded_rules: [{ code: "SAR-10K", note: "tranches laddered $7.2K–$8.2K" }],
    flow: [
      { account: "ACC-2287" },
      { account: "EXCH-04", amount: 7800, date: "Jun 1" },
      { account: "EXCH-04", amount: 8100, date: "Jun 2" },
      { account: "ACC-3340", amount: 34900, date: "Jun 3" },
    ],
    audit_seed: [
      { time: "09:26:33", text: "System matched return wallet to 3 prior ring accounts" },
      { time: "10:11:02", text: "Ranker assigned priority 5 of 23 (exposure $38,700, confidence 73%)" },
    ],
  },
  c6: {
    sla_hours: 53,
    case_status: "UNDER REVIEW",
    triggered_rules: ["PAYEE-NEW-04", "SWEEP-FULL-01"],
    evaded_rules: [{ code: "PAYEE-COOLDOWN-24H", note: "mobile-token override" }],
    flow: [
      { account: "EMPLOYER-ACH" },
      { account: "ACC-7104", amount: 33500, date: "Jun 6" },
      { account: "EXT-A", amount: 12000, date: "Jun 6" },
      { account: "EXT-B", amount: 11500, date: "Jun 6" },
      { account: "EXT-C", amount: 10000, date: "Jun 6" },
    ],
    audit_seed: [
      { time: "09:29:18", text: "System matched beneficiary IBAN to ACC-2287, ACC-8821" },
      { time: "10:13:41", text: "Ranker assigned priority 6 of 23 (exposure $33,500, confidence 69%)" },
    ],
  },
  c7: {
    sla_hours: 71,
    case_status: "UNDER REVIEW",
    triggered_rules: ["SYNTH-ID-02", "THIN-FILE-CREDIT-03"],
    evaded_rules: [{ code: "UW-THINFILE-OVERRIDE", note: "manual approval bypass" }],
    flow: [
      { account: "ACC-5563" },
      { account: "CREDIT-LINE", amount: 29200, date: "Jun 1" },
      { account: "EXT-WALLET-1", amount: 14800, date: "Jun 4" },
      { account: "EXT-WALLET-2", amount: 14400, date: "Jun 5" },
    ],
    audit_seed: [
      { time: "09:31:50", text: "System matched address to 4 accounts opened within 90 days" },
      { time: "10:15:28", text: "Ranker assigned priority 7 of 23 (exposure $29,800, confidence 67%)" },
    ],
  },
  c8: {
    sla_hours: 19,
    case_status: "UNDER REVIEW",
    triggered_rules: ["CARD-TEST-09", "AUTH-DECLINE-VEL-02"],
    evaded_rules: [{ code: "DECLINE-VEL-PER-MERCHANT", note: "rotated across 6 merchants" }],
    flow: [
      { account: "ACC-6620" },
      { account: "MERCH-A", amount: 6200, date: "Jun 5" },
      { account: "MERCH-B", amount: 5900, date: "Jun 5" },
      { account: "MERCH-C", amount: 6300, date: "Jun 6" },
    ],
    audit_seed: [
      { time: "09:34:11", text: "System detected 47 CNP attempts across 6 merchants in 38 min" },
      { time: "10:18:02", text: "Ranker assigned priority 8 of 23 (exposure $18,400, confidence 58%)" },
    ],
  },
  c9: {
    sla_hours: 66,
    case_status: "UNDER REVIEW",
    triggered_rules: ["GEO-IMPLAUSIBLE-04"],
    evaded_rules: [{ code: "CHIP-PRESENT-OVERRIDE", note: "physical card cloning suspected" }],
    flow: [
      { account: "ACC-3098" },
      { account: "ATM-PHX", amount: 4200, date: "Jun 6" },
      { account: "ATM-DEN", amount: 4200, date: "Jun 6" },
      { account: "ATM-MCI", amount: 4200, date: "Jun 6" },
    ],
    audit_seed: [
      { time: "09:36:44", text: "System detected 9 withdrawals across 3 states in 4 hours" },
      { time: "10:20:39", text: "Ranker assigned priority 9 of 23 (exposure $12,600, confidence 54%)" },
    ],
  },
  c10: {
    sla_hours: 88,
    case_status: "CLEARED",
    triggered_rules: ["RECURRING-UNVERIFIED-03"],
    evaded_rules: [{ code: "PAYEE-VERIFY-MICRO", note: "never confirmed via micro-deposit" }],
    flow: [
      { account: "ACC-1142" },
      { account: "PAYEE-887", amount: 1150, date: "Apr 22" },
      { account: "PAYEE-887", amount: 1150, date: "May 06" },
      { account: "PAYEE-887", amount: 1150, date: "Jun 03" },
    ],
    audit_seed: [
      { time: "09:39:01", text: "System flagged 8 weekly transfers to unverified payee P-887" },
      { time: "10:23:14", text: "Ranker assigned priority 10 of 23 (exposure $9,200, confidence 41%)" },
    ],
  },
};

export const STATUS_FALLBACK_BY_SEVERITY: Record<Severity, CaseStatus> = {
  CRITICAL: "UNDER REVIEW",
  HIGH: "UNDER REVIEW",
  REVIEW: "UNDER REVIEW",
};

export const AGENT_RULES: Record<string, { rules_executed: number; findings: number }> = {
  Finder: { rules_executed: 14, findings: 23 },
  Ranker: { rules_executed: 4, findings: 23 },
  Actor: { rules_executed: 6, findings: 23 },
  Explainer: { rules_executed: 2, findings: 23 },
};

const LETTERS = "ABCDEFGHIJ";
export const exhibitLabel = (i: number) => `EXHIBIT ${LETTERS[i] ?? String(i + 1)}`;
