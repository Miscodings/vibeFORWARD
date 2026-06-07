import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CASES, AGENT_PIPELINE, type Case, type Severity } from "@/lib/cases-data";
import { getCases, uploadTransactions, postDecision, getSarBlob, healthCheck } from "@/lib/api-client";
import { findingToCase, findingToExtras } from "@/lib/backend-mapping";
import {
  CASE_EXTRAS,
  AGENT_RULES,
  exhibitLabel,
  type AuditEntry,
  type CaseExtras,
  type CaseStatus,
} from "@/lib/cases-extras";
import { buildReasoning, synthesizeExtras, type ScoreFactor } from "@/lib/case-reasoning";
import { csvToCaseInputs, type CaseInput } from "@/lib/csv-import";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppHeader } from "@/components/AppHeader";

// Triage lifecycle for a case in the live queue.
//  OPEN      — awaiting a decision (sorts to the top)
//  ACCEPTED  — analyst confirmed the finding and took the recommended action
//  DISMISSED — cleared; sinks to the bottom of the queue
type Triage = "OPEN" | "ACCEPTED" | "DISMISSED";
// backend_cluster_id tracks the original cluster_id from the Python backend
// so we can send decisions and fetch SARs even when the frontend id differs.
type WorkCase = Case & { triage: Triage; backend_cluster_id?: string };


interface BreakdownSegment {
  label: string;
  count: number;
  color: string;
}

