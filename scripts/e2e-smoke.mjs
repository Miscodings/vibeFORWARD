#!/usr/bin/env node
/**
 * e2e-smoke.mjs — cross-process API smoke test for vibeFORWARD.
 *
 * Assumes the backend is ALREADY running on http://localhost:8000.
 * (Start it with ./scripts/dev-all.ps1, dev-all.sh, or `docker compose up`.)
 *
 * Verifies the real frontend<->backend contract end to end:
 *   1. GET  /health                  -> { status: "ok" }
 *   2. POST /upload (transactions.csv) -> cases[] with full Finding contract
 *   3. GET  /cases                   -> findings persisted in memory
 *   4. POST /case/{firstId}/decision -> approve recorded
 *
 * Runs on Node 18.14 (global fetch + FormData + Blob are built in).
 * Prints PASS/FAIL per step; exits nonzero on any failure.
 *
 * Usage:
 *   node scripts/e2e-smoke.mjs
 *   API_URL=http://localhost:8000 node scripts/e2e-smoke.mjs
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CSV_PATH = join(REPO_ROOT, "underwire", "data", "transactions.csv");

const BASE = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");

const REQUIRED_CASE_FIELDS = [
  "cluster_id",
  "detector",
  "members",
  "score",
  "features",
  "score_breakdown",
  "reason",
  "rules_fired",
  "action",
  "evidence_txn_ids",
];

let failures = 0;

function pass(step, detail = "") {
  console.log(`PASS  ${step}${detail ? "  — " + detail : ""}`);
}
function fail(step, detail = "") {
  failures++;
  console.error(`FAIL  ${step}${detail ? "  — " + detail : ""}`);
}

function assert(cond, step, detail) {
  if (cond) pass(step, detail);
  else fail(step, detail);
  return cond;
}

async function main() {
  console.log(`vibeFORWARD e2e smoke test → ${BASE}`);
  console.log("──────────────────────────────────────────────");

  // ── Step 1: GET /health ──────────────────────────────────────────────────
  let health;
  try {
    const res = await fetch(`${BASE}/health`);
    health = await res.json();
    if (!assert(res.ok && health.status === "ok", "GET /health", `status=${health?.status}`)) {
      throw new Error("health not ok");
    }
  } catch (e) {
    fail("GET /health", `cannot reach backend: ${e.message}`);
    console.error(`\nIs the backend running on ${BASE}? Start it first.`);
    process.exit(1);
  }

  // ── Step 2: POST /upload ─────────────────────────────────────────────────
  let firstId = null;
  try {
    const bytes = await readFile(CSV_PATH);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "text/csv" }), "transactions.csv");

    const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
    const body = await res.json();

    if (!assert(res.ok, "POST /upload", `HTTP ${res.status}`)) {
      console.error("  response:", JSON.stringify(body).slice(0, 300));
    } else {
      assert(Array.isArray(body.cases), "POST /upload returns cases[]",
        `n_findings=${body.n_findings}, n_transactions=${body.n_transactions}`);

      if (Array.isArray(body.cases) && body.cases.length > 0) {
        const c = body.cases[0];
        const missing = REQUIRED_CASE_FIELDS.filter((k) => !(k in c));
        assert(missing.length === 0, "Case has full contract fields",
          missing.length ? `missing: ${missing.join(", ")}` : REQUIRED_CASE_FIELDS.join(", "));

        // Sanity on a couple of typed fields.
        assert(Array.isArray(c.members), "case.members is array");
        assert(typeof c.score === "number", "case.score is number", `score=${c.score}`);
        assert(["escalate", "watch", "clear"].includes(c.action),
          "case.action is valid", `action=${c.action}`);

        firstId = c.cluster_id;
      } else {
        fail("Case has full contract fields", "cases[] empty — no findings to validate");
      }
    }
  } catch (e) {
    fail("POST /upload", e.message);
  }

  // ── Step 3: GET /cases (persisted) ───────────────────────────────────────
  try {
    const res = await fetch(`${BASE}/cases`);
    const body = await res.json();
    assert(res.ok && Array.isArray(body.cases) && body.cases.length > 0,
      "GET /cases persisted", `total=${body.total}`);
    // Prefer the first persisted (highest-scored) case for the decision step.
    if (Array.isArray(body.cases) && body.cases.length > 0 && body.cases[0].cluster_id) {
      firstId = body.cases[0].cluster_id;
    }
  } catch (e) {
    fail("GET /cases persisted", e.message);
  }

  // ── Step 4: POST /case/{firstId}/decision approve ────────────────────────
  if (firstId) {
    try {
      const res = await fetch(`${BASE}/case/${encodeURIComponent(firstId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve", note: "e2e-smoke" }),
      });
      const body = await res.json();
      assert(
        res.ok && body.status === "recorded" && body.decision === "approve",
        "POST /case/{id}/decision approve",
        `case_id=${body.case_id}, total_labels=${body.total_labels}`
      );
      // Header sanity: JSON content type round-trips.
      const ct = res.headers.get("content-type") || "";
      assert(ct.includes("application/json"), "decision response is JSON", `content-type=${ct}`);
    } catch (e) {
      fail("POST /case/{id}/decision approve", e.message);
    }
  } else {
    fail("POST /case/{id}/decision approve", "no cluster_id available from prior steps");
  }

  console.log("──────────────────────────────────────────────");
  if (failures === 0) {
    console.log("ALL CHECKS PASSED — frontend and backend can talk.");
    process.exit(0);
  } else {
    console.error(`${failures} CHECK(S) FAILED.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
