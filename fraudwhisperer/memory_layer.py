"""
FraudWhisperer - MongoDB Memory Layer
The shared memory bus between all 5 agents. Each agent reads what the
previous agent wrote and writes its own typed entities - mirroring the
Cognee namespace handoff pattern, backed by MongoDB collections:
  finder_output -> ranker_output -> decider_output -> explainer_output -> agent0_output

Real CSV column names from our dataset:
  txn_id, account_id, counterparty_id, amount, timestamp,
  merchant_category, device_id, ip_region, account_open_date

Every entity written to MongoDB must carry an entity_type field.
"""

import os
import sys
from datetime import datetime

from dotenv import load_dotenv
from pymongo import MongoClient

# Windows terminals default to cp1252, which can't print the -> . characters
# used in handoff log messages - force UTF-8 so log_handoff() never crashes.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

load_dotenv()

COLLECTIONS = [
    "finder_output",
    "ranker_output",
    "decider_output",
    "explainer_output",
    "agent0_output",
]

_client = None
db = None


def connect_memory():
    """Connect to MongoDB using MONGODB_URI from .env (idempotent)."""
    global _client, db
    if db is None:
        _client = MongoClient(os.getenv("MONGODB_URI"))
        db = _client["fraudwhisperer"]
        ensure_indexes()
    return db


# -----------------------------------------
# HANDOFF LOG  - proof of real collaboration
# -----------------------------------------
handoff_log: list[dict] = []


def log_handoff(agent: str, action: str, detail: str) -> dict:
    entry = {
        "agent":     agent,
        "action":    action,
        "detail":    detail,
        "timestamp": datetime.now().strftime("%H:%M:%S"),
    }
    handoff_log.append(entry)
    print(f"[{entry['timestamp']}] {agent} | {action} | {detail}")
    return entry


# -----------------------------------------
# MEMORY SETUP
# -----------------------------------------
def clear_memory():
    """Drop all 5 agent collections - called at the start of each run."""
    memory = connect_memory()
    for collection_name in COLLECTIONS:
        memory.drop_collection(collection_name)
    log_handoff("Memory", "RESET", "All collections dropped - fresh case ready")


# -----------------------------------------
# READ / WRITE  - used by every agent
# -----------------------------------------
def write_entities(collection_name: str, entities: list[dict]) -> None:
    """Insert a batch of typed entities into a collection. Each entity must carry entity_type."""
    if not entities:
        return
    memory = connect_memory()
    memory[collection_name].insert_many([dict(e) for e in entities])


def read_entities(collection_name: str, entity_type: str) -> list[dict]:
    """Return all documents in a collection matching the given entity_type."""
    memory = connect_memory()
    return [
        {k: v for k, v in doc.items() if k != "_id"}
        for doc in memory[collection_name].find({"entity_type": entity_type})
    ]





def read_all_entities(collection_name: str) -> list[dict]:
    """Return ALL documents in a collection (Agent 4 reads everything)."""
    memory = connect_memory()
    return [
        {k: v for k, v in doc.items() if k != "_id"}
        for doc in memory[collection_name].find()
    ]


def ensure_indexes():
    """Create indexes on entity_type for fast reads - call once after connect."""
    memory = connect_memory()
    for collection_name in COLLECTIONS:
        memory[collection_name].create_index("entity_type")


def get_handoff_summary() -> list[dict]:
    """Return the handoff log - used by the frontend Memory Handoff tab."""
    return handoff_log