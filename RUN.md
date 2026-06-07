# Running vibeFORWARD

Two processes make up the app:

| Service  | Stack            | Command                                   | URL                           |
| -------- | ---------------- | ----------------------------------------- | ----------------------------- |
| Frontend | Next.js 16       | `npm run dev` (root)                       | http://localhost:3000         |
| Backend  | FastAPI / uvicorn| `uvicorn api.app:app` (in `underwire/`)   | http://localhost:8000 (`/docs`) |

The frontend calls the backend at `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).
The backend allows CORS from `http://localhost:3000`.

---

## TL;DR — pick ONE

```bash
# 1. Docker — most robust (containers ship Node 20; no host setup needed)
docker compose up --build

# 2. Windows local (PowerShell) — starts backend + frontend together
./scripts/dev-all.ps1

# 3. bash local (macOS / Linux / Git-Bash / CI)
./scripts/dev-all.sh

# 4. npm (after the dev:all script is added to package.json — see below)
npm run dev:all
```

All four start BOTH services. The Docker path is recommended on this machine
because the host Node is too old for the local frontend (see caveat below).

---

## Node 18 caveat (IMPORTANT)

This machine has **Node v18.14.0**, but **Next 16 requires Node >= 20.9**.
That means `npm run dev` / `next dev` will **fail** locally until Node is upgraded.

The `dev-all` scripts handle this gracefully:

- They detect the Node version and print a clear warning if it is `< 20.9`.
- They **still start the backend** so the API is usable.
- They tell you to either upgrade Node or use Docker.

**Workarounds (choose one):**

1. **Use Docker** — `docker compose up --build`. The `web` container uses
   `node:20-alpine`, so the frontend builds and runs regardless of the host Node.
2. **Upgrade Node** to >= 20.9 (e.g. via the Node.js installer or `nvm`/`fnm`),
   then `npm run dev` / `dev-all` / `npm run dev:all` will run the frontend locally.

Node is **not on PATH** on this machine; it lives at `C:\Program Files\nodejs`.
The `dev-all.ps1` script prepends this to PATH automatically.

---

## Prerequisites (local, non-Docker)

- **Node >= 20.9** for the frontend (see caveat above). Currently at
  `C:\Program Files\nodejs` (v18.14.0).
- **Python 3.13** for the backend (available via `py -3.13`).
- A backend virtualenv at **`underwire/.venv`** (created by the backend setup).
  If it is missing, the scripts fall back to `py -3.13`.

What the `dev-all` scripts do on startup:

1. Put Node on PATH (PowerShell script).
2. Detect Node version; warn if `< 20.9` (but continue).
3. Copy `underwire/.env.example` → `underwire/.env` if `.env` is missing.
4. Generate `underwire/data/transactions.csv` if it is missing
   (`python data/generate_dataset.py`).
5. Start the backend (uvicorn via the venv, else `py -3.13`) and the frontend
   (`npm run dev`) concurrently, with `[api]` / `[web]` prefixed output.
   `Ctrl+C` stops both.

### Manual backend-only (if you want it on its own)

```powershell
cd underwire
.venv\Scripts\python -m uvicorn api.app:app --reload --port 8000
# or, without a venv:
py -3.13 -m uvicorn api.app:app --reload --port 8000
```

---

## Recommended `dev:all` npm script

The `package.json` owner should add this script (it uses
[`concurrently`](https://www.npmjs.com/package/concurrently); add it as a devDependency):

```json
"scripts": {
  "dev:all": "concurrently -n web,api -c blue,green \"npm run dev\" \"cd underwire && .venv/Scripts/python -m uvicorn api.app:app --reload --port 8000\""
}
```

Then: `npm run dev:all`.

Note: this exact form assumes the Windows venv layout (`.venv/Scripts/python`)
and that Node is on PATH. On POSIX, swap to `.venv/bin/python`. The
`dev-all.ps1` / `dev-all.sh` scripts are more portable and also do the
env/dataset bootstrap, so prefer them if you are not on a ready Node-20 setup.

---

## Setting `ANTHROPIC_API_KEY` (optional)

The backend runs in math-only mode without a key (LLM features degrade
gracefully). To enable LLM explanations:

- **Local:** add `ANTHROPIC_API_KEY=sk-ant-...` to `underwire/.env`
  (created from `underwire/.env.example`).
- **Docker:** export it in your shell before `docker compose up`; it is passed
  through to the `api` service:

  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
  docker compose up --build
  ```

---

## End-to-end smoke test

Verifies the frontend<->backend contract for real. **Start the backend first**
(any method above), then:

```bash
node scripts/e2e-smoke.mjs
# or point at a different host:
API_URL=http://localhost:8000 node scripts/e2e-smoke.mjs
```

It runs on Node 18 (uses built-in `fetch`/`FormData`/`Blob`) and checks:

1. `GET /health` → `status: ok`
2. `POST /upload` of `underwire/data/transactions.csv` → `cases[]` each with the
   full Finding contract (`cluster_id, detector, members, score, features,
   score_breakdown, reason, rules_fired, action, evidence_txn_ids`)
3. `GET /cases` → findings persisted
4. `POST /case/{firstId}/decision` with `approve` → recorded

Prints `PASS`/`FAIL` per step and exits nonzero on any failure.

---

## Ports & URLs

| What             | URL                            |
| ---------------- | ------------------------------ |
| Frontend         | http://localhost:3000          |
| Backend API      | http://localhost:8000          |
| API docs (Swagger)| http://localhost:8000/docs    |
| Health check     | http://localhost:8000/health   |
