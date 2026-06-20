"""Job persistence and Escrow ledger for the docking marketplace backend.

Backed by Upstash Redis over its REST API (the same store Vercel KV provisions),
because a Vercel serverless function has no persistent local filesystem shared across
invocations -- a job created in one request must be visible to a claim request that
may land on a completely different function instance. Reads KV_REST_API_URL /
KV_REST_API_TOKEN, the exact env var names Vercel injects when a KV store is linked to
the project, so this works with zero extra config once deployed.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md). Escrow/Storage stay mocked
(this same KV store) for now -- swapping to real DeepBook/Walrus is a later, separate
step; the function signatures here are what that step will replace internally.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import requests

KV_REST_API_URL = os.environ["KV_REST_API_URL"]
KV_REST_API_TOKEN = os.environ["KV_REST_API_TOKEN"]

VALID_STATES = {"queued", "running", "docked", "proven", "settled", "failed"}

JOB_KEY = "job:{job_id}"
ESCROW_KEY = "escrow:{job_id}"
QUEUE_KEY = "queued_jobs"
WORKER_KEY = "worker:{worker_id}"
WORKERS_SET_KEY = "registered_workers"


def _cmd(*args) -> object:
    resp = requests.post(
        KV_REST_API_URL,
        json=list(args),
        headers={"Authorization": f"Bearer {KV_REST_API_TOKEN}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["result"]


def init_db() -> None:
    pass  # Upstash needs no schema setup; kept for call-site compatibility.


def create_job(job_spec: dict) -> dict:
    job_id = str(uuid.uuid4())
    record = {
        "job_id": job_id,
        "spec": job_spec,
        "state": "queued",
        "reason": "",
        "result": None,
        "claimed_by": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _cmd("SET", JOB_KEY.format(job_id=job_id), json.dumps(record))
    _cmd("RPUSH", QUEUE_KEY, job_id)
    return {"job_id": job_id, "state": "queued"}


def get_job(job_id: str) -> dict | None:
    raw = _cmd("GET", JOB_KEY.format(job_id=job_id))
    if raw is None:
        return None
    return json.loads(raw)


def _put_job(record: dict) -> None:
    _cmd("SET", JOB_KEY.format(job_id=record["job_id"]), json.dumps(record))


def claim_next_job(worker_id: str) -> dict | None:
    """Claims the oldest queued job for a polling worker daemon.

    LPOP on a shared remote list is atomic, so two daemons racing to claim can't
    both get the same job_id -- no separate locking needed.
    """
    job_id = _cmd("LPOP", QUEUE_KEY)
    if job_id is None:
        return None
    record = get_job(job_id)
    if record is None:
        return None  # shouldn't happen, but don't crash the daemon over it
    record["state"] = "running"
    record["claimed_by"] = worker_id
    _put_job(record)
    return record


def update_job(job_id: str, *, state: str | None = None, reason: str | None = None,
                result: list | None = None) -> None:
    assert state is None or state in VALID_STATES
    record = get_job(job_id)
    if record is None:
        return
    if state is not None:
        record["state"] = state
    if reason is not None:
        record["reason"] = reason
    if result is not None:
        record["result"] = result
    _put_job(record)


def escrow_hold(job_id: str, amount: float, supplier_id: str) -> None:
    record = {"state": "held", "amount": amount, "supplier_id": supplier_id}
    _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))


def escrow_release(job_id: str, proof) -> bool:
    """Releases held escrow only against a non-empty proof. Returns False (no-op) otherwise."""
    if not proof:
        return False
    record = escrow_status(job_id)
    if record is None or record["state"] != "held":
        return False
    record["state"] = "released"
    _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))
    return True


def escrow_refund(job_id: str) -> None:
    record = escrow_status(job_id)
    if record is not None:
        record["state"] = "refunded"
        _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))


def escrow_status(job_id: str) -> dict | None:
    raw = _cmd("GET", ESCROW_KEY.format(job_id=job_id))
    return json.loads(raw) if raw is not None else None


def register_worker(worker_id: str, hardware_info: str) -> dict:
    """Records a hardware provider's signup. No capability-matching yet (see
    SESSION_HANDOFF.md §8) -- any registered worker can claim any queued job."""
    record = {
        "worker_id": worker_id,
        "hardware_info": hardware_info,
        "registered_at": datetime.now(timezone.utc).isoformat(),
    }
    _cmd("SET", WORKER_KEY.format(worker_id=worker_id), json.dumps(record))
    _cmd("SADD", WORKERS_SET_KEY, worker_id)
    return record


def get_worker(worker_id: str) -> dict | None:
    raw = _cmd("GET", WORKER_KEY.format(worker_id=worker_id))
    return json.loads(raw) if raw is not None else None


def list_workers() -> list[str]:
    return _cmd("SMEMBERS", WORKERS_SET_KEY) or []
