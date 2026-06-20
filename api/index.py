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

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import models  # noqa: E402

app = FastAPI(title="docking-marketplace-control-plane")


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
    seed: int
    cnn: Optional[str] = None  # gnina-only (CNN rescoring mode); meaningless for Vina


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


class WorkerRegistration(BaseModel):
    worker_id: str
    hardware_info: str = ""


@app.post("/workers/register")
def register_worker(registration: WorkerRegistration) -> dict:
    """Hardware providers register before running the daemon. No capability-matching
    yet (see SESSION_HANDOFF.md §8) -- registration is bookkeeping only for now; any
    worker_id can claim any job regardless of whether it's registered."""
    return models.register_worker(registration.worker_id, registration.hardware_info)


# --- Minimal, unstyled HTML so both sides of the marketplace can be exercised by hand
# without waiting on the real frontend (Kirill's separate workstream). No CSS, no JS.

@app.get("/providers/signup", response_class=HTMLResponse)
def providers_signup_form() -> str:
    return """
    <h1>Provide idle compute</h1>
    <form method="post" action="/providers/signup">
      <label>Worker ID (pick something unique): <input name="worker_id" required></label><br>
      <label>Hardware description (e.g. "RTX 3070, 8 cores"): <input name="hardware_info"></label><br>
      <button type="submit">Register</button>
    </form>
    """


@app.post("/providers/signup", response_class=HTMLResponse)
def providers_signup_submit(request: Request, worker_id: str = Form(...), hardware_info: str = Form("")) -> str:
    models.register_worker(worker_id, hardware_info)
    base_url = str(request.base_url).rstrip("/")
    return f"""
    <h1>Registered: {worker_id}</h1>
    <p>Run this on the machine providing compute (needs Python 3 + Docker):</p>
    <pre>CONTROL_PLANE_URL={base_url} WORKER_ID={worker_id} python worker_daemon.py</pre>
    <p>The daemon will poll for jobs, run them in a Docker container, and report back.
    Nothing else is installed on your machine -- gnina/RDKit/etc. are sealed inside the
    per-job container.</p>
    """


@app.get("/researchers/submit", response_class=HTMLResponse)
def researchers_submit_form() -> str:
    return """
    <h1>Submit a docking job</h1>
    <form method="post" action="/researchers/submit" enctype="multipart/form-data">
      <label>Protein (PDB file): <input type="file" name="receptor_pdb" required></label><br>
      <label>Ligands (one or more SDF files, a screening library): <input type="file" name="ligand_sdfs" multiple required></label><br>
      <label>Reference ligand for docking box (SDF, optional -- omit to specify center/size manually): <input type="file" name="ref_ligand_sdf"></label><br>
      <label>Box center x,y,z (only if no reference ligand given): <input name="center" placeholder="0,0,0"></label><br>
      <label>Box size x,y,z (only if no reference ligand given): <input name="size" placeholder="20,20,20"></label><br>
      <label>Payment amount: <input name="amount" value="100"></label><br>
      <button type="submit">Submit job</button>
    </form>
    """


@app.post("/researchers/submit", response_class=HTMLResponse)
async def researchers_submit_handler(
    request: Request,
    receptor_pdb: UploadFile = File(...),
    ligand_sdfs: list[UploadFile] = File(...),
    ref_ligand_sdf: Optional[UploadFile] = File(None),
    center: str = Form(""),
    size: str = Form(""),
    amount: float = Form(100.0),
) -> str:
    pdb_text = (await receptor_pdb.read()).decode()
    ligand_chunks = []
    for f in ligand_sdfs:
        ligand_chunks.append((await f.read()).decode())
    ligands_sdf = "".join(ligand_chunks)

    if ref_ligand_sdf is not None and ref_ligand_sdf.filename:
        box = {"autobox_ligand": (await ref_ligand_sdf.read()).decode()}
    else:
        box = {
            "center": [float(x) for x in center.split(",")],
            "size": [float(x) for x in size.split(",")],
        }

    job_spec = JobSpec(
        receptor=ReceptorSpec(file=pdb_text),
        ligands_sdf=ligands_sdf,
        box=BoxSpec(**box),
        # Low exhaustiveness/num_modes -- this form is for quick end-to-end testing of
        # the marketplace flow, not docking quality. A real submission UI (or the JSON
        # API directly) should let the researcher pick real values. No `cnn` -- that's
        # gnina-specific and we're using Vina for now.
        params=ParamsSpec(exhaustiveness=1, num_modes=1, seed=42),
        payment=PaymentSpec(amount=amount, supplier_id="any"),
    )
    created = submit_job(job_spec)
    job_id = created["job_id"]
    base_url = str(request.base_url).rstrip("/")
    return f"""
    <h1>Job submitted: {job_id}</h1>
    <p>Check status: <a href="{base_url}/jobs/{job_id}">{base_url}/jobs/{job_id}</a></p>
    <p>Result once docked: <a href="{base_url}/jobs/{job_id}/result">{base_url}/jobs/{job_id}/result</a></p>
    """


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
