/**
 * Typed client for the Underwire FastAPI backend (http://localhost:8000).
 * All functions degrade gracefully — callers receive null / [] on failure
 * so the UI stays functional when the backend isn't running.
 */

const BASE = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL)
  ? process.env.NEXT_PUBLIC_API_URL
  : "http://localhost:8000";

export interface BackendFinding {
  cluster_id: string;
  detector: string;
  members: string[];
  score: number;
  features: Record<string, number>;
  score_breakdown: Record<string, number>;
  reason: string;
  rules_fired: number;
  action: "escalate" | "watch" | "clear";
  evidence_txn_ids: string[];
}

export interface BackendUploadResponse {
  status: string;
  n_transactions: number;
  n_findings: number;
  n_escalated: number;
  n_watch: number;
  cases: BackendFinding[];
}

/** Returns all findings stored in the backend, sorted score-desc. */
export async function getCases(
  action?: "escalate" | "watch" | "clear",
): Promise<BackendFinding[]> {
  try {
    const url = action ? `${BASE}/cases?action=${action}&limit=200` : `${BASE}/cases?limit=200`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.cases ?? []) as BackendFinding[];
  } catch {
    return [];
  }
}

/** Upload a raw transaction CSV; returns detected findings. */
export async function uploadTransactions(
  file: File,
): Promise<BackendUploadResponse | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Record an analyst decision for a backend cluster. */
export async function postDecision(
  cluster_id: string,
  decision: "approve" | "reject",
): Promise<void> {
  try {
    await fetch(`${BASE}/case/${encodeURIComponent(cluster_id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // fire-and-forget; UI already updated optimistically
  }
}

/** Fetch the SAR markdown for a backend cluster; returns null on failure. */
export async function getSarBlob(cluster_id: string): Promise<Blob | null> {
  try {
    const res = await fetch(
      `${BASE}/case/${encodeURIComponent(cluster_id)}/sar`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Check if backend is reachable. */
export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
