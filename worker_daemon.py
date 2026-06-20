"""Client-side orchestrator: install this on idle compute, run it, get paid for docking
jobs. This is the only thing that runs directly on the host -- its only dependency is
`requests` plus the Docker CLI. It never touches RDKit/gnina/CUDA libraries itself;
each claimed job is run in a fresh, disposable container built from this repo's
Dockerfile (the "engine image"), which is where all of that lives, fully sealed off
from the host's own Python/system packages.

Polls the control plane for queued work over plain outbound HTTP, so it works from
behind a home router/NAT/firewall without any inbound port-forwarding or public
address on the worker's machine.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).

Usage:
    CONTROL_PLANE_URL=https://your-deployment.vercel.app WORKER_ID=node-1 \
        python worker_daemon.py
"""
import json
import logging
import os
import shutil
import socket
import subprocess
import tempfile
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker_daemon")

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8000")
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "3"))
# Vina is the working engine for now (see SESSION_HANDOFF.md) -- gnina's image needs a
# pre-downloaded binary that isn't in the git repo (gitignored, ~1.4GB) and hasn't had a
# clean successful build yet. ENGINE_DOCKERFILE must point at whichever Dockerfile
# actually builds ENGINE_IMAGE -- they're set independently because nothing here can
# infer one from the other.
ENGINE_IMAGE = os.environ.get("ENGINE_IMAGE", "docking-engine-vina:latest")
ENGINE_DOCKERFILE = os.environ.get("ENGINE_DOCKERFILE", "vina-test/Dockerfile")
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))


def has_gpu_passthrough_available() -> bool:
    """Host-level check, once per process: real GPU + NVIDIA Container Toolkit
    registered with Docker, i.e. whether `--gpus all` will actually do anything."""
    try:
        subprocess.run(["nvidia-smi"], check=True, capture_output=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False
    info = subprocess.run(["docker", "info"], capture_output=True, text=True)
    return "nvidia" in info.stdout.lower()


def ensure_engine_image_built() -> None:
    check = subprocess.run(["docker", "images", "-q", ENGINE_IMAGE], capture_output=True, text=True)
    if check.stdout.strip():
        return
    log.info("engine image %s not found locally, building from %s (first run only)...", ENGINE_IMAGE, ENGINE_DOCKERFILE)
    dockerfile_path = os.path.join(REPO_ROOT, ENGINE_DOCKERFILE)
    subprocess.run(["docker", "build", "-f", dockerfile_path, "-t", ENGINE_IMAGE, REPO_ROOT], check=True)


def claim_one_job() -> dict | None:
    resp = requests.post(f"{CONTROL_PLANE_URL}/jobs/claim", json={"worker_id": WORKER_ID}, timeout=10)
    resp.raise_for_status()
    return resp.json()["job"]


def report_result(job_id: str, result: list) -> None:
    requests.post(f"{CONTROL_PLANE_URL}/jobs/{job_id}/worker-callback", json={"result": result}, timeout=10)


def report_error(job_id: str, error: str) -> None:
    requests.post(f"{CONTROL_PLANE_URL}/jobs/{job_id}/worker-callback", json={"error": error}, timeout=10)


def run_one_job(job_id: str, job_spec: dict, gpu_available: bool) -> None:
    log.info("claimed job %s, running engine container...", job_id)
    job_dir = tempfile.mkdtemp(prefix=f"job_{job_id}_")
    try:
        with open(os.path.join(job_dir, "job_spec.json"), "w") as f:
            json.dump(job_spec, f)

        cmd = ["docker", "run", "--rm"]
        if gpu_available:
            cmd += ["--gpus", "all"]
        cmd += ["-v", f"{job_dir}:/job", ENGINE_IMAGE]

        proc = subprocess.run(cmd, capture_output=True, text=True)
        result_path = os.path.join(job_dir, "result.json")
        if not os.path.exists(result_path):
            raise RuntimeError(f"engine container produced no result.json (exit {proc.returncode}): {proc.stderr[-2000:]}")

        with open(result_path) as f:
            output = json.load(f)

        if "error" in output:
            report_error(job_id, output["error"])
            log.warning("job %s failed inside engine container: %s", job_id, output["error"])
        else:
            report_result(job_id, output["result"])
            log.info("job %s done, %d ligand(s) docked", job_id, len(output["result"]))
    except Exception as exc:  # noqa: BLE001 -- must always report back, success or failure
        log.exception("job %s failed", job_id)
        report_error(job_id, str(exc))
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)  # no retention after the job settles


def main() -> None:
    log.info("worker daemon starting: id=%s control_plane=%s", WORKER_ID, CONTROL_PLANE_URL)
    subprocess.run(["docker", "--version"], check=True, capture_output=True)  # fail fast if Docker missing

    gpu_available = has_gpu_passthrough_available()
    log.info("GPU passthrough available: %s", gpu_available)

    ensure_engine_image_built()
    log.info("engine image ready, polling for jobs...")

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

        run_one_job(job["job_id"], job["job_spec"], gpu_available)


if __name__ == "__main__":
    main()