function BreakdownCard({
  title,
  caption,
  segments,
}: {
  title: string;
  caption?: string;
  segments: BreakdownSegment[];
}) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  return (
    <Card className="rounded-3xl border-border bg-surface shadow-sm transition-all duration-200">
      <CardHeader className="space-y-1 p-3 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        {caption && (
          <CardDescription className="text-[11px] leading-snug">{caption}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2.5 p-3 pt-0">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
          {segments.map((s) => (
            <div
              key={s.label}
              className="animate-bar-grow h-full transition-[width] duration-700 ease-out"
              style={{
                width: `${(s.count / total) * 100}%`,
                backgroundColor: s.color,
              }}
              title={`${s.label}: ${s.count}`}
            />
          ))}
        </div>
        <ul className="space-y-1">
          {segments.map((s) => {
            const pct = ((s.count / total) * 100).toFixed(1);
            return (
              <li key={s.label} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-3 w-[3px] rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="num font-semibold text-foreground tabular-nums">{pct}%</span>
                <span className="ml-auto text-muted-foreground">
                  <span className="num font-semibold text-foreground">{s.count}</span>
                  <span className="mx-1">·</span>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function SeverityBreakdownCard() {
  return (
    <BreakdownCard
      title="Severity Breakdown"
      segments={[
        { label: "Critical", count: 4, color: "var(--severity-critical)" },
        { label: "High", count: 9, color: "var(--severity-high)" },
        { label: "Review", count: 10, color: "var(--source-slate)" },
      ]}
    />
  );
}

const SEVERITY_SEGMENTS: BreakdownSegment[] = [
  { label: "Critical", count: 4, color: "var(--severity-critical)" },
  { label: "High", count: 9, color: "var(--severity-high)" },
  { label: "Review", count: 10, color: "var(--source-slate)" },
];

function SeverityBreakdownCollapsed() {
  const total = SEVERITY_SEGMENTS.reduce((s, x) => s + x.count, 0);
  const critical = SEVERITY_SEGMENTS[0].count;
  return (
    <Collapsible className="rounded-3xl border border-border bg-surface shadow-sm transition-all duration-200">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 p-3 text-left">
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-secondary">
          {SEVERITY_SEGMENTS.map((s) => (
            <div
              key={s.label}
              style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
              className="h-full"
            />
          ))}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          <Mono className="font-semibold text-foreground">{total}</Mono> findings ·{" "}
          <Mono className="font-semibold text-foreground">{critical}</Mono> critical
        </span>
        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-data-[state=open]:rotate-90">
          ▸
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <ul className="space-y-1">
          {SEVERITY_SEGMENTS.map((s) => {
            const pct = ((s.count / total) * 100).toFixed(1);
            return (
              <li key={s.label} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-3 w-[3px] rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="num font-semibold text-foreground tabular-nums">{pct}%</span>
                <span className="ml-auto text-muted-foreground">
                  <span className="num font-semibold text-foreground">{s.count}</span>
                  <span className="mx-1">·</span>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}


function FindingsBySourceCard() {
  return (
    <BreakdownCard
      title="Findings by Source"
      caption="Detected by Finder across 3 rule sets"
      segments={[
        { label: "Circular flows", count: 6, color: "var(--source-blue)" },
        { label: "Structuring", count: 11, color: "var(--source-teal)" },
        { label: "Duplicate transactions", count: 6, color: "var(--source-slate)" },
      ]}
    />
  );
}


const formatExposure = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`;

const formatAmount = (n: number) =>
  `$${n.toLocaleString("en-US")}`;

const severityStyles: Record<Severity, string> = {
  CRITICAL: "bg-severity-critical-bg text-severity-critical",
  HIGH: "bg-severity-high-bg text-severity-high",
  REVIEW: "bg-severity-review-bg text-severity-review",
};

const severityBar: Record<Severity, string> = {
  CRITICAL: "bg-severity-critical",
  HIGH: "bg-severity-high",
  REVIEW: "bg-severity-review",
};

const statusStampColor: Record<CaseStatus, { fg: string; bg: string }> = {
  "UNDER REVIEW": { fg: "var(--stamp-amber)", bg: "var(--stamp-amber-bg)" },
  FROZEN: { fg: "var(--stamp-red)", bg: "var(--stamp-red-bg)" },
  CLEARED: { fg: "var(--stamp-green)", bg: "var(--stamp-green-bg)" },
  ESCALATED: { fg: "var(--stamp-blue)", bg: "var(--stamp-blue-bg)" },
};

const riskColor = (n: number) =>
  n >= 80 ? "text-severity-critical" : n >= 50 ? "text-severity-high" : "text-severity-review";

function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}

// A circle of 12 dots connected by one continuous thread — the Filum mark.
function ThreadGlyph({ className = "" }: { className?: string }) {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return {
      x: (12 + 8 * Math.cos(angle)).toFixed(2),
      y: (12 + 8 * Math.sin(angle)).toFixed(2),
    };
  });
  const path = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x} ${d.y}`).join(" ") + " Z";
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path d={path} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.45" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.4" fill="currentColor" />
      ))}
    </svg>
  );
}

function StatusStamp({ status, size = "md" }: { status: CaseStatus; size?: "sm" | "md" }) {
  const c = statusStampColor[status];
  const dims =
    size === "sm"
      ? "px-2 py-0.5 text-[9.5px] tracking-[0.18em]"
      : "px-2.5 py-1 text-[11px] tracking-[0.2em]";
  return (
    <span
      className={`inline-flex select-none items-center gap-1.5 rounded-full border border-dashed font-semibold uppercase transition-all duration-200 ${dims}`}
      style={{
        color: c.fg,
        backgroundColor: c.bg,
        borderColor: c.fg,
        transform: "rotate(-2deg)",
      }}
    >
      <ThreadGlyph className="h-3 w-3" />
      {status}
    </span>
  );
}

function SeverityBadge({ s }: { s: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wider transition-all duration-200 ${severityStyles[s]}`}
    >
      {s}
    </span>
  );
}


function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col rounded-3xl border border-border bg-surface px-4 py-2.5 shadow-sm transition-all duration-200">
      <Mono className="text-3xl font-bold tracking-tight text-foreground leading-none">{value}</Mono>
      <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function SlaChip({ hours }: { hours: number }) {
  const urgent = hours < 24;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-all duration-200 ${
        urgent
          ? "border-severity-critical/30 bg-severity-critical-bg text-severity-critical"
          : "border-border bg-secondary text-muted-foreground"
      }`}
    >
      <span>⏱</span>
      <Mono className="font-semibold">{hours}h</Mono>
      <span>to regulatory deadline</span>
    </span>
  );
}


function CaseCard({
  c,
  extras,
  active,
  onClick,
}: {
  c: WorkCase;
  extras?: CaseExtras;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative w-full shrink-0 overflow-hidden rounded-2xl border bg-surface p-3.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md ${
        active
          ? "border-border before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary before:content-['']"
          : "border-border hover:border-foreground/20"
      }`}
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${severityBar[c.severity]} ${active ? "opacity-0" : ""}`} />

      {extras && (
        <span className="absolute right-2.5 top-2.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] ${
              extras.sla_hours < 24
                ? "border-severity-critical/30 bg-severity-critical-bg text-severity-critical"
                : "border-border bg-secondary text-muted-foreground"
            }`}
          >
            <Mono className="font-semibold">{extras.sla_hours}h</Mono>
          </span>
        </span>
      )}
      <div className="flex flex-col gap-1.5 pl-1.5 pr-9">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Mono className="text-xs text-muted-foreground">{c.account_id}</Mono>
            {c.triage !== "OPEN" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide ${
                  c.triage === "ACCEPTED"
                    ? "bg-[color:var(--stamp-green-bg)] text-[color:var(--stamp-green)]"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {c.triage}
              </span>
            )}
          </span>
          <Mono className={`text-base font-bold leading-none ${riskColor(c.fraud_prob)}`}>
            {c.fraud_prob}
          </Mono>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Mono className="text-lg font-bold text-foreground">{formatExposure(c.exposure)}</Mono>
          <SeverityBadge s={c.severity} />
        </div>
        <p className="line-clamp-2 text-sm leading-snug text-foreground/85">{c.reason}</p>

        <div className="flex flex-col gap-1 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 font-medium uppercase tracking-wide text-foreground/60">
              Recommended
            </span>
            <span className="truncate text-foreground/85">{c.recommended_action}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 font-medium uppercase tracking-wide text-foreground/60">
              Evaded
            </span>
            <Mono className="truncate text-[10px] text-foreground/85">{c.evaded_rule}</Mono>
          </div>
        </div>
      </div>
    </button>
  );
}




function FraudBar({ prob, ci }: { prob: number; ci: [number, number] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">Fraud likelihood</span>
        <span>
          <Mono className="text-2xl font-semibold text-foreground">{prob}%</Mono>
          <span className="ml-2 text-muted-foreground">
            [<Mono>{ci[0]}–{ci[1]}%</Mono> confidence]
          </span>
        </span>
      </div>
      <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="absolute top-0 h-full bg-primary/15"
          style={{ left: `${ci[0]}%`, width: `${ci[1] - ci[0]}%` }}
        />
        <div className="absolute top-0 h-full bg-primary" style={{ width: `${prob}%` }} />
      </div>
    </div>
  );
}

function RulesRow({ extras }: { extras?: CaseExtras }) {
  if (!extras) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Rules
      </h3>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Triggered:
          </span>
          {extras.triggered_rules.map((r) => (
            <span
              key={r}
              className="inline-flex items-center rounded-full bg-severity-critical-bg px-2.5 py-0.5 text-xs font-semibold text-severity-critical transition-all duration-200"
            >
              <Mono>{r}</Mono>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evaded:
          </span>
          {extras.evaded_rules.map((r) => (
            <span
              key={r.code}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-transparent px-2.5 py-0.5 text-xs text-foreground/80 transition-all duration-200"
            >
              <Mono className="font-semibold">{r.code}</Mono>
              {r.note && <span className="text-muted-foreground">({r.note})</span>}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}


function MoneyFlowTimeline({ extras }: { extras?: CaseExtras }) {
  if (!extras || extras.flow.length === 0) return null;
  const nodes = extras.flow;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Money flow timeline
      </h3>
      <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm transition-all duration-200">
        <div className="relative px-4 pb-12 pt-5">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {nodes.map((n, i) => (
              <div key={i} className="flex shrink-0 items-center gap-1">
                <div className="inline-flex items-center rounded-md border border-border bg-secondary px-2.5 py-1.5">
                  <Mono className="text-xs font-semibold text-foreground">{n.account}</Mono>
                </div>
                {i < nodes.length - 1 && (
                  <div className="flex shrink-0 flex-col items-center px-1 text-center">
                    <Mono className="text-[11px] font-semibold leading-tight text-foreground">
                      {nodes[i + 1].amount != null ? formatAmount(nodes[i + 1].amount!) : ""}
                    </Mono>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      <Mono>{nodes[i + 1].date ?? ""}</Mono>
                    </span>
                    <span className="-mt-0.5 text-base leading-none text-muted-foreground">→</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Curved return path */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-6 right-6 bottom-3 h-8 rounded-b-[999px] border-x-2 border-b-2 border-severity-critical/50"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
            <span className="rounded-sm bg-surface px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-severity-critical">
              ↺ Circular Flow Detected
            </span>
          </div>
        </div>
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <Mono>{nodes.length}</Mono> hops · return-to-origin within{" "}
          <Mono>{Math.max(1, nodes.length - 1) * 24}h</Mono> window
        </div>
      </div>
    </section>
  );
}

function AuditLogList({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="max-h-[60vh] overflow-y-auto">
      {entries.map((e, i) => (
        <li key={i} className="flex gap-3 py-1 text-xs leading-relaxed">
          <Mono className="shrink-0 text-muted-foreground">{e.time}</Mono>
          <span className="text-foreground/85">{e.text}</span>
        </li>
      ))}
    </ol>
  );
}



// ---- Reasoning: make every algorithmic decision legible to the analyst ----

function FactorRow({ f, max }: { f: ScoreFactor; max: number }) {
  const negative = f.points < 0;
  const width = max > 0 ? (Math.abs(f.points) / max) * 100 : 0;
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{f.label}</span>
        <Mono
          className={`shrink-0 text-sm font-bold tabular-nums ${
            negative ? "text-severity-review" : "text-severity-critical"
          }`}
        >
          {negative ? "" : "+"}
          {f.points}
        </Mono>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            negative ? "bg-severity-review/50" : "bg-severity-critical/70"
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-xs leading-snug text-muted-foreground">{f.detail}</p>
    </li>
  );
}

function ReasoningPanel({ c, extras }: { c: Case; extras?: CaseExtras }) {
  const r = useMemo(() => buildReasoning(c, extras), [c, extras]);
  const max = Math.max(r.baseline, ...r.factors.map((f) => Math.abs(f.points)));

  return (
    <section className="rounded-3xl border border-rule-border bg-rule-bg/60 p-5 shadow-sm transition-all duration-200">
      <div className="flex items-center gap-2">
        <ThreadGlyph className="h-4 w-4 text-severity-high" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Why the model flagged this
        </h3>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-foreground/90">{r.headline}</p>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          How the RISK {r.total} score was built
        </p>
        <ul className="divide-y divide-border/60">
          <li className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="text-sm font-medium text-foreground">Population baseline</span>
            <Mono className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
              {r.baseline}
            </Mono>
          </li>
          {r.factors.map((f) => (
            <FactorRow key={f.label} f={f} max={max} />
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-foreground/20 pt-2">
          <span className="text-sm font-bold uppercase tracking-wide text-foreground">
            Final risk score
          </span>
          <Mono className={`shrink-0 text-xl font-bold tabular-nums ${riskColor(r.total)}`}>
            {r.total}/100
          </Mono>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Confidence
          </p>
          <p className="mt-1 text-xs leading-snug text-foreground/85">{r.confidenceNote}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            How it evaded detection
          </p>
          <p className="mt-1 text-xs leading-snug text-foreground/85">{r.evasionNote}</p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border-l-4 border-primary/50 bg-primary/5 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Why this action is recommended
        </p>
        <p className="mt-1 text-xs leading-snug text-foreground/90">{r.actionRationale}</p>
      </div>
    </section>
  );
}

const nowStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function CaseDetail({
  c,
  extras,
  onAccept,
  onDismiss,
  onArchive,
  onDownload,
}: {
  c: Case;
  extras?: CaseExtras;
  onAccept: (id: string, reason: string) => void;
  onDismiss: (id: string, reason: string) => void;
  onArchive: (id: string) => void;
  onDownload?: () => void;
}) {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [caseStatus, setCaseStatus] = useState<CaseStatus | undefined>(extras?.case_status);

  // Reset audit log + status when switching cases.
  useEffect(() => {
    setAudit([...(extras?.audit_seed ?? [])].reverse());
    setCaseStatus(extras?.case_status);
  }, [c.id, extras]);

  const append = (text: string) =>
    setAudit((prev) => [{ time: nowStamp(), text }, ...prev]);

  // Accept = confirm the finding and take the model's recommended action.
  const onAcceptClick = () => {
    const isFreeze = /(freeze|sar|hold|suspend|block|reverse)/i.test(c.recommended_action);
    const note = `Analyst accepted ${c.account_id} — actioned "${c.recommended_action}" (${c.action_reason})`;
    setCaseStatus(isFreeze ? "FROZEN" : "ESCALATED");
    append(note);
    onAccept(c.id, note);
  };
  // Dismiss = clear the case; it sinks to the bottom of the queue.
  const onDismissClick = () => {
    const note = `Analyst dismissed ${c.account_id} — cleared, moved to bottom of queue`;
    setCaseStatus("CLEARED");
    append(note);
    onDismiss(c.id, note);
  };
  // Archive = remove the case from the queue entirely.
  const onArchiveClick = () => onArchive(c.id);

  const handleDownloadClick = () => {
    append(`Analyst downloaded SAR for ${c.account_id} — audit log + model reasoning included`);
    onDownload?.();
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto">
      {/* 1. Identity + Risk */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Mono className="text-xl font-bold text-foreground">{c.account_id}</Mono>
          {caseStatus && <StatusStamp status={caseStatus} />}
          <Link
            href={`/visualize?case=${c.id}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-all duration-200 hover:-translate-y-px hover:bg-accent hover:shadow-md"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
              <path d="M3 16l5-6 4 4 5-7 4 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Visualize pattern
          </Link>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Mono className={`text-5xl font-bold leading-none ${riskColor(c.fraud_prob)}`}>
            RISK {c.fraud_prob}
          </Mono>
          <span className="text-xl text-muted-foreground">/100</span>
        </div>
        <div className="text-sm text-muted-foreground">
          <Mono>{c.fraud_ci[0]}–{c.fraud_ci[1]}%</Mono> confidence
        </div>
      </section>

      {/* 2. Reasoning — always visible: every decision the model made, explained */}
      <ReasoningPanel c={c} extras={extras} />

      {/* 3. Recommendation card — decision zone */}
      <section className="rounded-3xl border border-border bg-[color:var(--color-blush)] p-6 text-ink shadow-sm transition-all duration-200">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recommended next step
        </p>
        <p className="mb-4 text-sm text-ink/85">
          <span className="font-semibold text-ink">{c.recommended_action}</span>
          <span className="text-muted-foreground"> — {c.action_reason}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onAcceptClick}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary-hover hover:shadow-md ring-2 ring-primary/40"
          >
            Accept
          </button>
          <button
            onClick={onDismissClick}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:shadow-md"
          >
            Dismiss
          </button>
          <button
            onClick={onArchiveClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-severity-critical/30 bg-severity-critical-bg px-5 py-2.5 text-sm font-medium text-severity-critical transition-all duration-200 hover:bg-severity-critical hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Archive
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Filum — Case File</span> · ready to download
            </span>
            <button
              onClick={handleDownloadClick}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:shadow-md"
            >
              <ThreadGlyph className="h-3.5 w-3.5 text-muted-foreground" />
              Download SAR
            </button>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">Accept</span> confirms the finding and logs the recommended action ·{" "}
          <span className="font-semibold text-foreground">Dismiss</span> clears it and sends it to the bottom of the queue ·{" "}
          <span className="font-semibold text-foreground">Archive</span> removes it from the queue entirely.
        </p>
      </section>

      {/* 4. Tabs */}
      <Tabs defaultValue="evidence" className="w-full">
        <TabsList className="rounded-full bg-secondary p-1">
          <TabsTrigger value="evidence" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Evidence</TabsTrigger>
          <TabsTrigger value="flow" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Money flow</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-full px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm">Audit log</TabsTrigger>
        </TabsList>


        <TabsContent value="evidence" className="flex flex-col gap-5 pt-4">
          <RulesRow extras={extras} />
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Exhibit List
            </h3>
            <ol className="space-y-1">
              {c.evidence.map((e, i) => (
                <li key={i} className="flex gap-3 px-3 py-2.5 text-sm leading-relaxed">
                  <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {exhibitLabel(i)}
                  </span>
                  <span className="text-foreground/90">{e}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-2xl border-l-4 border-rule-border bg-rule-bg px-3 py-2 text-sm">
              <span className="font-semibold text-foreground">Evaded rule:</span>{" "}
              <span className="text-foreground/85">{c.evaded_rule}</span>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="flow" className="pt-4">
          <MoneyFlowTimeline extras={extras} />
        </TabsContent>

        <TabsContent value="audit" className="pt-4">
          <AuditLogList entries={audit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}


function AgentPipeline() {
  const [expanded, setExpanded] = useState<string | null>("Finder");
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Agent Pipeline
      </h3>
      <ol className="space-y-3">
        {AGENT_PIPELINE.map((a, i) => {
          const stats = AGENT_RULES[a.name];
          const isOpen = expanded === a.name;
          return (
            <li key={a.name} className="rounded-3xl border border-border bg-surface shadow-sm transition-all duration-200">
              <button
                onClick={() => setExpanded(isOpen ? null : a.name)}
                className="flex w-full items-center gap-2 p-5 text-left"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>

                <span className="text-sm font-semibold text-foreground">
                  <Mono>{i + 1}.</Mono> {a.name}
                </span>
                <span
                  className="ml-auto text-xs text-muted-foreground transition-transform"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  ▸
                </span>
              </button>
              <p className="px-5 pb-3 text-sm leading-snug text-foreground/85">
                <span className="font-medium">{a.name}:</span> {a.summary}
              </p>
              {isOpen && (
                <div className="px-5 pb-5">
                  {stats && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      {a.name}: <Mono>{stats.rules_executed}</Mono> detection rules executed ·{" "}
                      <Mono>{stats.findings}</Mono> findings
                    </p>
                  )}
                  <p className="border-l-2 border-primary/40 bg-primary/5 px-2 py-1 text-xs italic leading-snug text-primary">
                    {a.recall}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Add-case intake form. Everything the dashboard needs for a new case is
// captured here and turned into a live queue entry + its reasoning/extras.
// ---------------------------------------------------------------------------

interface NewCasePayload {
  caseData: Case;
  extras: CaseExtras;
}

const SEVERITY_OPTIONS: Severity[] = ["CRITICAL", "HIGH", "REVIEW"];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clampInt = (v: string, lo: number, hi: number, fallback: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};

// Turn normalized inputs into a queue-ready case + its synthesized dossier/reasoning.
function buildCase(input: CaseInput, id: string, stamp: string): NewCasePayload {
  const prob = clamp(Math.round(input.fraud_prob), 0, 100);
  const exposure = Math.max(0, Math.round(input.exposure) || 0);
  const evidence = input.evidence.filter(Boolean);
  const caseData: Case = {
    id,
    account_id: input.account_id,
    severity: input.severity,
    exposure,
    reason: input.reason || "Imported case — no description provided.",
    evidence: evidence.length ? evidence : ["Imported case — no structured evidence attached yet."],
    evaded_rule: input.evaded_rule || "none specified",
    fraud_prob: prob,
    fraud_ci: [clamp(prob - 8, 0, 100), clamp(prob + 6, 0, 100)],
    recommended_action: input.recommended_action || "Flag for manual review",
    action_reason: input.action_reason || "imported case",
    status: "open",
  };
  const extras = synthesizeExtras({
    account_id: caseData.account_id,
    exposure,
    triggered_rules: input.triggered_rules,
    evaded_rule: caseData.evaded_rule,
    sla_hours: input.sla_hours,
    flowCounterparty: input.counterparty,
    stamp,
  });
  return { caseData, extras };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {hint && <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20";

function AddCaseDialog({
  open,
  onOpenChange,
  onCreate,
  nextId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (p: NewCasePayload) => void;
  nextId: () => string;
}) {
  const blank = {
    account_id: "",
    severity: "HIGH" as Severity,
    exposure: "",
    reason: "",
    recommended_action: "",
    action_reason: "",
    evaded_rule: "",
    fraud_prob: "60",
    evidence: "",
    triggered_rules: "",
    sla_hours: "48",
    counterparty: "",
  };
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof blank, v: string) =>
    setForm((f) => ({ ...f, [k]: v }) as typeof blank);

  const reset = () => setForm(blank);
  const valid = form.account_id.trim() && form.reason.trim() && form.exposure.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const input: CaseInput = {
      account_id: form.account_id.trim(),
      severity: form.severity,
      exposure: Math.max(0, parseInt(form.exposure, 10) || 0),
      reason: form.reason.trim(),
      recommended_action: form.recommended_action.trim() || undefined,
      action_reason: form.action_reason.trim() || "analyst-created case",
      evaded_rule: form.evaded_rule.trim() || undefined,
      fraud_prob: clampInt(form.fraud_prob, 0, 100, 60),
      evidence: form.evidence.split("\n").map((s) => s.trim()).filter(Boolean),
      triggered_rules: form.triggered_rules.split(",").map((s) => s.trim()).filter(Boolean),
      sla_hours: clampInt(form.sla_hours, 1, 999, 48),
      counterparty: form.counterparty.trim() || undefined,
    };
    onCreate(buildCase(input, nextId(), nowStamp()));
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add case to queue</DialogTitle>
          <DialogDescription>
            Enter the case details. The dashboard generates the risk reasoning, rules, and audit
            trail automatically — the new case drops straight into the live queue.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account ID">
              <input
                className={inputCls}
                value={form.account_id}
                onChange={(e) => set("account_id", e.target.value)}
                placeholder="ACC-0000"
                required
              />
            </Field>
            <Field label="Severity">
              <select
                className={inputCls}
                value={form.severity}
                onChange={(e) => set("severity", e.target.value)}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Exposure ($)">
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.exposure}
                onChange={(e) => set("exposure", e.target.value)}
                placeholder="25000"
                required
              />
            </Field>
            <Field label="Risk score" hint="0–100">
              <input
                className={inputCls}
                type="number"
                min={0}
                max={100}
                value={form.fraud_prob}
                onChange={(e) => set("fraud_prob", e.target.value)}
              />
            </Field>
          </div>

          <Field label="Reason" hint="one line — why it's flagged">
            <input
              className={inputCls}
              value={form.reason}
              onChange={(e) => set("reason", e.target.value)}
              placeholder="Mule account receiving layered deposits"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Recommended action">
              <input
                className={inputCls}
                value={form.recommended_action}
                onChange={(e) => set("recommended_action", e.target.value)}
                placeholder="Freeze account"
              />
            </Field>
            <Field label="Action reason">
              <input
                className={inputCls}
                value={form.action_reason}
                onChange={(e) => set("action_reason", e.target.value)}
                placeholder="confirmed mule"
              />
            </Field>
          </div>

          <Field label="Evaded rule" hint="control it slipped past">
            <input
              className={inputCls}
              value={form.evaded_rule}
              onChange={(e) => set("evaded_rule", e.target.value)}
              placeholder="structuring below alert threshold"
            />
          </Field>

          <Field label="Triggered rules" hint="comma-separated">
            <input
              className={inputCls}
              value={form.triggered_rules}
              onChange={(e) => set("triggered_rules", e.target.value)}
              placeholder="VELOCITY-04, MULE-IO-07"
            />
          </Field>

          <Field label="Evidence" hint="one item per line">
            <textarea
              className={`${inputCls} min-h-[72px] resize-y`}
              value={form.evidence}
              onChange={(e) => set("evidence", e.target.value)}
              placeholder={"11 inbound transfers totaling $64,200 within 72h\nAccount opened 19 days ago"}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SLA hours" hint="to deadline">
              <input
                className={inputCls}
                type="number"
                min={1}
                value={form.sla_hours}
                onChange={(e) => set("sla_hours", e.target.value)}
              />
            </Field>
            <Field label="Flow counterparty" hint="optional">
              <input
                className={inputCls}
                value={form.counterparty}
                onChange={(e) => set("counterparty", e.target.value)}
                placeholder="ACC-4471"
              />
            </Field>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to queue
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Sort: OPEN first, then ACCEPTED, then DISMISSED at the bottom; within each
// triage group, worst-first by severity then exposure.
const TRIAGE_RANK: Record<Triage, number> = { OPEN: 0, ACCEPTED: 1, DISMISSED: 2 };
const SEV_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, REVIEW: 2 };

function sortQueue(cases: WorkCase[]): WorkCase[] {
  return [...cases].sort(
    (a, b) =>
      TRIAGE_RANK[a.triage] - TRIAGE_RANK[b.triage] ||
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      b.exposure - a.exposure,
  );
}

// Small pill surfacing backend reachability next to the header actions.
//  null  → still probing ("Checking…")
//  true  → reachable ("Backend online")
//  false → unreachable ("Backend offline")
function BackendStatusPill({ online }: { online: boolean | null }) {
  const checking = online === null;
  const label = checking ? "Checking…" : online ? "Backend online" : "Backend offline";
  const dotColor = checking
    ? "bg-white/50"
    : online
    ? "bg-[color:var(--stamp-green)]"
    : "bg-[color:var(--stamp-red)]";
  return (
    <span
      title={label}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor} ${checking ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function CaseDesk() {
  // Live queue state, seeded from the static dataset.
  const [cases, setCases] = useState<WorkCase[]>(() =>
    sortQueue(CASES.map((c) => ({ ...c, triage: "OPEN" as Triage }))),
  );
  // Per-case dossier extras, seeded from the static map and extended for new cases.
  const [extrasMap, setExtrasMap] = useState<Record<string, CaseExtras>>({ ...CASE_EXTRAS });
  const [addOpen, setAddOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const txnInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(CASES.length);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Load backend findings into the queue (merging with existing cases).
  const loadFromBackend = useCallback(async (findings: import("@/lib/api-client").BackendFinding[]) => {
    if (!findings.length) return 0;
    const newCases: WorkCase[] = findings.map((f) => ({
      ...findingToCase(f),
      triage: "OPEN" as Triage,
      backend_cluster_id: f.cluster_id,
    }));
    const newExtras: Record<string, CaseExtras> = {};
    findings.forEach((f) => { newExtras[f.cluster_id] = findingToExtras(f); });

    setCases((prev) => {
      // Replace any case whose id matches a backend cluster_id; add the rest.
      const existingIds = new Set(findings.map((f) => f.cluster_id));
      const kept = prev.filter((c) => !existingIds.has(c.id));
      return sortQueue([...kept, ...newCases]);
    });
    setExtrasMap((m) => ({ ...m, ...newExtras }));
    if (newCases[0]) setSelectedId(newCases[0].id);
    return findings.length;
  }, []);

  // Probe backend once on mount; if it's online, auto-load the live queue so
  // the backend findings appear without a manual "Run analysis" click. Mock
  // data stays as the fallback when the backend is offline or has no findings.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const online = await healthCheck();
      if (cancelled) return;
      setBackendOnline(online);
      if (!online) return;
      const findings = await getCases();
      if (cancelled || !findings.length) return;
      loadFromBackend(findings);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFromBackend]);

  // Auto-dismiss the import toast.
  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(null), 4500);
    return () => clearTimeout(t);
  }, [importMsg]);

  const sorted = useMemo(() => sortQueue(cases), [cases]);
  const [selectedId, setSelectedId] = useState(sorted[0]?.id);
  const selected = sorted.find((c) => c.id === selectedId) ?? sorted[0];
  const [queueCollapsed, setQueueCollapsed] = useState(false);

  const nextId = () => {
    idCounter.current += 1;
    return `c${idCounter.current}`;
  };

  const handleCreate = ({ caseData, extras }: NewCasePayload) => {
    setExtrasMap((m) => ({ ...m, [caseData.id]: extras }));
    setCases((prev) => sortQueue([...prev, { ...caseData, triage: "OPEN" }]));
    setSelectedId(caseData.id);
  };

  // Accept: confirm finding; case stays in queue, re-sorted as ACCEPTED.
  const handleAccept = (id: string) => {
    const wc = cases.find((c) => c.id === id);
    if (wc) syncDecision(wc, "approve");
    setCases((prev) => sortQueue(prev.map((c) => (c.id === id ? { ...c, triage: "ACCEPTED" } : c))));
  };

  // Dismiss: clear the case and sink it to the bottom of the queue.
  const handleDismiss = (id: string) => {
    const wc = cases.find((c) => c.id === id);
    if (wc) syncDecision(wc, "reject");
    setCases((prev) => sortQueue(prev.map((c) => (c.id === id ? { ...c, triage: "DISMISSED" } : c))));
  };

  // Archive: drop the case entirely; select the next one in the queue.
  const handleArchive = (id: string) => {
    const next = sortQueue(cases.filter((c) => c.id !== id));
    setCases(next);
    if (id === selectedId) setSelectedId(next[0]?.id);
  };

  // ── Backend integration ────────────────────────────────────────────────────

  // "Run analysis" — fetch from backend if online, else prompt to start it.
  const handleRunAnalysis = async () => {
    if (backendOnline === false) {
      setImportMsg("Backend offline — start it with: cd underwire && uvicorn api.app:app --reload");
      return;
    }
    setRunBusy(true);
    setImportMsg("Fetching findings from Underwire backend…");
    try {
      const findings = await getCases();
      if (!findings.length) {
        setImportMsg("Backend has no findings yet — upload a transaction CSV first.");
      } else {
        const n = await loadFromBackend(findings);
        setImportMsg(`Loaded ${n} backend finding${n !== 1 ? "s" : ""} into queue`);
        setBackendOnline(true);
      }
    } finally {
      setRunBusy(false);
    }
  };

  // Upload raw transaction CSV to the backend for full ML analysis.
  const onTxnCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRunBusy(true);
    setImportMsg(`Uploading ${file.name} to Underwire backend…`);
    try {
      const result = await uploadTransactions(file);
      if (!result) {
        setImportMsg("Backend upload failed — is the backend running on port 8000?");
        return;
      }
      const n = await loadFromBackend(result.cases ?? []);
      setImportMsg(
        `Analyzed ${result.n_transactions.toLocaleString()} transactions → ${n} findings (${result.n_escalated} escalated)`,
      );
      setBackendOnline(true);
    } finally {
      setRunBusy(false);
    }
  };

  // Send analyst decision to backend (fire-and-forget; UI already updated).
  const syncDecision = useCallback((workCase: WorkCase, decision: "approve" | "reject") => {
    const cid = workCase.backend_cluster_id ?? workCase.id;
    postDecision(cid, decision);
  }, []);

  // Download SAR from backend; fallback to a local text blob if offline.
  const handleDownloadSar = useCallback(async (workCase: WorkCase) => {
    const cid = workCase.backend_cluster_id ?? workCase.id;
    const blob = await getSarBlob(cid);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SAR_${cid.replace(/[^a-z0-9]/gi, "_")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Fallback: generate a minimal markdown blob locally.
      const text = `# SAR — ${workCase.account_id}\n\n**Score:** ${workCase.fraud_prob}/100\n**Action:** ${workCase.recommended_action}\n\n**Reason:** ${workCase.reason}\n\n**Evidence:**\n${workCase.evidence.map((e) => `- ${e}`).join("\n")}\n`;
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `SAR_${workCase.account_id}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  // Bulk-add parsed CSV rows to the queue in one batch.
  const handleImportCsv = (inputs: CaseInput[]) => {
    if (!inputs.length) return;
    const stamp = nowStamp();
    const payloads = inputs.map((inp) => buildCase(inp, nextId(), stamp));
    setExtrasMap((m) => {
      const next = { ...m };
      for (const p of payloads) next[p.caseData.id] = p.extras;
      return next;
    });
    setCases((prev) =>
      sortQueue([...prev, ...payloads.map((p) => ({ ...p.caseData, triage: "OPEN" as Triage }))]),
    );
    setSelectedId(payloads[0].caseData.id);
  };

  // Read a chosen .csv file, parse it, and import. Runs entirely client-side.
  const onCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const inputs = csvToCaseInputs(String(reader.result ?? ""));
      if (!inputs.length) {
        setImportMsg(`No valid rows found in ${file.name} — need a header row with an account column.`);
        return;
      }
      handleImportCsv(inputs);
      setImportMsg(`Imported ${inputs.length} case${inputs.length > 1 ? "s" : ""} from ${file.name}`);
    };
    reader.onerror = () => setImportMsg(`Could not read ${file.name}.`);
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        actions={
          <>
            <BackendStatusPill online={backendOnline} />
            <button
              onClick={() => csvInputRef.current?.click()}
              title="Upload a CSV of cases. Header row with columns like: account_id, severity, exposure, reason, fraud_prob, evaded_rule, triggered_rules, evidence, recommended_action, sla_hours"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:bg-white/20 hover:-translate-y-px active:translate-y-0"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Upload CSV
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:bg-white/20 hover:-translate-y-px active:translate-y-0"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Add case
            </button>
            <button
              onClick={() => txnInputRef.current?.click()}
              disabled={runBusy}
              title="Upload raw bank transaction CSV to run Underwire ML detection"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:bg-white/20 hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Transactions
            </button>
            <button
              onClick={handleRunAnalysis}
              disabled={runBusy}
              className={`rounded-full px-7 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 hover:shadow-lg hover:-translate-y-px active:translate-y-0 disabled:opacity-60 ${backendOnline === false ? "bg-severity-high hover:bg-severity-high" : "bg-primary hover:bg-primary-hover"}`}
            >
              {runBusy ? "Running…" : backendOnline === false ? "Backend offline" : "Run analysis"}
            </button>
          </>
        }
      />

      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onCsvFile}
        className="hidden"
        aria-hidden
      />
      {/* Hidden file picker for raw bank transaction CSVs → backend analysis */}
      <input
        ref={txnInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onTxnCsvFile}
        className="hidden"
        aria-hidden
      />

      <AddCaseDialog open={addOpen} onOpenChange={setAddOpen} onCreate={handleCreate} nextId={nextId} />

      {importMsg && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-lg"
        >
          <span className="flex items-start gap-2">
            <ThreadGlyph className="mt-0.5 h-4 w-4 shrink-0 text-severity-high" />
            <span>{importMsg}</span>
          </span>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 overflow-hidden px-6 py-5">
        <div
          className={`grid h-full min-h-0 grid-cols-1 gap-5 ${
            queueCollapsed ? "lg:grid-cols-[88px_minmax(0,52fr)_24fr]" : "lg:grid-cols-[24fr_52fr_24fr]"
          }`}
        >
          {queueCollapsed ? (
            <button
              onClick={() => setQueueCollapsed(false)}
              aria-label="Expand case queue"
              className="flex h-full min-h-0 w-full flex-col items-center gap-4 rounded-3xl border border-border bg-surface-raised py-6 text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground"
            >
              <span className="text-base">▸</span>
              <span className="[writing-mode:vertical-rl] text-xs font-semibold uppercase tracking-wider">
                Case Queue
              </span>
              <Mono className="text-xs">{sorted.length}</Mono>
            </button>
          ) : (
            <section className="flex h-full min-h-0 flex-col rounded-3xl border border-border bg-surface-raised p-4 shadow-sm transition-all duration-200">
              <div className="mb-2 shrink-0 px-1">
                <SeverityBreakdownCollapsed />
              </div>

              <div className="mb-2 flex shrink-0 items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Case Queue
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground">worst first</span>
                  <button
                    onClick={() => setQueueCollapsed(true)}
                    aria-label="Collapse case queue"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
                  >
                    ◂
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
                {sorted.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                    <ThreadGlyph className="h-8 w-8 text-muted-foreground/50" />
                    <p>Queue is empty.</p>
                    <button
                      onClick={() => setAddOpen(true)}
                      className="mt-1 rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      + Add a case
                    </button>
                  </div>
                ) : (
                  sorted.map((c) => (
                    <CaseCard
                      key={c.id}
                      c={c}
                      extras={extrasMap[c.id]}
                      active={c.id === selectedId}
                      onClick={() => setSelectedId(c.id)}
                    />
                  ))
                )}
              </div>
            </section>
          )}

          <section className="h-full min-h-0 overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all duration-200">
            {selected ? (
              <CaseDetail
                c={selected}
                extras={extrasMap[selected.id]}
                onAccept={handleAccept}
                onDismiss={handleDismiss}
                onArchive={handleArchive}
                onDownload={() => handleDownloadSar(selected)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <ThreadGlyph className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm">No case selected. Add a case to get started.</p>
                <button
                  onClick={() => setAddOpen(true)}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary-hover"
                >
                  Add case
                </button>
              </div>
            )}
          </section>

          <aside className="flex h-full min-h-0 flex-col overflow-y-auto rounded-3xl border border-border bg-surface-raised p-6 shadow-sm transition-all duration-200">
            <div className="mb-3 shrink-0">
              <FindingsBySourceCard />
            </div>
            <AgentPipeline />
          </aside>




        </div>
      </main>
    </div>
  );
}
