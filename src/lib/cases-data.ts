export type Severity = "CRITICAL" | "HIGH" | "REVIEW";

export interface Case {
  id: string;
  account_id: string;
  severity: Severity;
  exposure: number;
  reason: string;
  evidence: string[];
  evaded_rule: string;
  fraud_prob: number;
  fraud_ci: [number, number];
  recommended_action: string;
  action_reason: string;
  status: string;
}

export const CASES: Case[] = [
  {
    id: "c1",
    account_id: "ACC-4471",
    severity: "CRITICAL",
    exposure: 87400,
    reason: "Hub of circular money flow",
    evidence: [
      "Funds routed through 5 accounts (ACC-4471 → 8821 → 3340 → 9912 → 4471) returning 96.4% of principal within 38 hours",
      "6 transfers of $9,400–$9,800, each under the $10K alert threshold, across 4 days",
      "Counterparties share device fingerprint d8f1::a4 logged on 4 of 5 accounts",
    ],
    evaded_rule: "structuring below alert threshold",
    fraud_prob: 87,
    fraud_ci: [79, 93],
    recommended_action: "Freeze account",
    action_reason: "hub of circular flow",
    status: "open",
  },
  {
    id: "c2",
    account_id: "ACC-8821",
    severity: "CRITICAL",
    exposure: 64200,
    reason: "Mule account receiving layered deposits",
    evidence: [
      "11 inbound transfers from 7 distinct accounts totaling $64,200 within 72h, 92% forwarded out within 4h",
      "Account opened 19 days ago, first activity within 36 hours of opening",
      "All outbound transfers routed to ACC-4471 (flagged hub)",
    ],
    evaded_rule: "new-account velocity check (threshold: 30 days)",
    fraud_prob: 84,
    fraud_ci: [76, 90],
    recommended_action: "Freeze account",
    action_reason: "confirmed mule in ring R-014",
  status: "open",
  },
  {
    id: "c3",
    account_id: "ACC-3340",
    severity: "CRITICAL",
    exposure: 58900,
    reason: "Duplicate-invoice payouts to shell vendor",
    evidence: [
      "4 payouts of $14,725 to vendor V-2210 with identical invoice hash within 9 days",
      "Vendor V-2210 incorporated 41 days ago, no prior transaction history bank-wide",
      "Payment memos differ by 1 character ('Inv #4421' vs 'Inv #4421 ')",
    ],
    evaded_rule: "duplicate-payment dedup (whitespace-sensitive)",
    fraud_prob: 81,
    fraud_ci: [72, 88],
    recommended_action: "Hold pending payouts",
    action_reason: "duplicate invoice signature confirmed",
    status: "open",
  },
  {
    id: "c4",
    account_id: "ACC-9912",
    severity: "HIGH",
    exposure: 41300,
    reason: "Velocity spike on dormant account",
    exposure_currency: undefined as never,
    evidence: [
      "Dormant 287 days, then 14 transactions totaling $41,300 in 6 hours",
      "Login geo shifted from Austin, TX (last seen) to Lagos, NG within 11 minutes",
      "3 outbound transfers to ACC-4471 ring members",
    ],
    evaded_rule: "geo-velocity (legacy carrier IP whitelisted)",
    fraud_prob: 76,
    fraud_ci: [68, 84],
    recommended_action: "Step-up authentication + freeze outbound",
    action_reason: "credential compromise likely",
    status: "open",
  } as Case,
  {
    id: "c5",
    account_id: "ACC-2287",
    severity: "HIGH",
    exposure: 38700,
    reason: "Round-tripping via crypto off-ramp",
    evidence: [
      "$38,700 sent to exchange E-04 in 5 tranches, $34,900 returned from same exchange to ACC-3340 within 26h",
      "Tranche sizes (7,200 / 7,400 / 7,800 / 8,100 / 8,200) ladder below $10K SAR threshold",
      "Counterparty wallet reused across 3 ring accounts",
    ],
    evaded_rule: "SAR threshold ($10,000) and same-counterparty grouping",
    fraud_prob: 73,
    fraud_ci: [64, 81],
    recommended_action: "File SAR + freeze",
    action_reason: "layering pattern with crypto off-ramp",
    status: "open",
  },
  {
    id: "c6",
    account_id: "ACC-7104",
    severity: "HIGH",
    exposure: 33500,
    reason: "Payroll deposit followed by full sweep",
    evidence: [
      "$33,500 ACH payroll credit at 09:02, full balance swept to 3 external accounts by 09:47",
      "Beneficiary accounts added 2h before deposit landed",
      "Same beneficiary IBAN appears on ACC-2287 and ACC-8821",
    ],
    evaded_rule: "new-payee cool-down (bypassed via mobile token)",
    fraud_prob: 69,
    fraud_ci: [60, 77],
    recommended_action: "Reverse outbound + freeze",
    action_reason: "payroll diversion pattern",
    status: "open",
  },
  {
    id: "c7",
    account_id: "ACC-5563",
    severity: "HIGH",
    exposure: 29800,
    reason: "Synthetic identity — thin-file rapid credit use",
    evidence: [
      "Account opened with SSN issued 2024, no credit history before 2026-03",
      "Credit line drawn to 98% within 11 days of approval",
      "Address matches 4 other accounts opened in past 90 days",
    ],
    evaded_rule: "thin-file underwriting override",
    fraud_prob: 67,
    fraud_ci: [58, 75],
    recommended_action: "Suspend credit line",
    action_reason: "synthetic identity indicators",
    status: "open",
  },
  {
    id: "c8",
    account_id: "ACC-6620",
    severity: "REVIEW",
    exposure: 18400,
    reason: "Repeated card-not-present declines then success",
    evidence: [
      "47 CNP authorization attempts at 6 merchants, 44 declined, 3 succeeded for $18,400 total",
      "Successful auths used CVV variations after BIN-range testing pattern",
      "Device fingerprint not seen on this account prior",
    ],
    evaded_rule: "auth-decline velocity (per-merchant, not per-card)",
    fraud_prob: 58,
    fraud_ci: [49, 66],
    recommended_action: "Block card + reissue",
    action_reason: "card testing succeeded",
    status: "open",
  },
  {
    id: "c9",
    account_id: "ACC-3098",
    severity: "REVIEW",
    exposure: 12600,
    reason: "ATM withdrawals across 3 states in 4h",
    evidence: [
      "$12,600 withdrawn in 9 transactions across Phoenix, Denver, Kansas City within 4h",
      "Card present at all 3 locations — chip read, not magstripe",
      "No matching travel notice or airline transaction on account",
    ],
    evaded_rule: "geographic plausibility check (chip-present override)",
    fraud_prob: 54,
    fraud_ci: [44, 62],
    recommended_action: "Block card + contact customer",
    action_reason: "physical card cloning suspected",
    status: "open",
  },
  {
    id: "c10",
    account_id: "ACC-1142",
    severity: "REVIEW",
    exposure: 9200,
    reason: "Small recurring transfers to unverified payee",
    evidence: [
      "Weekly $1,150 transfers to payee P-887 for 8 weeks, payee never confirmed via micro-deposit",
      "Memo line consistent ('rent') but payee address unverified",
      "No prior relationship between accounts bank-wide",
    ],
    evaded_rule: "unverified-payee recurring cap ($1,200/week)",
    fraud_prob: 41,
    fraud_ci: [33, 50],
    recommended_action: "Flag for manual review",
    action_reason: "possible romance/elder-fraud pattern",
    status: "open",
  },
];

export const HEADER_STATS = {
  flagged: 23,
  exposure: "$412K",
  ring_accounts: 12,
};

export const AGENT_PIPELINE = [
  {
    name: "Finder",
    summary: "detected 23 anomalies across duplicates, structuring, circular flows",
    recall: "⟲ Initialized from dataset (5,000 transactions, 90-day window)",
  },
  {
    name: "Ranker",
    summary: "scored 23 cases by exposure × confidence; top 7 above $30K threshold",
    recall: '⟲ Recalled from memory: Finder flagged "circular flow involving ACC-4471, 8821, 3340, 9912"',
  },
  {
    name: "Actor",
    summary: "drafted 23 recommended actions — 7 freezes, 4 SAR filings, 12 reviews",
    recall: '⟲ Recalled from memory: Ranker placed ACC-4471 at rank 1 (exposure $87.4K, confidence 87%)',
  },
  {
    name: "Explainer",
    summary: "generated analyst-facing rationale citing evaded rule for each case",
    recall: '⟲ Recalled from memory: Actor recommended "Freeze ACC-4471 — hub of circular flow"',
  },
];
