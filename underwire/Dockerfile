# syntax=docker/dockerfile:1
# ── Backend (FastAPI / uvicorn) ────────────────────────────────────────────────
FROM python:3.13-slim

WORKDIR /app

# System deps occasionally needed by numpy/scikit-learn wheels are already
# bundled in the manylinux wheels; keep the image slim.
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Install Python dependencies first for layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend source (build context is ./underwire — see docker-compose.yml).
COPY . .

# Generate the demo dataset at build time if it is not committed, so the
# container is usable out of the box.
RUN test -f data/transactions.csv || python data/generate_dataset.py

EXPOSE 8000

# cwd = /app (== underwire/); app.py does sys.path.insert so api.app:app resolves.
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000"]
