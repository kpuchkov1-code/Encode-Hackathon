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
    CONTROL_PLANE_URL=https://your-deployment.vercel.app WORKER_ID=worker-xxxx \
        WORKER_TOKEN=... python worker_daemon.py
(WORKER_ID and WORKER_TOKEN come from signing up at {control plane}/providers/signup --
they're issued by the server, not chosen here, so two daemons can never collide on or
impersonate the same identity.)
"""
import json
import logging
import os
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker_daemon")

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8000")
WORKER_ID = os.environ.get("WORKER_ID")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN")
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


def detect_hardware(gpu_available: bool) -> str:
    """Real detection, not a free-text field someone types in: CPU core count and
    platform always; GPU model name too if a real GPU + driver is present (regardless
    of whether the container toolkit is set up for passthrough yet)."""
    parts = [f"{os.cpu_count()} CPU cores", platform.system(), platform.machine()]
    gpu_name = None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            gpu_name = out.stdout.strip().splitlines()[0]
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    if gpu_name:
        parts.append(f"GPU: {gpu_name}" + (" (passthrough ready)" if gpu_available else " (no passthrough yet)"))
    return ", ".join(parts)


def register_self(hardware_info: str) -> None:
    try:
        requests.post(
            f"{CONTROL_PLANE_URL}/workers/register",
            json={"worker_id": WORKER_ID, "token": WORKER_TOKEN, "hardware_info": hardware_info},
            timeout=10,
        ).raise_for_status()
        log.info("registered with control plane: %s", hardware_info)
    except requests.RequestException:
        log.exception("could not register with control plane (continuing anyway)")


def mark_offline() -> None:
    """Called on clean shutdown (Ctrl+C) so the control plane reflects this worker
    going offline immediately, instead of waiting out the heartbeat timeout."""
    try:
        requests.post(
            f"{CONTROL_PLANE_URL}/workers/{WORKER_ID}/offline",
            json={"worker_id": WORKER_ID, "token": WORKER_TOKEN},
            timeout=5,
        )
        log.info("reported offline to control plane")
    except requests.RequestException:
        log.exception("could not report offline (control plane may show this worker as online briefly)")


HEARTBEAT_INTERVAL_SECONDS = 5  # well under the server's 15s offline timeout


def heartbeat_loop(stop_event: threading.Event) -> None:
    """Runs in its own thread so heartbeats keep going even while the main thread is
    blocked inside subprocess.run() for the whole duration of a docking job -- jobs can
    easily run longer than the heartbeat timeout, and without this the daemon would
    falsely show as offline on the dashboard while it's actively working."""
    while not stop_event.wait(HEARTBEAT_INTERVAL_SECONDS):
        try:
            requests.post(
                f"{CONTROL_PLANE_URL}/workers/{WORKER_ID}/heartbeat",
                json={"worker_id": WORKER_ID, "token": WORKER_TOKEN},
                timeout=5,
            )
        except requests.RequestException:
            log.debug("heartbeat ping failed (will retry)", exc_info=True)


def ensure_engine_image_built() -> None:
    check = subprocess.run(["docker", "images", "-q", ENGINE_IMAGE], capture_output=True, text=True)
    if check.stdout.strip():
        return
    log.info("engine image %s not found locally, building from %s (first run only)...", ENGINE_IMAGE, ENGINE_DOCKERFILE)
    dockerfile_path = os.path.join(REPO_ROOT, ENGINE_DOCKERFILE)
    subprocess.run(["docker", "build", "-f", dockerfile_path, "-t", ENGINE_IMAGE, REPO_ROOT], check=True)


def claim_one_job() -> dict | None:
    resp = requests.post(
        f"{CONTROL_PLANE_URL}/jobs/claim",
        json={"worker_id": WORKER_ID, "token": WORKER_TOKEN},
        timeout=10,
    )
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
    if not WORKER_ID or not WORKER_TOKEN:
        log.error(
            "WORKER_ID and WORKER_TOKEN are both required (sign up at "
            "%s/providers/signup to get them -- they're issued by the server, not "
            "something you make up, so identities can't collide or be impersonated)",
            CONTROL_PLANE_URL,
        )
        sys.exit(1)

    log.info("worker daemon starting: id=%s control_plane=%s", WORKER_ID, CONTROL_PLANE_URL)
    subprocess.run(["docker", "--version"], check=True, capture_output=True)  # fail fast if Docker missing

    def _on_shutdown_signal(signum, frame) -> None:  # noqa: ANN001 -- signal handler signature
        log.info("shutting down (signal %s), reporting offline...", signum)
        mark_offline()
        sys.exit(0)

    signal.signal(signal.SIGINT, _on_shutdown_signal)
    signal.signal(signal.SIGTERM, _on_shutdown_signal)

    gpu_available = has_gpu_passthrough_available()
    log.info("GPU passthrough available: %s", gpu_available)

    register_self(detect_hardware(gpu_available))

    heartbeat_stop = threading.Event()
    threading.Thread(target=heartbeat_loop, args=(heartbeat_stop,), daemon=True).start()

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
