import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCases,
  uploadTransactions,
  postDecision,
  healthCheck,
  type BackendFinding,
} from "@/lib/api-client";

// BASE is resolved at module load. NEXT_PUBLIC_API_URL is unset in the test
// env, so the client falls back to this default.
const BASE = "http://localhost:8000";

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function notOk(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

const sampleFinding: BackendFinding = {
  cluster_id: "CL-1",
  detector: "a2a_transfer",
  members: ["A", "B"],
  score: 80,
  features: {},
  score_breakdown: {},
  reason: "r",
  rules_fired: 1,
  action: "escalate",
  evidence_txn_ids: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCases", () => {
  it("returns data.cases on ok and hits the right URL", async () => {
    fetchMock.mockResolvedValue(okJson({ cases: [sampleFinding] }));
    const res = await getCases();
    expect(res).toEqual([sampleFinding]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/cases?limit=200`);
  });

  it("appends the action query param when provided", async () => {
    fetchMock.mockResolvedValue(okJson({ cases: [] }));
    await getCases("watch");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/cases?action=watch&limit=200`);
  });

  it("returns [] when cases is missing", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    expect(await getCases()).toEqual([]);
  });

  it("returns [] on a non-ok response", async () => {
    fetchMock.mockResolvedValue(notOk());
    expect(await getCases()).toEqual([]);
  });

  it("returns [] when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await getCases()).toEqual([]);
  });

  it("returns [] on a timeout/abort", async () => {
    fetchMock.mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    expect(await getCases()).toEqual([]);
  });
});

describe("uploadTransactions", () => {
  function fakeFile(): File {
    return { name: "txns.csv" } as unknown as File;
  }

  it("returns json on ok and POSTs to /upload with a body", async () => {
    const payload = {
      status: "ok",
      n_transactions: 100,
      n_findings: 3,
      n_escalated: 1,
      n_watch: 1,
      cases: [sampleFinding],
    };
    fetchMock.mockResolvedValue(okJson(payload));
    const res = await uploadTransactions(fakeFile());
    expect(res).toEqual(payload);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/upload`);
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeDefined();
  });

  it("returns null on a non-ok response", async () => {
    fetchMock.mockResolvedValue(notOk(413));
    expect(await uploadTransactions(fakeFile())).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await uploadTransactions(fakeFile())).toBeNull();
  });
});

describe("healthCheck", () => {
  it("returns true when the response is ok and hits /health", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    expect(await healthCheck()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/health`);
  });

  it("returns false on a non-ok response", async () => {
    fetchMock.mockResolvedValue(notOk());
    expect(await healthCheck()).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("no connection"));
    expect(await healthCheck()).toBe(false);
  });
});

describe("postDecision", () => {
  it("POSTs the decision as JSON to the cluster endpoint", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    await postDecision("CL-1", "approve");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/case/CL-1/decision`);
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ decision: "approve" });
  });

  it("url-encodes the cluster id", async () => {
    fetchMock.mockResolvedValue(okJson({}));
    await postDecision("CL 1/2", "reject");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/case/CL%201%2F2/decision`);
  });

  it("swallows errors (resolves without throwing)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(postDecision("CL-1", "reject")).resolves.toBeUndefined();
  });
});
