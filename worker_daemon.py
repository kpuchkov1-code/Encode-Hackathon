"""Client-side daemon: install this on idle compute, run it, get paid for docking jobs.

Polls the control plane for queued work, runs the real gnina docking locally, and
reports the result back -- entirely outbound HTTP, so it works from behind a home
router/NAT/firewall without any inbound port-forwarding or public address on the
worker's machine. Never deployed to Vercel; this is meant to run wherever the idle
compute actually is.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).

Usage:
    CONTROL_PLANE_URL=https://your-deployment.vercel.app WORKER_ID=node-1 \
        python worker_daemon.py
"""
import logging
import os
import shutil
import socket
import tempfile
import time

import requests

import docking_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker_daemon")

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8000")
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "3"))


def claim_one_job() -> dict | None:
    resp = requests.post(f"{CONTROL_PLANE_URL}/jobs/claim", json={"worker_id": WORKER_ID}, timeout=10)
    resp.raise_for_status()
    return resp.json()["job"]


def report_result(job_id: str, result: list) -> None:
    requests.post(f"{CONTROL_PLANE_URL}/jobs/{job_id}/worker-callback", json={"result": result}, timeout=10)


def report_error(job_id: str, error: str) -> None:
    requests.post(f"{CONTROL_PLANE_URL}/jobs/{job_id}/worker-callback", json={"error": error}, timeout=10)


def run_one_job(job_id: str, job_spec: dict) -> None:
    log.info("claimed job %s, docking...", job_id)
    work_dir = tempfile.mkdtemp(prefix=f"job_{job_id}_")
    try:
        result = docking_worker.dock_job(job_spec, work_dir)
        report_result(job_id, result)
        log.info("job %s done, %d ligand(s) docked", job_id, len(result))
    except Exception as exc:  # noqa: BLE001 -- must always report back, success or failure
        log.exception("job %s failed", job_id)
        report_error(job_id, str(exc))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)  # no retention after the job settles


def main() -> None:
    log.info("worker daemon starting: id=%s control_plane=%s", WORKER_ID, CONTROL_PLANE_URL)
    while True:
        try:
            job = claim_one_job()
        except requests.RequestException:
            log.exception("could not reach control plane, will retry")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        if job is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        run_one_job(job["job_id"], job["job_spec"])


if __name__ == "__main__":
    main()
