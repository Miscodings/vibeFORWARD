// Maps each flagged case to a fraud-pattern archetype and a chart-ready dataset
// for the Visualize page. Patterns and language are modeled on the analyst
// findings from the track02_fraud_watch.csv investigation (ring networks,
// fan-in/fan-out funnels, fixed-cadence "heartbeat" scheduling, off-hours
// clustering, narrow amount-banding under reporting thresholds, dormant-account
// bursts, and synthetic-identity clusters).

export type PatternTone = "primary" | "critical" | "high" | "muted" | "success";

interface PatternBase {
  label: string;
  summary: string;
  insight: string;
}

export interface NetworkNode {
  id: string;
  label: string;
  role: "origin" | "relay" | "sink";
}

export interface NetworkEdge {
  source: string;
  target: string;
  amount?: number;
  date?: string;
  label?: string;
}

export interface NetworkPattern extends PatternBase {
  kind: "network";
  layout: "ring" | "hub";
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface BarSeries {
  key: string;
  label: string;
  tone: PatternTone;
}

export interface BarDatum {
  label: string;
  [seriesKey: string]: number | string;
}

export interface BarsPattern extends PatternBase {
  kind: "bars";
  xLabel: string;
  yLabel: string;
  unit: "currency" | "count";
  series: BarSeries[];
  bars: BarDatum[];
  referenceLine?: { value: number; label: string };
}

export interface TimelinePoint {
  t: number;
  label: string;
  value: number;
}

export interface TimelinePattern extends PatternBase {
  kind: "timeline";
  xLabel: string;
  yLabel: string;
  unit: "currency" | "count";
  points: TimelinePoint[];
  burstFrom?: number;
}

export interface CadenceCell {
  label: string;
  active: boolean;
  value?: number;
}

export interface CadencePattern extends PatternBase {
  kind: "cadence";
  axisLabel: string;
  unit: "currency" | "count";
  cells: CadenceCell[];
}

export type CasePattern = NetworkPattern | BarsPattern | TimelinePattern | CadencePattern;

export const CASE_PATTERNS: Record<string, CasePattern> = {
  c1: {
    kind: "network",
    layout: "ring",
    label: "Circular layering ring",
    summary:
      "Funds leave ACC-4471, pass through three relay accounts, and land back at the origin within 38 hours — a closed loop that returns 96.4% of the principal.",
    insight:
      "Every hop is sized to $9,400–$9,800 — just under the $10K alert line — turning a single suspicious transfer into four \"routine\" ones that individually clear every filter.",
    nodes: [
      { id: "ACC-4471", label: "ACC-4471", role: "origin" },
      { id: "ACC-2210", label: "ACC-2210", role: "relay" },
      { id: "ACC-8830", label: "ACC-8830", role: "relay" },
      { id: "ACC-9912", label: "ACC-9912", role: "relay" },
    ],
    edges: [
      { source: "ACC-4471", target: "ACC-2210", amount: 9600, date: "Jun 2" },
      { source: "ACC-2210", target: "ACC-8830", amount: 9400, date: "Jun 3" },
      { source: "ACC-8830", target: "ACC-9912", amount: 9750, date: "Jun 4" },
      { source: "ACC-9912", target: "ACC-4471", amount: 9550, date: "Jun 5" },
    ],
  },

  c2: {
    kind: "bars",
    label: "Layering fan-in / mule funnel",
    summary:
      "Eleven transfers from seven distinct accounts converge on ACC-8821 within 72 hours — and 92% of that money is forwarded onward again within four hours of arrival.",
    insight:
      "ACC-8821 never originates a transaction of its own; it only ever receives and relays — the textbook signature of a pass-through drop account opened 19 days before its first transfer.",
    xLabel: "Inbound sender",
    yLabel: "Amount received",
    unit: "currency",
    series: [{ key: "value", label: "Amount received", tone: "critical" }],
    bars: [
      { label: "PAYER-A", value: 11200 },
      { label: "PAYER-B", value: 9800 },
      { label: "PAYER-C", value: 9100 },
      { label: "PAYER-D", value: 8700 },
      { label: "PAYER-E", value: 8500 },
      { label: "PAYER-F", value: 8500 },
      { label: "PAYER-G", value: 8400 },
    ],
    referenceLine: { value: 10000, label: "$10K reporting threshold" },
  },

  c3: {
    kind: "cadence",
    label: "Fixed-cadence duplicate payouts",
    summary:
      "Four payouts of an identical $14,725 land on a near-metronomic rotation — May 28, 31, Jun 3, Jun 5 — each carrying the same invoice hash with a one-character whitespace difference.",
    insight:
      "Real vendor billing wobbles: late invoices, partial payments, the occasional skip. A payout this regular, to a vendor with no transaction history before 41 days ago, is a script — not an accounts-payable team.",
    axisLabel: "Late May – early June",
    unit: "currency",
    cells: [
      { label: "May 25", active: false },
      { label: "May 26", active: false },
      { label: "May 27", active: false },
      { label: "May 28", active: true, value: 14725 },
      { label: "May 29", active: false },
      { label: "May 30", active: false },
      { label: "May 31", active: true, value: 14725 },
      { label: "Jun 1", active: false },
      { label: "Jun 2", active: false },
      { label: "Jun 3", active: true, value: 14725 },
      { label: "Jun 4", active: false },
      { label: "Jun 5", active: true, value: 14725 },
    ],
  },

  c4: {
    kind: "timeline",
    label: "Dormant-to-burst velocity spike",
    summary:
      "287 days of near silence, then 14 transfers totaling $41,300 fire inside a single 6-hour window — moments after a login that jumped from Austin, TX to Lagos, NG.",
    insight:
      "Velocity rules are tuned for steady customers. An account that wakes from a year-long sleep and instantly maxes its transfer rate isn't a returning customer — it's a hijacked credential.",
    xLabel: "Days since last routine activity",
    yLabel: "Cumulative transfers",
    unit: "count",
    burstFrom: 287,
    points: [
      { t: 0, label: "Day 0 — last routine login (Austin, TX)", value: 0 },
      { t: 90, label: "Day 90 — dormant", value: 0 },
      { t: 180, label: "Day 180 — dormant", value: 0 },
      { t: 270, label: "Day 270 — dormant", value: 0 },
      { t: 287, label: "Day 287 — login from Lagos, NG (+11 min)", value: 0 },
      { t: 287.1, label: "+2h — 6 transfers fired", value: 6 },
      { t: 287.2, label: "+4h — 10 transfers fired", value: 10 },
      { t: 287.25, label: "+6h — burst complete: 14 transfers / $41,300", value: 14 },
    ],
  },

  c5: {
    kind: "bars",
    label: "Laddered tranches under SAR threshold",
    summary:
      "$38,700 leaves for crypto exchange E-04 in five tranches — 7,200 / 7,400 / 7,800 / 8,100 / 8,200 — each one a little larger than the last, all of it back within 26 hours.",
    insight:
      "Every tranche is shaped to clear the $10,000 SAR line by a comfortable margin, and the wallet on the other end is reused across three ring accounts — round-tripping dressed as five unrelated trades.",
    xLabel: "Outbound tranche (chronological)",
    yLabel: "Amount sent to exchange E-04",
    unit: "currency",
    series: [{ key: "value", label: "Tranche amount", tone: "high" }],
    bars: [
      { label: "Tranche 1", value: 7200 },
      { label: "Tranche 2", value: 7400 },
      { label: "Tranche 3", value: 7800 },
      { label: "Tranche 4", value: 8100 },
      { label: "Tranche 5", value: 8200 },
    ],
    referenceLine: { value: 10000, label: "$10K SAR filing threshold" },
  },

  c6: {
    kind: "timeline",
    label: "Payroll deposit → full sweep",
    summary:
      "A $33,500 payroll credit lands at 09:02 — and is fully drained to three external accounts within 45 minutes, before most analysts finish their morning coffee.",
    insight:
      "All three beneficiary accounts were added just two hours before the deposit landed. The new-payee cool-down exists precisely to catch this — and it was bypassed with a mobile token.",
    xLabel: "Minutes since 08:55",
    yLabel: "Account balance",
    unit: "currency",
    points: [
      { t: 0, label: "08:55 — opening balance", value: 1200 },
      { t: 7, label: "09:02 — payroll credit lands (+$33,500)", value: 34700 },
      { t: 20, label: "09:15 — sweep to EXT-1 (−$11,800)", value: 22900 },
      { t: 35, label: "09:28 — sweep to EXT-2 (−$11,200)", value: 11700 },
      { t: 52, label: "09:47 — sweep to EXT-3 (−$11,500) — emptied", value: 200 },
    ],
  },

  c7: {
    kind: "network",
    layout: "hub",
    label: "Synthetic-identity address cluster",
    summary:
      "ACC-5563's mailing address, device fingerprint, and SSN-issuance batch all reappear across four other accounts opened inside the same 90-day window.",
    insight:
      "No legitimate household opens five fresh credit lines from one address in three months. This is a fabricated paper trail being reused — not a family sharing a mailbox.",
    nodes: [
      { id: "ACC-5563", label: "ACC-5563", role: "origin" },
      { id: "ACC-7741", label: "ACC-7741", role: "relay" },
      { id: "ACC-2098", label: "ACC-2098", role: "relay" },
      { id: "ACC-6634", label: "ACC-6634", role: "relay" },
      { id: "ACC-9087", label: "ACC-9087", role: "sink" },
    ],
    edges: [
      { source: "ACC-5563", target: "ACC-7741", label: "same mailing address" },
      { source: "ACC-5563", target: "ACC-2098", label: "same SSN-issuance batch" },
      { source: "ACC-7741", target: "ACC-6634", label: "shared device fingerprint" },
      { source: "ACC-2098", target: "ACC-9087", label: "same mailing address" },
    ],
  },

  c8: {
    kind: "bars",
    label: "BIN-range card-testing",
    summary:
      "47 card-not-present attempts hit six merchants in rapid succession — 44 declines followed by 3 approvals, right after the CVV combination lands.",
    insight:
      "The approvals cluster immediately after a string of declines at the same merchant — a CVV brute-force signature that per-card velocity rules miss, because each merchant only ever sees its own slice of the attempts.",
    xLabel: "Merchant",
    yLabel: "Authorization attempts",
    unit: "count",
    series: [
      { key: "declined", label: "Declined", tone: "muted" },
      { key: "approved", label: "Approved", tone: "critical" },
    ],
    bars: [
      { label: "Merchant 1", declined: 8, approved: 0 },
      { label: "Merchant 2", declined: 9, approved: 1 },
      { label: "Merchant 3", declined: 7, approved: 0 },
      { label: "Merchant 4", declined: 6, approved: 1 },
      { label: "Merchant 5", declined: 8, approved: 1 },
      { label: "Merchant 6", declined: 6, approved: 0 },
    ],
  },

  c9: {
    kind: "cadence",
    label: "Cross-state ATM clustering",
    summary:
      "Nine withdrawals totaling $12,600 land back-to-back between 1 PM and 5 PM — physically present in Phoenix, Denver, and Kansas City within the same four-hour window.",
    insight:
      "Chip-present authentication insists the card was there each time. Geography says that's impossible — a cloned-chip cash-out crew working three cities in one afternoon.",
    axisLabel: "Hour of day (local)",
    unit: "currency",
    cells: [
      { label: "9 AM", active: false },
      { label: "10 AM", active: false },
      { label: "11 AM", active: false },
      { label: "12 PM", active: false },
      { label: "1 PM", active: true, value: 2800 },
      { label: "2 PM", active: true, value: 3100 },
      { label: "3 PM", active: true, value: 2900 },
      { label: "4 PM", active: true, value: 3800 },
      { label: "5 PM", active: false },
      { label: "6 PM", active: false },
      { label: "7 PM", active: false },
      { label: "8 PM", active: false },
    ],
  },

  c10: {
    kind: "cadence",
    label: "Heartbeat transfer to unverified payee",
    summary:
      "Eight consecutive weeks, the same $1,150 leaves for payee P-887 like clockwork — never missing a beat, never confirmed via micro-deposit.",
    insight:
      "Genuine recurring bills wobble — late fees, partial payments, the occasional skip. A payment this metronomic, to a payee that was never verified, fits a romance- or elder-fraud handler collecting on schedule.",
    axisLabel: "Week",
    unit: "currency",
    cells: Array.from({ length: 8 }, (_, i) => ({
      label: `Week ${i + 1}`,
      active: true,
      value: 1150,
    })),
  },
};

export function getCasePattern(caseId: string): CasePattern | undefined {
  return CASE_PATTERNS[caseId];
}
