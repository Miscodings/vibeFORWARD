"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CASES, type Severity } from "@/lib/cases-data";
import { CASE_PATTERNS, type CasePattern } from "@/lib/pattern-data";
import { AppHeader } from "@/components/AppHeader";
import { PatternChart } from "@/components/visualize/PatternChart";

const severityStyles: Record<Severity, string> = {
  CRITICAL: "bg-severity-critical-bg text-severity-critical",
  HIGH: "bg-severity-high-bg text-severity-high",
  REVIEW: "bg-severity-review-bg text-severity-review",
};

const riskColor = (n: number) =>
  n >= 80 ? "text-severity-critical" : n >= 50 ? "text-severity-high" : "text-severity-review";

const formatExposure = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`);

const KIND_LABEL: Record<CasePattern["kind"], string> = {
  network: "Network diagram",
  bars: "Amount comparison",
  timeline: "Activity timeline",
  cadence: "Cadence grid",
};

function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`num ${className}`}>{children}</span>;
}

function VisualizeFallback() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 items-center justify-center px-6 py-5">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Loading pattern library…
        </div>
      </main>
    </div>
  );
}

function VisualizeContent() {
  const sorted = useMemo(
    () =>
      [...CASES]
        .filter((c) => CASE_PATTERNS[c.id])
        .sort((a, b) => {
          const rank = { CRITICAL: 0, HIGH: 1, REVIEW: 2 } as const;
          return rank[a.severity] - rank[b.severity] || b.exposure - a.exposure;
        }),
    [],
  );

  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("case");

  const [selectedId, setSelectedId] = useState(
    () => (requested && CASE_PATTERNS[requested] ? requested : sorted[0]?.id) ?? sorted[0]?.id,
  );

  const selected = sorted.find((c) => c.id === selectedId) ?? sorted[0];
  const pattern = selected ? CASE_PATTERNS[selected.id] : undefined;

  const selectCase = (id: string) => {
    setSelectedId(id);
    router.replace(`/visualize?case=${id}`, { scroll: false });
  };

  if (!selected || !pattern) {
    return <VisualizeFallback />;
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader />

      <main className="mx-auto w-full max-w-[1600px] flex-1 min-h-0 overflow-hidden px-6 py-5">
        <div className="grid h-full min-h-0 grid-cols-1 gap-5 lg:grid-cols-[30fr_70fr]">
          <section className="flex h-full min-h-0 flex-col rounded-3xl border border-border bg-surface-raised p-4 shadow-sm transition-all duration-200">
            <div className="mb-1 flex shrink-0 items-baseline justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pattern Library
              </h2>
              <span className="text-[11px] text-muted-foreground">
                <Mono>{sorted.length}</Mono> archetypes
              </span>
            </div>
            <p className="mb-3 px-1 text-[11px] leading-snug text-muted-foreground">
              Pick a flagged case to see the fraud pattern it matches, rendered as the chart that fits its shape.
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {sorted.map((c) => {
                const p = CASE_PATTERNS[c.id];
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    onClick={() => selectCase(c.id)}
                    className={`relative flex flex-col gap-1 rounded-2xl border px-3.5 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md ${
                      active
                        ? "border-primary/40 bg-primary/[0.06] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-2xl before:bg-primary before:content-['']"
                        : "border-border bg-surface hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Mono className="text-[11px] text-muted-foreground">{c.account_id}</Mono>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${severityStyles[c.severity]}`}
                      >
                        {c.severity}
                      </span>
                    </div>
                    <span className="text-sm font-semibold leading-snug text-foreground">{p.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {KIND_LABEL[p.kind]} · <Mono>{formatExposure(c.exposure)}</Mono> exposure
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="h-full min-h-0 overflow-y-auto rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all duration-200">
            <AnimatePresence mode="wait">
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Mono className="text-base font-bold text-foreground">{selected.account_id}</Mono>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${severityStyles[selected.severity]}`}
                      >
                        {selected.severity}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">
                        {KIND_LABEL[pattern.kind]}
                      </span>
                    </div>
                    <h2 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-foreground">
                      {pattern.label}
                    </h2>
                  </div>

                  <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface-raised px-4 py-2.5 shadow-sm">
                    <div className="flex flex-col leading-none">
                      <Mono className={`text-xl font-bold ${riskColor(selected.fraud_prob)}`}>{selected.fraud_prob}</Mono>
                      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">risk score</span>
                    </div>
                    <div className="h-8 w-px bg-border" aria-hidden />
                    <div className="flex flex-col leading-none">
                      <Mono className="text-xl font-bold text-foreground">{formatExposure(selected.exposure)}</Mono>
                      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">exposure</span>
                    </div>
                  </div>
                </div>

                <p className="max-w-[70ch] text-sm leading-relaxed text-foreground/85">{pattern.summary}</p>

                <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised p-4 shadow-sm transition-all duration-200">
                  <PatternChart pattern={pattern} />
                </div>

                <div className="rounded-2xl border-l-4 border-rule-border bg-rule-bg px-4 py-3.5">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Why this matters
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/85">{pattern.insight}</p>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>
        </div>
      </main>
    </div>
  );
}

export function Visualize() {
  return (
    <Suspense fallback={<VisualizeFallback />}>
      <VisualizeContent />
    </Suspense>
  );
}
