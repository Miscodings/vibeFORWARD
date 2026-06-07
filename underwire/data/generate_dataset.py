"""
Generate the synthetic transactions CSV for Underwire integration tests.
Matches the ground-truth schema exactly so test_ring_recovery.py can verify it.

Ground truth encoded:
  Cell A : AC-0001 → AC-0002
  Cell B : AC-0005 → AC-0006, AC-0005 → AC-0009 → AC-0007
  Cell C : AC-0010 → AC-0011 → AC-0003
  All ring transfers: 02:00–04:00 AM, amounts $450–$850, accounts opened Feb-2026.

  High-ticket : AC-0013…AC-0020  mean ~$600–800 merchant purchases
  Multi-region: AC-0021…AC-0026  active in 3–4 ip_regions
"""
import random
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

RNG = np.random.default_rng(42)
random.seed(42)

REGIONS = ["us-east", "us-west", "eu-west", "ap-south", "us-central"]
MERCHANT_CATS = ["retail", "food", "travel", "utilities", "entertainment", "payroll", "transfer"]
DEVICES = [f"DEV-{i:04d}" for i in range(1, 300)]

START = datetime(2026, 1, 1)
END   = datetime(2026, 3, 31)

def rand_ts(start=START, end=END):
    delta = (end - start).total_seconds()
    return start + timedelta(seconds=int(RNG.uniform(0, delta)))

def ring_ts():
    """Random timestamp 02:00–04:00 AM in Feb-Mar 2026."""
    base = datetime(2026, 2, 1) + timedelta(days=int(RNG.integers(0, 58)))
    hour = int(RNG.integers(2, 4))
    minute = int(RNG.integers(0, 60))
    return base.replace(hour=hour, minute=minute, second=0, microsecond=0)

def feb_open():
    """Account opened in February 2026 burst."""
    return (datetime(2026, 2, 1) + timedelta(days=int(RNG.integers(0, 28)))).date()

def rand_open():
    d = START + timedelta(days=int(RNG.integers(0, 730)))
    return d.date()

rows = []
txn_counter = [1]

def txn(account_id, counterparty_id, amount, ts, merchant_category, device_id, ip_region, account_open_date):
    tid = f"TXN-{txn_counter[0]:06d}"
    txn_counter[0] += 1
    return {
        "txn_id": tid,
        "account_id": account_id,
        "counterparty_id": counterparty_id,
        "amount": round(float(amount), 2),
        "timestamp": ts.strftime("%Y-%m-%d %H:%M:%S"),
        "merchant_category": merchant_category,
        "device_id": device_id,
        "ip_region": ip_region,
        "account_open_date": str(account_open_date),
    }

# ── Ring accounts metadata ─────────────────────────────────────────────────
ring_accounts = {
    "AC-0001": feb_open(), "AC-0002": feb_open(),
    "AC-0003": feb_open(), "AC-0005": feb_open(),
    "AC-0006": feb_open(), "AC-0007": feb_open(),
    "AC-0009": feb_open(), "AC-0010": feb_open(),
    "AC-0011": feb_open(),
}
ring_device  = {ac: random.choice(DEVICES) for ac in ring_accounts}
ring_region  = {ac: "us-east" for ac in ring_accounts}

def ring_txn(src, dst, n=4):
    for _ in range(n):
        amt = round(RNG.uniform(450, 850), 2)
        ts  = ring_ts()
        rows.append(txn(src, dst, amt, ts, "transfer", ring_device[src], ring_region[src], ring_accounts[src]))

# Cell A
ring_txn("AC-0001", "AC-0002", 5)
ring_txn("AC-0002", "AC-0001", 3)   # some return flow

# Cell B
ring_txn("AC-0005", "AC-0006", 5)
ring_txn("AC-0005", "AC-0009", 4)
ring_txn("AC-0009", "AC-0007", 4)
ring_txn("AC-0007", "AC-0005", 2)   # minor return

# Cell C
ring_txn("AC-0010", "AC-0011", 5)
ring_txn("AC-0011", "AC-0003", 5)
ring_txn("AC-0003", "AC-0010", 2)   # minor return

# Add some regular (non-suspicious) merchant txns for ring accounts
for ac, opened in ring_accounts.items():
    for _ in range(int(RNG.integers(3, 8))):
        rows.append(txn(
            ac, f"MR-{RNG.integers(1000, 9999)}",
            round(RNG.uniform(10, 200), 2),
            rand_ts(), random.choice(["retail", "food", "utilities"]),
            ring_device[ac], ring_region[ac], opened
        ))

# ── High-ticket accounts AC-0013…AC-0020 ──────────────────────────────────
high_ticket_accounts = [f"AC-{i:04d}" for i in range(13, 21)]
for ac in high_ticket_accounts:
    opened = rand_open()
    dev    = random.choice(DEVICES)
    reg    = random.choice(REGIONS[:3])
    for _ in range(int(RNG.integers(8, 15))):
        amt = round(RNG.uniform(500, 900), 2)      # mean ~$700 vs population median ~$42
        rows.append(txn(ac, f"MR-{RNG.integers(1000, 9999)}", amt,
                        rand_ts(), random.choice(["retail", "travel", "entertainment"]),
                        dev, reg, opened))

# ── Multi-region accounts AC-0021…AC-0026 ─────────────────────────────────
multi_region_accounts = [f"AC-{i:04d}" for i in range(21, 27)]
for ac in multi_region_accounts:
    opened = rand_open()
    dev    = random.choice(DEVICES)
    assigned_regions = random.sample(REGIONS, k=int(RNG.integers(3, 5)))
    for _ in range(int(RNG.integers(10, 18))):
        rows.append(txn(ac, f"MR-{RNG.integers(1000, 9999)}",
                        round(RNG.uniform(20, 200), 2),
                        rand_ts(), random.choice(MERCHANT_CATS[:5]),
                        random.choice(DEVICES), random.choice(assigned_regions), opened))

# ── Normal population AC-0027…AC-0300 ─────────────────────────────────────
for i in range(27, 301):
    ac     = f"AC-{i:04d}"
    opened = rand_open()
    dev    = random.choice(DEVICES)
    reg    = random.choice(REGIONS[:2])
    n_txns = int(RNG.integers(5, 25))
    for _ in range(n_txns):
        if RNG.random() < 0.05:
            # occasional small inter-account (not a ring)
            dst = f"AC-{RNG.integers(27, 301):04d}"
            amt = round(RNG.uniform(50, 500), 2)
            cat = "transfer"
        else:
            dst = f"MR-{RNG.integers(1000, 9999)}"
            amt = round(RNG.uniform(5, 120), 2)
            cat = random.choice(MERCHANT_CATS[:5])
        rows.append(txn(ac, dst, amt, rand_ts(), cat, dev, reg, opened))

df = pd.DataFrame(rows)
df = df.sample(frac=1, random_state=42).reset_index(drop=True)

out = "/Users/ankitsanjyal/Desktop/projects/vibeFORWARD1/underwire/data/transactions.csv"
df.to_csv(out, index=False)
print(f"Generated {len(df)} transactions → {out}")

# Quick sanity
a2a = df[df["counterparty_id"].str.startswith("AC-")]
print(f"A2A rows: {len(a2a)}")
ring_src = a2a[a2a["account_id"].isin(ring_accounts)]["account_id"].unique()
print(f"Ring source accounts in A2A: {sorted(ring_src)}")
