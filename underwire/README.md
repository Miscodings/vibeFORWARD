# Underwire — Self-Tuning Unsupervised Fraud Detection

Hackathon Track 02 · "Fraud Watch"

Accept a CSV of unlabeled bank transactions. Get a ranked case queue, transparent reasons, downloadable SAR narratives, and a system that retrains itself from analyst clicks.

**Core philosophy: Math detects and scores. LLM only explains.**

---

## Quick Start

```bash
# 1. Install
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY (optional; system degrades gracefully without it)

# 3. Generate synthetic dataset (4 212 transactions with embedded ground truth)
python data/generate_dataset.py

# 4. One-command pipeline (prints ranked queue to stdout)
python run.py

# 5. REST API
uvicorn api.app:app --reload
```

The API is at `http://localhost:8000`. Interactive docs: `http://localhost:8000/docs`.

---

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload CSV → run all detectors → return ranked queue |
| `GET`  | `/cases` | Full case queue, sortable by `?action=escalate\|watch\|clear` |
| `GET`  | `/case/{id}` | Single finding with analyst labels |
| `POST` | `/case/{id}/decision` | Analyst approve/reject — triggers Updater after 20 labels |
| `GET`  | `/case/{id}/sar` | Download SAR Markdown (generated on demand) |
| `POST` | `/discover` | Run Agent 0 residual pattern discovery |
| `GET`  | `/health` | Liveness + state check |

---

## Architecture

```
CSV
 │
 ▼
AnomalyAgent ──► [A2ATransferDetector]   graph rings via networkx
                 [StructuringDetector]   rolling 7-day IsolationForest
                 [MuleFanInDetector]     LocalOutlierFactor on in-degree
 │
 ▼
MemoryStore (SQLite / Cognee)
 │
 ├──► Agent0Discovery   z-score on residual accounts → new ThresholdDetectors
 │
 ├──► Explainer         SAR narrative (LLM=Sonnet) + hallucination guard
 │
 └──► UpdaterAgent      Analyst label feedback → config patch (LLM=Haiku)
```

### Scoring (0 – 100)

| Component | Weight | Signal |
|-----------|--------|--------|
| value_norm | 30 | total value / population median |
| night_frac | 25 | fraction of 02:00–04:00 AM transfers |
| amount_lift | 20 | cell mean / population median |
| counterparty_conc | 15 | concentration of counterparties |
| burst_opening | 10 | account age (days) since opening |

Actions: **escalate** ≥ 70 · **watch** 45–70 · **clear** < 45

---

## Multi-Agent Design

### AnomalyAgent
Runs all registered detectors, writes `Finding` objects to memory, returns ranked list.

### Agent0Discovery (Meta-Agent)
Examines accounts **not** already in escalate/watch findings. Engineers 6 features
(`mean_amt`, `night_frac`, `n_regions`, `n_devices`, `n_merch`, `frac_highval`), runs
z-score with threshold 2.5, groups by driving feature, deduplicates overlapping groups,
names each pattern via LLM (Haiku), and appends a `_ThresholdDetector` to the registry.

### Explainer
Builds a compact JSON payload (no raw transactions) and calls Sonnet to write a 5-sentence
SAR narrative. A regex-based **hallucination guard** rejects any response whose numeric
tokens are not a subset of the input JSON — regenerates up to 2 times, then falls back to a
templated Markdown report.

### UpdaterAgent
Gates before tuning: ≥ 20 analyst labels AND alert volume ≤ 200. Identifies the detector
responsible for the most net-rejected clusters. Asks Haiku to propose ONE param change.
Validates contamination delta ≤ 0.004. Writes `{old, new, why, ts}` to `config_versions`
in memory.

---

## LLM Usage — Exactly 3 Places

1. **Updater** (Haiku) — diagnose rejects, propose config patch
2. **Agent0** (Haiku) — name discovered patterns
3. **Explainer** (Sonnet) — write SAR prose

All other logic (scoring, ranking, decision thresholds) is deterministic Python.

---

## Ground Truth (embedded in synthetic dataset)

| Group | Accounts | Signal |
|-------|----------|--------|
| Ring Cell A | AC-0001 ↔ AC-0002 | 02–04 AM, $450–$850, new Feb-2026 |
| Ring Cell B | AC-0005 → AC-0006, AC-0005 → AC-0009 → AC-0007 | same |
| Ring Cell C | AC-0010 → AC-0011 → AC-0003 | same |
| High-ticket | AC-0013 … AC-0020 | mean txn $600–$800 |
| Multi-region | AC-0021 … AC-0026 | 3–4 ip_regions |

Expected: all 3 ring cells escalated (score > 70); high-ticket and multi-region surfaced
by Agent 0 as secondary patterns.

---

## Running Tests

```bash
cd underwire
python3 -m pytest tests/ -v
```

Five integration tests verify ring cell escalation, score breakdown validity, and action
threshold correctness.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for LLM features (optional — degrades gracefully) |
| `USE_LOCAL_MEMORY` | `1` | `1` = SQLite, `0` = Cognee |
| `MEMORY_DB_PATH` | `memory/underwire.db` | SQLite database path |
