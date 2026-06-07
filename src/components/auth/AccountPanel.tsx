"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";
import { AnimatedNumber } from "@/components/AnimatedNumber";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StatTile({ label, value, decimals, suffix }: { label: string; value: number; decimals?: number; suffix?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/50 p-3">
      <p className="num text-xl font-bold text-foreground">
        <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />
      </p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { account, signOut, requestPasswordReset } = useAuth();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMessage, setResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!account) return null;
  const isGuest = account.role === "guest";

  function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    const result = requestPasswordReset(account.email);
    setResetMessage({
      ok: result.ok,
      text: result.ok
        ? `Mock reset link sent to ${account.email}. (No email is actually sent — this is a demo flow.)`
        : result.error ?? "Couldn't process that request.",
    });
  }

  function handleSignOut() {
    onClose();
    signOut();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="account-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[color:var(--ink)]/35 backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.aside
            key="account-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            role="dialog"
            aria-label="Account panel"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-border bg-surface p-6 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-white">
                  {initials(account.name)}
                </div>
                <div>
                  <p className="font-display text-base font-semibold leading-tight text-foreground">{account.name}</p>
                  <p className="text-xs text-muted-foreground">{account.title}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close account panel"
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {isGuest && (
              <div className="rounded-2xl border border-border bg-blush/60 p-3 text-xs leading-relaxed text-foreground/80">
                You&rsquo;re browsing as a guest with read-only access to mock data. Sign out and
                sign in with an advisor account to unlock case actions and personal stats.
              </div>
            )}

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-2xl border border-border p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="num mt-0.5 truncate text-foreground/85">{account.email}</dd>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">License ID</dt>
                <dd className="num mt-0.5 text-foreground/85">{account.license_id}</dd>
              </div>
              <div className="col-span-2 rounded-2xl border border-border p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Branch</dt>
                <dd className="mt-0.5 text-foreground/85">{account.branch}</dd>
              </div>
            </dl>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isGuest ? "Sandbox stats" : "Performance stats"}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Cases reviewed" value={account.stats.cases_reviewed} />
                <StatTile label="Accuracy rate" value={account.stats.accuracy_rate} decimals={1} suffix="%" />
                <StatTile label="Avg. response" value={account.stats.avg_response_mins} suffix=" min" />
                <StatTile label="Escalations filed" value={account.stats.escalations_filed} />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Member since <span className="num">{account.stats.member_since}</span>
              </p>
            </div>

            {!isGuest && (
              <div className="rounded-2xl border border-border p-3">
                <button
                  onClick={() => {
                    setResetOpen((v) => !v);
                    setResetMessage(null);
                  }}
                  className="flex w-full items-center justify-between text-sm font-medium text-foreground"
                >
                  Reset password
                  <motion.span animate={{ rotate: resetOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    ⌄
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {resetOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <form onSubmit={handleReset} className="mt-3 flex flex-col gap-2">
                        <p className="text-xs text-muted-foreground">
                          We&rsquo;ll send a mock reset link to <span className="num">{account.email}</span>.
                        </p>
                        {resetMessage && (
                          <p
                            className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                              resetMessage.ok
                                ? "border-success/30 bg-[color:var(--stamp-green-bg)] text-success"
                                : "border-severity-critical/30 bg-severity-critical-bg text-severity-critical"
                            }`}
                          >
                            {resetMessage.text}
                          </p>
                        )}
                        <button
                          type="submit"
                          className="self-start rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-hover"
                        >
                          Send reset link
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <button
              onClick={handleSignOut}
              className="mt-auto rounded-full border border-border bg-surface px-6 py-2.5 text-sm font-semibold text-foreground transition-all duration-200 hover:border-severity-critical/40 hover:bg-severity-critical-bg hover:text-severity-critical"
            >
              Sign out
            </button>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
