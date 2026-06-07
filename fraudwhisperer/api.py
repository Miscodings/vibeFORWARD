"""
FraudWhisperer - API
Exposes the 5-agent fraud investigation pipeline over HTTP.

Run with: uvicorn fraudwhisperer.api:app --reload
"""

from fastapi import FastAPI, HTTPException

from fraudwhisperer.pipeline import load_transactions, run_pipeline

app = FastAPI(title="FraudWhisperer", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/investigate")
def investigate():
    try:
        transactions = load_transactions()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="transactions.csv not found")

    if not transactions:
        raise HTTPException(status_code=400, detail="transactions.csv is empty")

    return run_pipeline(transactions)
