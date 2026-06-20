"""Control-plane API: job intake, status, escrow, results/proof.

This is the Vercel-deployable piece -- Vercel's Python runtime serves this module's
`app` (a standard ASGI app) directly. It never runs gnina itself, and it never reaches
out to a worker either: idle-compute machines (worker_daemon.py) typically sit behind
NAT and can't accept inbound connections, so this is a pure pull model -- daemons poll
POST /jobs/claim for work, run it themselves, and report back via
POST /jobs/{job_id}/worker-callback. The control plane never blocks on a docking run.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).
"""
import os
import sys
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import models  # noqa: E402

app = FastAPI(title="docking-marketplace-control-plane")


@app.on_event("startup")
def _startup() -> None:
    models.init_db()


@app.exception_handler(RequestValidationError)
def _validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"error": str(exc)})


class ReceptorSpec(BaseModel):
    pdb_id: Optional[str] = None
    file: Optional[str] = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "ReceptorSpec":
        if bool(self.pdb_id) == bool(self.file):
            raise ValueError("receptor must have exactly one of pdb_id or file")
        return self


class BoxSpec(BaseModel):
    autobox_ligand: Optional[str] = None
    center: Optional[list[float]] = None
    size: Optional[list[float]] = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "BoxSpec":
        has_autobox = bool(self.autobox_ligand)
        has_center_size = self.center is not None and self.size is not None
        if has_autobox == has_center_size:
            raise ValueError("box must have exactly one of autobox_ligand or (center and size)")
        return self


class ParamsSpec(BaseModel):
    exhaustiveness: int
    num_modes: int
    cnn: str
    seed: int


class PaymentSpec(BaseModel):
    amount: float
    supplier_id: str


class JobSpec(BaseModel):
    receptor: ReceptorSpec
    ligands_sdf: str = Field(min_length=1)
    box: BoxSpec
    params: ParamsSpec
    payment: PaymentSpec


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
def submit_job(job_spec: JobSpec) -> dict:
    spec_dict = job_spec.model_dump()
    created = models.create_job(spec_dict)
    job_id = created["job_id"]
    models.escrow_hold(job_id, spec_dict["payment"]["amount"], spec_dict["payment"]["supplier_id"])
    return created


class ClaimRequest(BaseModel):
    worker_id: str


@app.post("/jobs/claim")
def claim_job(claim: ClaimRequest) -> dict:
    """Polled by worker daemons (never pushed to -- they may be behind NAT)."""
    job = models.claim_next_job(claim.worker_id)
    if job is None:
        return {"job": None}
    return {"job": {"job_id": job["job_id"], "job_spec": job["spec"]}}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    return {"job_id": job["job_id"], "state": job["state"], "reason": job["reason"]}


@app.get("/jobs/{job_id}/escrow")
def get_escrow(job_id: str) -> dict:
    if models.get_job(job_id) is None:
        raise HTTPException(status_code=404)
    record = models.escrow_status(job_id)
    if record is None:
        raise HTTPException(status_code=404)
    return record


@app.get("/jobs/{job_id}/result")
def get_result(job_id: str) -> list:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job["state"] not in ("docked", "proven", "settled"):
        raise HTTPException(status_code=409, detail=f"job is in state {job['state']}, not yet docked")
    return job["result"]


class WorkerCallback(BaseModel):
    result: Optional[list[dict]] = None
    error: Optional[str] = None


@app.post("/jobs/{job_id}/worker-callback")
def worker_callback(job_id: str, callback: WorkerCallback) -> dict:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)

    if callback.error is not None:
        models.update_job(job_id, state="failed", reason=callback.error)
        models.escrow_refund(job_id)
        return {"ok": True}

    models.update_job(job_id, state="docked", result=callback.result)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
