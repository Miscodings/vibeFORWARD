"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AGENT_PIPELINE, HEADER_STATS } from "@/lib/cases-data";
import { AnimatedNumber } from "@/components/AnimatedNumber";

function ThreadGlyph({ className = "h-6 w-6" }: { className?: string }) {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return {
      x: (12 + 8 * Math.cos(angle)).toFixed(2),
      y: (12 + 8 * Math.sin(angle)).toFixed(2),
    };
  });
  const path = `M ${dots.map((d) => `${d.x} ${d.y}`).join(" L ")} Z`;
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d={path} stroke="currentColor" strokeWidth="0.75" strokeOpacity="0.45" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.4" fill="currentColor" />
      ))}
    </svg>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay, ease: "easeOut" as const },
  }),
};

const STAT_CARDS = [
  { label: "Transactions analyzed", value: 5000, suffix: "" },
  { label: "Cases flagged", value: HEADER_STATS.flagged, suffix: "" },
  { label: "Exposure identified", value: 412, prefix: "$", suffix: "K" },
  { label: "Ring accounts mapped", value: HEADER_STATS.ring_accounts, suffix: "" },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[color:var(--color-header-bg)] text-white">
              <ThreadGlyph className="h-4.5 w-4.5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground underline decoration-2 decoration-[#C8503C] underline-offset-4">
              Filum
            </span>
          </div>
          <Link
            href="/workbench"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-hover hover:-translate-y-px"
          >
            Enter workbench
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1200px] px-6 pb-20 pt-20 sm:pt-28">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            className="mx-auto max-w-2xl text-center"
          >
            <motion.span
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              <ThreadGlyph className="h-3.5 w-3.5 text-severity-critical" />
              Fraud triage workbench
            </motion.span>
            <motion.h1
              variants={fadeUp}
              className="mt-5 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl"
            >
              Pull the thread on{" "}
              <span className="underline decoration-[3px] decoration-[#C8503C] underline-offset-[6px]">bank fraud</span>.
            </motion.h1>
            <motion.p variants={fadeUp} className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              Filum ranks flagged accounts by exposure and confidence, lays out the evidence trail
              behind each finding, and recommends the next action — so advisors spend their time
              deciding, not digging.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/workbench"
                className="rounded-full bg-primary px-7 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 hover:bg-primary-hover hover:shadow-lg hover:-translate-y-px"
              >
                Enter the workbench
              </Link>
              <Link
                href="/workbench"
                className="rounded-full border border-border bg-surface px-7 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:border-foreground/30 hover:bg-secondary"
              >
                Continue as guest
              </Link>
            </motion.div>
            <motion.p variants={fadeUp} className="mt-3 text-xs text-muted-foreground">
              All data shown is mocked for demonstration — no real customer records are accessed.
            </motion.p>
          </motion.div>
        </section>

        <section className="border-y border-border bg-surface-raised/60">
          <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-4 px-6 py-10 sm:grid-cols-4">
            {STAT_CARDS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-3xl border border-border bg-surface p-5 text-center shadow-sm"
              >
                <p className="num text-3xl font-bold tracking-tight text-foreground">
                  <AnimatedNumber value={s.value} prefix={s.prefix} suffix={s.suffix} />
                </p>
                <p className="mt-1.5 text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-xl text-center"
          >
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              One pipeline, four agents, zero guesswork
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Every case that reaches an advisor has already passed through Filum&rsquo;s
              detection pipeline — fully traceable, end to end.
            </p>
          </motion.div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AGENT_PIPELINE.map((agent, i) => (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -3 }}
                className="flex flex-col gap-2.5 rounded-3xl border border-border bg-surface p-5 shadow-sm transition-shadow duration-200 hover:shadow-md"
              >
                <span className="num inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="font-display text-base font-semibold text-foreground">{agent.name}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{agent.summary}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-[color:var(--color-header-bg)]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-6 py-16 text-center"
          >
            <ThreadGlyph className="h-7 w-7 text-white/70" />
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-white sm:text-3xl">
              Ready to start triaging?
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-white/60">
              Sign in with an advisor account, or jump in as a guest to explore the queue with
              read-only mock data.
            </p>
            <Link
              href="/workbench"
              className="mt-1 rounded-full bg-primary px-7 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 hover:bg-primary-hover hover:shadow-lg hover:-translate-y-px"
            >
              Enter the workbench
            </Link>
          </motion.div>
        </section>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        Filum — Case File · a fraud-triage workbench concept · all data is mocked
      </footer>
    </div>
  );
}
