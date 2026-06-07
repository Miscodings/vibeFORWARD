"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/use-auth";
import { DEMO_CREDENTIALS } from "@/lib/auth-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

function ComplianceGate() {
  const { acknowledgeGate } = useAuth();
  return (
    <Dialog open>
      <DialogContent
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-lg"
      >
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--color-header-bg)] text-white">
            <ThreadGlyph className="h-5 w-5" />
          </div>
          <DialogTitle>Restricted to licensed financial advisors</DialogTitle>
          <DialogDescription>
            Filum surfaces flagged accounts, exposure estimates, and recommended actions drawn
            from a live fraud-detection pipeline. This workspace is intended for use by licensed
            financial advisors and fraud analysts acting within their institution&rsquo;s
            authority.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 rounded-2xl border border-border bg-secondary/60 p-4 text-xs leading-relaxed text-muted-foreground">
          <li>· All case data shown here is mocked for demonstration purposes — no real customer records are accessed.</li>
          <li>· Actions such as &ldquo;Freeze account&rdquo; or &ldquo;Run analysis&rdquo; are simulated and do not affect any live system.</li>
          <li>· By continuing, you confirm you are an authorized reviewer or are exploring this workbench in a sandbox capacity.</li>
        </ul>
        <DialogFooter>
          <button
            onClick={acknowledgeGate}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-hover"
          >
            I understand — continue
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LoginView = "sign-in" | "forgot-password";

function LoginGate() {
  const { login, continueAsGuest, requestPasswordReset } = useAuth();
  const [view, setView] = useState<LoginView>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = login(email, password);
    if (!result.ok) setError(result.error ?? "Sign-in failed.");
  }

  function handleReset(e: FormEvent) {
    e.preventDefault();
    const result = requestPasswordReset(resetEmail);
    setResetMessage({
      ok: result.ok,
      text: result.ok
        ? `If this were a live system, we'd send a password-reset link to ${resetEmail}. (Mock flow — no email sent.)`
        : result.error ?? "Couldn't process that request.",
    });
  }

  function fillDemo() {
    setEmail(DEMO_CREDENTIALS.email);
    setPassword(DEMO_CREDENTIALS.password);
    setError(null);
  }

  return (
    <Dialog open>
      <DialogContent
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md"
      >
        {view === "sign-in" ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in to Filum</DialogTitle>
              <DialogDescription>
                Mock authentication — no real credentials are transmitted or stored.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Work email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="name@filum.app"
                  className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-normal normal-case text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Password
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-normal normal-case text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </label>

              {error && (
                <p className="rounded-xl border border-severity-critical/30 bg-severity-critical-bg px-3 py-2 text-xs text-severity-critical">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setView("forgot-password");
                    setResetEmail(email);
                    setResetMessage(null);
                  }}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
                <button type="button" onClick={fillDemo} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  Use demo credentials
                </button>
              </div>

              <button
                type="submit"
                className="mt-1 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-hover"
              >
                Sign in
              </button>
            </form>

            <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              onClick={continueAsGuest}
              className="mt-4 w-full rounded-full border border-border bg-surface px-6 py-2.5 text-sm font-semibold text-foreground transition-all duration-200 hover:border-foreground/30 hover:bg-secondary"
            >
              Continue as guest (read-only)
            </button>
            <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
              Demo: <span className="num">{DEMO_CREDENTIALS.email}</span> · <span className="num">{DEMO_CREDENTIALS.password}</span>
            </p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reset your password</DialogTitle>
              <DialogDescription>
                Enter the email on your advisor account. This is a mocked flow — nothing is sent.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleReset} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Work email
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setResetMessage(null);
                  }}
                  placeholder="name@filum.app"
                  className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-normal normal-case text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </label>
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
                className="mt-1 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-primary-hover"
              >
                Send reset link
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("sign-in");
                  setResetMessage(null);
                }}
                className="text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                ← Back to sign in
              </button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AccessGate({ children }: { children: React.ReactNode }) {
  const { stage, ready } = useAuth();

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <ThreadGlyph className="h-8 w-8 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  if (stage === "gate") return <ComplianceGate />;
  if (stage === "signed-out") return <LoginGate />;
  return <>{children}</>;
}
