#!/usr/bin/env bash
#
# dev-all.sh — start the vibeFORWARD backend (FastAPI/uvicorn) and frontend
# (Next.js) together. Bash equivalent of dev-all.ps1 for macOS/Linux/CI/Git-Bash.
#
#   - Detects Node version; warns (without aborting) if < 20.9. Next 16 requires
#     Node >= 20.9, so the frontend fails on Node 18 — but the backend still starts.
#   - Ensures underwire/.env exists (copies from .env.example when available).
#   - Generates underwire/data/transactions.csv if missing.
#   - Runs both processes with `&` and `trap 'kill 0' EXIT` so Ctrl+C stops both.
#
# Usage: ./scripts/dev-all.sh
set -u

# ── Resolve repo root (this script lives in <root>/scripts) ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UNDERWIRE="$REPO_ROOT/underwire"

echo "=== vibeFORWARD dev-all ==="
echo "Repo root: $REPO_ROOT"

# On Windows Git-Bash, Node may live here; add it if present (harmless elsewhere).
if [ -d "/c/Program Files/nodejs" ]; then
  export PATH="/c/Program Files/nodejs:$PATH"
fi

# ── Node version check (warn-only) ────────────────────────────────────────────
FRONTEND_OK=1
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version)"          # e.g. v18.14.0
  CLEAN="${NODE_VER#v}"
  MAJOR="${CLEAN%%.*}"
  REST="${CLEAN#*.}"
  MINOR="${REST%%.*}"
  if [ "$MAJOR" -lt 20 ] || { [ "$MAJOR" -eq 20 ] && [ "$MINOR" -lt 9 ]; }; then
    echo "[warn] Node $NODE_VER detected. Next 16 requires Node >= 20.9."
    echo "[warn] Upgrade Node to >= 20.9 to run the frontend; backend will still start."
    echo "[warn] (Or use Docker: 'docker compose up --build' — containers ship Node 20.)"
    FRONTEND_OK=0
  else
    echo "[ok] Node $NODE_VER"
  fi
else
  echo "[warn] Node not found. Frontend will NOT start; backend will still run."
  FRONTEND_OK=0
fi

# ── Ensure backend .env exists ────────────────────────────────────────────────
if [ ! -f "$UNDERWIRE/.env" ]; then
  if [ -f "$UNDERWIRE/.env.example" ]; then
    cp "$UNDERWIRE/.env.example" "$UNDERWIRE/.env"
    echo "[ok] Created underwire/.env from .env.example"
  else
    echo "[warn] underwire/.env.example not found yet; backend uses defaults (no ANTHROPIC_API_KEY)."
  fi
fi

# ── Resolve Python interpreter for the backend ────────────────────────────────
if [ -x "$UNDERWIRE/.venv/Scripts/python.exe" ]; then
  PY="$UNDERWIRE/.venv/Scripts/python.exe"          # Windows venv layout
  echo "[ok] Using venv interpreter (Scripts)."
elif [ -x "$UNDERWIRE/.venv/bin/python" ]; then
  PY="$UNDERWIRE/.venv/bin/python"                  # POSIX venv layout
  echo "[ok] Using venv interpreter (bin)."
elif command -v py >/dev/null 2>&1; then
  PY="py -3.13"
  echo "[warn] underwire/.venv not found; falling back to 'py -3.13'."
else
  PY="python3"
  echo "[warn] underwire/.venv not found; falling back to 'python3'."
fi

# ── Generate dataset if missing ───────────────────────────────────────────────
if [ ! -f "$UNDERWIRE/data/transactions.csv" ]; then
  echo "[..] Generating dataset (data/transactions.csv)..."
  ( cd "$UNDERWIRE" && $PY data/generate_dataset.py )
  echo "[ok] Dataset step complete."
else
  echo "[ok] Dataset present."
fi

# ── Stop both children on exit / Ctrl+C ───────────────────────────────────────
trap 'echo; echo "[dev-all] Stopping..."; kill 0' EXIT INT TERM

echo ""
echo "Starting backend (uvicorn) on http://localhost:8000 ..."
( cd "$UNDERWIRE" && $PY -m uvicorn api.app:app --reload --port 8000 2>&1 | sed 's/^/[api] /' ) &

if [ "$FRONTEND_OK" -eq 1 ]; then
  echo "Starting frontend (next dev) on http://localhost:3000 ..."
  ( cd "$REPO_ROOT" && npm run dev 2>&1 | sed 's/^/[web] /' ) &
else
  echo "[skip] Frontend not started (Node < 20.9 or missing)."
fi

echo ""
echo "──────────────────────────────────────────────"
echo " Frontend : http://localhost:3000"
echo " API docs : http://localhost:8000/docs"
echo " Press Ctrl+C to stop everything."
echo "──────────────────────────────────────────────"
echo ""

# Wait for all background jobs; trap handles cleanup.
wait
