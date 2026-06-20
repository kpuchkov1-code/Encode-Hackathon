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
import secrets
import uuid
from datetime import datetime, timezone

import requests

KV_REST_API_URL = os.environ["KV_REST_API_URL"]
KV_REST_API_TOKEN = os.environ["KV_REST_API_TOKEN"]

# --- Sui on-chain escrow (opt-in) -------------------------------------------------
# The escrow ledger is real on Sui testnet when a bridge is configured, otherwise it
# stays the pure-KV mock below so local dev / unconfigured deploys keep working. Two
# transports: SUI_BRIDGE_URL (the bridge deployed as its own HTTP service, for Vercel)
# or SUI_BRIDGE_CMD (run the bridge CLI as a subprocess, for local dev). Whichever is
# set holds the platform key + package id on the bridge side -- never here.
SUI_BRIDGE_URL = os.environ.get("SUI_BRIDGE_URL")           # e.g. https://sui-bridge.example.com
SUI_BRIDGE_CMD = os.environ.get("SUI_BRIDGE_CMD")           # e.g. "node /path/sui-bridge/cli.mjs"
SUI_BRIDGE_SECRET = os.environ.get("SUI_BRIDGE_SECRET", "")
# Maps an abstract price unit (the "$" the pricing logic computes) to on-chain MIST.
# Default: 1 price unit = 0.001 SUI, deliberately tiny so testnet funds last.
MIST_PER_PRICE_UNIT = int(os.environ.get("MIST_PER_PRICE_UNIT", "1000000"))
SUI_ONCHAIN = bool(SUI_BRIDGE_URL or SUI_BRIDGE_CMD)


