"""Docking worker service: receives a job dispatch, runs gnina, calls back with results.

Runs locally on whatever machine has idle compute -- never deployed to Vercel. This is
the "idle compute" side of the marketplace: the control plane (api/index.py) dispatches
here and does not wait for the result; this service runs the docking in the background
and POSTs the outcome to the job's callback_url when done.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).
"""
import os
import shutil
import tempfile

import requests
from fastapi import BackgroundTasks, FastAPI

import docking_worker

app = FastAPI(title="docking-marketplace-worker")


def _run_and_callback(job_id: str, job_spec: dict, callback_url: str) -> None:
    work_dir = tempfile.mkdtemp(prefix=f"job_{job_id}_")
    try:
        result = docking_worker.dock_job(job_spec, work_dir)
        requests.post(callback_url, json={"result": result}, timeout=10)
    except Exception as exc:  # noqa: BLE001 -- must always report back, success or failure
        requests.post(callback_url, json={"error": str(exc)}, timeout=10)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)  # ephemeral per design decision: no retention after settle


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/dock", status_code=202)
def dock(payload: dict, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(
        _run_and_callback, payload["job_id"], payload["job_spec"], payload["callback_url"]
    )
    return {"accepted": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("WORKER_PORT", 8001)))
