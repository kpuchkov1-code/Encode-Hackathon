"""Job persistence (SQLite) and Escrow ledger (JSON) for the docking marketplace backend.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md). Escrow/Storage stay mocked
locally for now -- swapping to real DeepBook/Walrus is a later, separate step.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

DB_PATH = os.environ.get("DOCKING_DB_PATH", "jobs.db")
ESCROW_PATH = os.environ.get("DOCKING_ESCROW_PATH", "escrow_ledger.json")

VALID_STATES = {"queued", "running", "docked", "proven", "settled", "failed"}


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            spec_json TEXT NOT NULL,
            state TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            result_json TEXT,
            claimed_by TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def create_job(job_spec: dict) -> dict:
    job_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO jobs (job_id, spec_json, state, reason, created_at) VALUES (?, ?, ?, ?, ?)",
        (job_id, json.dumps(job_spec), "queued", "", created_at),
    )
    conn.commit()
    conn.close()
    return {"job_id": job_id, "state": "queued"}


def get_job(job_id: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT job_id, spec_json, state, reason, result_json, claimed_by, created_at FROM jobs WHERE job_id = ?",
        (job_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return {
        "job_id": row[0],
        "spec": json.loads(row[1]),
        "state": row[2],
        "reason": row[3],
        "result": json.loads(row[4]) if row[4] else None,
        "claimed_by": row[5],
        "created_at": row[6],
    }


def claim_next_job(worker_id: str) -> dict | None:
    """Atomically claims the oldest queued job for a polling worker daemon.

    Returns the full job dict (including spec) on success, or None if there is
    nothing queued. Uses a conditional UPDATE so two daemons racing to claim
    the same job can't both succeed.
    """
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT job_id FROM jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1"
    ).fetchone()
    if row is None:
        conn.close()
        return None

    job_id = row[0]
    cur = conn.execute(
        "UPDATE jobs SET state = 'running', claimed_by = ? WHERE job_id = ? AND state = 'queued'",
        (worker_id, job_id),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return None  # lost the race to another daemon
    return get_job(job_id)


def update_job(job_id: str, *, state: str | None = None, reason: str | None = None,
                result: list | None = None) -> None:
    assert state is None or state in VALID_STATES
    conn = sqlite3.connect(DB_PATH)
    if state is not None:
        conn.execute("UPDATE jobs SET state = ? WHERE job_id = ?", (state, job_id))
    if reason is not None:
        conn.execute("UPDATE jobs SET reason = ? WHERE job_id = ?", (reason, job_id))
    if result is not None:
        conn.execute("UPDATE jobs SET result_json = ? WHERE job_id = ?", (json.dumps(result), job_id))
    conn.commit()
    conn.close()


def _read_ledger() -> dict:
    if not os.path.exists(ESCROW_PATH):
        return {}
    with open(ESCROW_PATH) as f:
        return json.load(f)


def _write_ledger(ledger: dict) -> None:
    with open(ESCROW_PATH, "w") as f:
        json.dump(ledger, f, indent=2)


def escrow_hold(job_id: str, amount: float, supplier_id: str) -> None:
    ledger = _read_ledger()
    ledger[job_id] = {"state": "held", "amount": amount, "supplier_id": supplier_id}
    _write_ledger(ledger)


def escrow_release(job_id: str, proof) -> bool:
    """Releases held escrow only against a non-empty proof. Returns False (no-op) otherwise."""
    if not proof:
        return False
    ledger = _read_ledger()
    if job_id not in ledger or ledger[job_id]["state"] != "held":
        return False
    ledger[job_id]["state"] = "released"
    _write_ledger(ledger)
    return True


def escrow_refund(job_id: str) -> None:
    ledger = _read_ledger()
    if job_id in ledger:
        ledger[job_id]["state"] = "refunded"
        _write_ledger(ledger)


def escrow_status(job_id: str) -> dict | None:
    return _read_ledger().get(job_id)