def _sui(op: str, payload: dict) -> dict:
    """Invoke one escrow operation on the signing bridge. Raises on any bridge error so
    callers never silently treat a failed on-chain move as success."""
    if SUI_BRIDGE_URL:
        resp = requests.post(
            f"{SUI_BRIDGE_URL.rstrip('/')}/{op}",
            json=payload,
            headers={"x-bridge-secret": SUI_BRIDGE_SECRET},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    else:  # subprocess CLI form (local dev)
        import shlex
        import subprocess

        arg_order = {
            "address": [],
            "lock": ["jobId", "amountMist"],
            "release": ["escrowObjectId", "providerAddress"],
            "refund": ["escrowObjectId"],
        }[op]
        cmd = shlex.split(SUI_BRIDGE_CMD) + [op] + [str(payload[k]) for k in arg_order]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        data = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else {}
        if proc.returncode != 0 and "error" not in data:
            raise RuntimeError(f"sui bridge {op} failed: {proc.stderr.strip()[:500]}")
    if "error" in data:
        raise RuntimeError(f"sui bridge {op} error: {data['error']}")
    return data

VALID_STATES = {
    "pending_payment", "queued", "running", "docked",
    "verifying",   # primary job done, awaiting an independent re-run before settlement
    "proven",      # independent verification matched within tolerance
    "settled", "disputed", "failed",
}

JOB_KEY = "job:{job_id}"
ESCROW_KEY = "escrow:{job_id}"
QUEUE_KEY = "queued_jobs"
RUNNING_SET_KEY = "running_jobs"
WORKER_KEY = "worker:{worker_id}"
WORKERS_SET_KEY = "registered_workers"
RESEARCHER_KEY = "researcher:{researcher_id}"
RESEARCHERS_SET_KEY = "registered_researchers"


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


def create_job(job_spec: dict, *, price: float, researcher_id: str) -> dict:
    """Creates a job in `pending_payment` -- NOT queued for execution yet. A job only
    becomes visible to worker daemons once confirm_job() is called (after the
    researcher has seen the price estimate and explicitly agreed to it)."""
    job_id = str(uuid.uuid4())
    record = {
        "job_id": job_id,
        "spec": job_spec,
        "state": "pending_payment",
        "reason": "",
        "result": None,
        "claimed_by": None,
        "price": price,
        "researcher_id": researcher_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _cmd("SET", JOB_KEY.format(job_id=job_id), json.dumps(record))
    return {"job_id": job_id, "state": "pending_payment", "price": price}


def confirm_job(job_id: str) -> dict | None:
    """Researcher has agreed to the price -- hold escrow and actually enqueue the job
    for a worker daemon to claim. Returns None if the job doesn't exist or isn't
    awaiting payment (e.g. already confirmed, or expired/failed)."""
    record = get_job(job_id)
    if record is None or record["state"] != "pending_payment":
        return None
    record["state"] = "queued"
    _put_job(record)
    _cmd("RPUSH", QUEUE_KEY, job_id)
    escrow_hold(job_id, record["price"], record["spec"]["payment"]["supplier_id"])
    increment_researcher_stats(record["researcher_id"], submitted=True, spent=record["price"])
    return record


def create_verification_job(parent_job_id: str, spec: dict, exclude_worker: str | None) -> str:
    """Create a derived re-execution job that an *independent* worker runs to check the
    primary result. It's queued immediately (no pricing, no escrow, no researcher -- it's
    internal), carries `kind=verification` so worker_callback routes it to the comparison
    path instead of the settlement path, and records `exclude_worker` so claim_next_job
    won't hand it back to the worker that produced the original result."""
    job_id = str(uuid.uuid4())
    record = {
        "job_id": job_id,
        "spec": spec,
        "state": "queued",
        "reason": "",
        "result": None,
        "claimed_by": None,
        "kind": "verification",
        "parent_job_id": parent_job_id,
        "exclude_worker": exclude_worker,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _cmd("SET", JOB_KEY.format(job_id=job_id), json.dumps(record))
    _cmd("RPUSH", QUEUE_KEY, job_id)
    return job_id


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

    Verification jobs carry `exclude_worker` (the worker that produced the original
    result): this worker must not verify its own work, so such a job is set aside and
    the next one tried. Set-aside jobs are pushed back after, preserving order, so they
    stay claimable by some *other* worker. If nothing claimable remains for this worker,
    returns None (the excluded job just waits for an independent worker to poll).
    """
    set_aside = []
    record = None
    while True:
        job_id = _cmd("LPOP", QUEUE_KEY)
        if job_id is None:
            break
        candidate = get_job(job_id)
        if candidate is None:
            continue  # shouldn't happen, but don't crash the daemon over it
        if candidate.get("kind") == "verification" and candidate.get("exclude_worker") == worker_id:
            set_aside.append(job_id)
            continue
        record = candidate
        break
    for jid in set_aside:  # put skipped (excluded) jobs back for other workers
        _cmd("RPUSH", QUEUE_KEY, jid)
    if record is None:
        return None
    record["state"] = "running"
    record["claimed_by"] = worker_id
    record["started_at"] = datetime.now(timezone.utc).isoformat()
    record["attempts"] = record.get("attempts", 0) + 1
    _put_job(record)
    _cmd("SADD", RUNNING_SET_KEY, job_id)  # tracked so reclaim_stale_jobs() can find it
    return record


RUNNING_TIMEOUT_SECONDS = 60   # only reclaim after this AND the worker has gone offline
MAX_JOB_ATTEMPTS = 3           # give up (fail + refund) rather than requeue forever


def finish_running(job_id: str) -> None:
    """Drop a job from the running set once it reaches a terminal state (docked/failed),
    so reclaim_stale_jobs() never reconsiders it."""
    _cmd("SREM", RUNNING_SET_KEY, job_id)


def reclaim_stale_jobs() -> list[dict]:
    """Lazy recovery for daemons that die MID-job. A job in `running` whose worker has
    gone offline (no heartbeat for HEARTBEAT_TIMEOUT_SECONDS) and whose start is older
    than RUNNING_TIMEOUT_SECONDS is presumed abandoned: it's re-queued for another daemon
    up to MAX_JOB_ATTEMPTS, then failed + refunded. A worker that's still online (its
    heartbeat thread keeps pinging even while blocked on a long docking run) is left
    alone no matter how long the job takes. Called opportunistically from /jobs/claim, so
    the serverless control plane needs no background cron to drive it."""
    reclaimed = []
    for job_id in _cmd("SMEMBERS", RUNNING_SET_KEY) or []:
        record = get_job(job_id)
        if record is None or record["state"] != "running":
            _cmd("SREM", RUNNING_SET_KEY, job_id)  # terminal/gone already; clean the set
            continue
        started_at = record.get("started_at")
        if started_at is None:
            continue
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(started_at)).total_seconds()
        if age < RUNNING_TIMEOUT_SECONDS:
            continue
        worker = get_worker(record.get("claimed_by") or "")
        if worker is not None and worker.get("status") == "online":
            continue  # still alive and presumably still working -- not abandoned
        _cmd("SREM", RUNNING_SET_KEY, job_id)
        if record.get("attempts", 1) >= MAX_JOB_ATTEMPTS:
            record["state"] = "failed"
            record["reason"] = (
                f"abandoned after {record.get('attempts', 1)} attempt(s): "
                "worker went offline mid-job"
            )
            _put_job(record)
            escrow_refund(job_id)
            reclaimed.append({"job_id": job_id, "action": "failed"})
        else:
            record["state"] = "queued"
            record["claimed_by"] = None
            _put_job(record)
            _cmd("RPUSH", QUEUE_KEY, job_id)
            reclaimed.append({"job_id": job_id, "action": "requeued"})
    return reclaimed


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


def update_job_extra(job_id: str, **fields) -> None:
    """Attach/overwrite arbitrary top-level fields on a job record (e.g. `walrus`,
    `verification`) without disturbing the core state machine fields."""
    record = get_job(job_id)
    if record is None:
        return
    record.update(fields)
    _put_job(record)


def escrow_hold(job_id: str, amount: float, supplier_id: str) -> None:
    record = {"state": "held", "amount": amount, "supplier_id": supplier_id}
    if SUI_ONCHAIN:
        amount_mist = int(round(amount * MIST_PER_PRICE_UNIT))
        locked = _sui("lock", {"jobId": job_id, "amountMist": amount_mist})
        record["chain"] = {
            "network": "sui-testnet",
            "amount_mist": amount_mist,
            "escrow_object_id": locked.get("escrowObjectId"),
            "lock_digest": locked.get("digest"),
        }
    _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))


def escrow_release(job_id: str, proof, *, provider_address: str | None = None) -> bool:
    """Releases held escrow only against a non-empty proof. Returns False (no-op)
    otherwise. When on-chain and the paid worker has a Sui address, this is a real SUI
    transfer to that address; the resulting tx digest is recorded on the escrow."""
    if not proof:
        return False
    record = escrow_status(job_id)
    if record is None or record["state"] != "held":
        return False
    chain = record.get("chain")
    if SUI_ONCHAIN and chain and chain.get("escrow_object_id") and provider_address:
        released = _sui("release", {
            "escrowObjectId": chain["escrow_object_id"],
            "providerAddress": provider_address,
        })
        chain["release_digest"] = released.get("digest")
        chain["paid_to"] = provider_address
        record["chain"] = chain
    record["state"] = "released"
    _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))
    return True


def escrow_refund(job_id: str) -> None:
    record = escrow_status(job_id)
    if record is None:
        return
    chain = record.get("chain")
    if SUI_ONCHAIN and chain and chain.get("escrow_object_id") and "refund_digest" not in chain:
        refunded = _sui("refund", {"escrowObjectId": chain["escrow_object_id"]})
        chain["refund_digest"] = refunded.get("digest")
        record["chain"] = chain
    record["state"] = "refunded"
    _cmd("SET", ESCROW_KEY.format(job_id=job_id), json.dumps(record))


def escrow_status(job_id: str) -> dict | None:
    raw = _cmd("GET", ESCROW_KEY.format(job_id=job_id))
    return json.loads(raw) if raw is not None else None


HEARTBEAT_TIMEOUT_SECONDS = 15  # daemon polls every ~3s; several missed polls = offline


def create_worker_identity(sui_address: str = "") -> dict:
    """Issues a brand-new worker_id + secret token at signup. The token must be
    presented on every subsequent request made as this worker (registering detected
    hardware, claiming jobs) -- this is what actually prevents two different people
    from colliding on or impersonating the same worker_id, not just a free-text name
    anyone could type in. Returned once, here; never echoed back afterwards.

    `sui_address` is where this provider gets paid: on a verified job the platform
    releases the on-chain escrow directly to it. Optional (a provider can run without
    one and just not receive real payouts yet)."""
    worker_id = f"worker-{uuid.uuid4().hex[:12]}"
    token = secrets.token_urlsafe(24)
    record = {
        "worker_id": worker_id,
        "token": token,
        "sui_address": sui_address.strip(),
        "hardware_info": "(pending -- starts once the daemon runs and detects it)",
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "last_seen": None,
    }
    _cmd("SET", WORKER_KEY.format(worker_id=worker_id), json.dumps(record))
    _cmd("SADD", WORKERS_SET_KEY, worker_id)
    return record


def verify_worker_token(worker_id: str, token: str) -> bool:
    record = get_worker(worker_id)
    return record is not None and secrets.compare_digest(record.get("token", ""), token)


def update_worker(worker_id: str, *, hardware_info: str | None = None, heartbeat: bool = False) -> None:
    record = get_worker(worker_id)
    if record is None:
        return
    if hardware_info is not None:
        record["hardware_info"] = hardware_info
    if heartbeat:
        record["last_seen"] = datetime.now(timezone.utc).isoformat()
    _cmd("SET", WORKER_KEY.format(worker_id=worker_id), json.dumps(record))


def mark_worker_offline(worker_id: str) -> None:
    """Called when a daemon shuts down cleanly (Ctrl+C, not a crash) so its status
    flips to offline immediately instead of waiting out the heartbeat timeout."""
    record = get_worker(worker_id)
    if record is not None:
        record["last_seen"] = None
        _cmd("SET", WORKER_KEY.format(worker_id=worker_id), json.dumps(record))


def get_worker(worker_id: str) -> dict | None:
    """Returns the worker record with a computed `status` (online/offline) based on
    HEARTBEAT_TIMEOUT_SECONDS -- never trust a stored status, always compute it fresh
    from `last_seen` so a crashed (not cleanly shut down) daemon still ages out."""
    raw = _cmd("GET", WORKER_KEY.format(worker_id=worker_id))
    if raw is None:
        return None
    record = json.loads(raw)
    last_seen = record.get("last_seen")
    if last_seen is None:
        record["status"] = "offline"
    else:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(last_seen)).total_seconds()
        record["status"] = "online" if age < HEARTBEAT_TIMEOUT_SECONDS else "offline"
    return record


def list_workers() -> list[str]:
    return _cmd("SMEMBERS", WORKERS_SET_KEY) or []


def increment_worker_stats(worker_id: str, *, completed: bool = False, earned: float = 0) -> None:
    """`earned` is a proxy (price of jobs this worker has docked), not real settled
    payment -- there's no real escrow release/blockchain payout yet (see
    SESSION_HANDOFF.md §8). Labelled as such wherever it's displayed."""
    record = get_worker(worker_id)
    if record is None:
        return
    record.pop("status", None)  # computed field from get_worker, don't persist it
    record["jobs_completed"] = record.get("jobs_completed", 0) + (1 if completed else 0)
    record["total_earned"] = record.get("total_earned", 0) + earned
    _cmd("SET", WORKER_KEY.format(worker_id=worker_id), json.dumps(record))


def create_researcher_identity(email: str) -> dict:
    researcher_id = f"researcher-{uuid.uuid4().hex[:12]}"
    record = {
        "researcher_id": researcher_id,
        "email": email,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "jobs_submitted": 0,
        "total_spent": 0,
    }
    _cmd("SET", RESEARCHER_KEY.format(researcher_id=researcher_id), json.dumps(record))
    _cmd("SADD", RESEARCHERS_SET_KEY, researcher_id)
    return record


def get_researcher(researcher_id: str) -> dict | None:
    raw = _cmd("GET", RESEARCHER_KEY.format(researcher_id=researcher_id))
    return json.loads(raw) if raw is not None else None


def increment_researcher_stats(researcher_id: str, *, submitted: bool = False, spent: float = 0) -> None:
    record = get_researcher(researcher_id)
    if record is None:
        return
    record["jobs_submitted"] = record.get("jobs_submitted", 0) + (1 if submitted else 0)
    record["total_spent"] = record.get("total_spent", 0) + spent
    _cmd("SET", RESEARCHER_KEY.format(researcher_id=researcher_id), json.dumps(record))


def list_researchers() -> list[str]:
    return _cmd("SMEMBERS", RESEARCHERS_SET_KEY) or []
