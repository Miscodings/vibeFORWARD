"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  GUEST_ACCOUNT,
  findMockAccount,
  findMockAccountByEmail,
  type MockAccount,
} from "@/lib/auth-data";

export type AuthStage = "gate" | "signed-out" | "authenticated";

interface AuthState {
  stage: AuthStage;
  account: MockAccount | null;
}

interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthContextValue extends AuthState {
  ready: boolean;
  acknowledgeGate: () => void;
  login: (email: string, password: string) => LoginResult;
  continueAsGuest: () => void;
  signOut: () => void;
  requestPasswordReset: (email: string) => LoginResult;
}

const STORAGE_KEY = "filum.auth.v1";

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredState(): AuthState {
  if (typeof window === "undefined") return { stage: "gate", account: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { stage: "gate", account: null };
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (parsed.stage === "authenticated" && parsed.account) {
      return { stage: "authenticated", account: parsed.account as MockAccount };
    }
    if (parsed.stage === "signed-out") {
      return { stage: "signed-out", account: null };
    }
    return { stage: "gate", account: null };
  } catch {
    return { stage: "gate", account: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ stage: "gate", account: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Reads localStorage (unavailable during SSR) to hydrate client-only auth state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readStoredState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const acknowledgeGate = useCallback(() => {
    setState((prev) => (prev.stage === "gate" ? { stage: "signed-out", account: null } : prev));
  }, []);

  const login = useCallback((email: string, password: string): LoginResult => {
    const account = findMockAccount(email, password);
    if (!account) {
      return { ok: false, error: "We couldn't match that email and password. Try the demo credentials below." };
    }
    setState({ stage: "authenticated", account });
    return { ok: true };
  }, []);

  const continueAsGuest = useCallback(() => {
    setState({ stage: "authenticated", account: GUEST_ACCOUNT });
  }, []);

  const signOut = useCallback(() => {
    setState({ stage: "signed-out", account: null });
  }, []);

  const requestPasswordReset = useCallback((email: string): LoginResult => {
    const account = findMockAccountByEmail(email);
    if (!account) {
      return { ok: false, error: "No advisor account is registered with that email." };
    }
    return { ok: true };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      ready: hydrated,
      acknowledgeGate,
      login,
      continueAsGuest,
      signOut,
      requestPasswordReset,
    }),
    [state, hydrated, acknowledgeGate, login, continueAsGuest, signOut, requestPasswordReset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
