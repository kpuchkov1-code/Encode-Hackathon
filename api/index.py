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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import models  # noqa: E402

app = FastAPI(title="docking-marketplace-control-plane")

# The worker package (everything a hardware provider needs -- and *only* that, never
# the control plane's own source) is served as a static file from public/, built by
# scripts/build_worker_package.sh, not generated dynamically here. Vercel's Python
# build only auto-bundles files reachable via actual `import` statements, so trying to
# zip arbitrary sibling files at request time silently fails in production (confirmed
# the hard way -- see git history). Static assets in public/** have no such issue.


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


@app.get("/worker-package.zip")
def worker_package_local_dev_fallback() -> FileResponse:
    """In production, Vercel serves public/** as a static asset directly -- this
    route never actually runs there (see https://vercel.com/docs/frameworks/backend/fastapi,
    "app.mount is not needed and should not be used"). It exists purely so
    `python api/index.py` behaves the same way for local testing."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "worker-package.zip")
    return FileResponse(path, media_type="application/zip", filename="worker-package.zip")


@app.post("/jobs", status_code=202)
def submit_job(job_spec: JobSpec) -> dict:
    spec_dict = job_spec.model_dump()
    created = models.create_job(spec_dict)
    job_id = created["job_id"]
    models.escrow_hold(job_id, spec_dict["payment"]["amount"], spec_dict["payment"]["supplier_id"])
    return created


class WorkerAuth(BaseModel):
    worker_id: str
    token: str


def _require_worker_token(auth: WorkerAuth) -> None:
    if not models.verify_worker_token(auth.worker_id, auth.token):
        raise HTTPException(status_code=401, detail="unknown worker_id or invalid token")


@app.post("/jobs/claim")
def claim_job(claim: WorkerAuth) -> dict:
    """Polled by worker daemons (never pushed to -- they may be behind NAT). Requires
    the token issued at signup so a job can only be claimed by a daemon that actually
    proved it owns this worker_id -- not just anyone who guesses or types the name."""
    _require_worker_token(claim)
    models.update_worker(claim.worker_id, heartbeat=True)  # polling itself is the heartbeat
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


class WorkerRegistration(WorkerAuth):
    hardware_info: str = ""


@app.post("/workers/register")
def register_worker(registration: WorkerRegistration) -> dict:
    """Called by the daemon itself on startup to report detected hardware -- requires
    the token issued at signup, so only the legitimate owner of a worker_id can update
    it (prevents impersonation/collision on a guessed or typed-in worker_id)."""
    _require_worker_token(registration)
    models.update_worker(registration.worker_id, hardware_info=registration.hardware_info, heartbeat=True)
    return {"ok": True}


@app.post("/workers/{worker_id}/offline")
def worker_offline(worker_id: str, auth: WorkerAuth) -> dict:
    """Called by the daemon on clean shutdown (Ctrl+C) so its status flips to offline
    immediately instead of waiting out the heartbeat timeout."""
    _require_worker_token(auth)
    models.mark_worker_offline(worker_id)
    return {"ok": True}


# --- Minimal, unstyled HTML so both sides of the marketplace can be exercised by hand
# without waiting on the real frontend (Kirill's separate workstream). No CSS, no JS.

@app.get("/providers/signup", response_class=HTMLResponse)
def providers_signup_form() -> str:
    return """
    <h1>Provide idle compute</h1>
    <p>Hardware is detected automatically by the daemon when it starts (CPU cores,
    GPU if present) -- you don't need to describe it yourself. Your worker ID and
    access token are generated for you, not typed in, so no two providers can ever
    collide on or impersonate the same identity.</p>
    <form method="post" action="/providers/signup">
      <button type="submit">Sign up</button>
    </form>
    """


@app.post("/providers/signup", response_class=HTMLResponse)
def providers_signup_submit(request: Request) -> str:
    identity = models.create_worker_identity()
    worker_id, token = identity["worker_id"], identity["token"]
    base_url = str(request.base_url).rstrip("/")
    run_cmd = f"CONTROL_PLANE_URL={base_url} WORKER_ID={worker_id} WORKER_TOKEN={token} ./install_worker.sh"
    return f"""
    <h1>Signed up: {worker_id}</h1>
    <p><strong>Save this command somewhere -- the token in it is only shown once and
    cannot be recovered if lost (you'd need to sign up again for a new identity).</strong></p>
    <p>Follow these steps on the computer that will actually provide compute (it can be
    a different machine than the one you're signing up from). You do not need a GitHub
    account or any access to our source code -- just this one setup package.</p>
    <ol>
      <li>Install Docker if you don't already have it:
        <a href="https://docs.docker.com/get-docker/">https://docs.docker.com/get-docker/</a>.
        Make sure it's running (e.g. <code>docker --version</code> works in a terminal).
      </li>
      <li>Make sure Python 3 is installed (<code>python3 --version</code> in a terminal;
        most Mac/Linux machines already have it -- on Windows, use WSL).</li>
      <li>Download and unpack the worker setup package:
        <pre>curl -L {base_url}/worker-package.zip -o worker-package.zip
unzip worker-package.zip -d worker-package
cd worker-package
chmod +x install_worker.sh</pre>
      </li>
      <li>Run this exact command (already has your worker ID, secret token, and this
        server's address filled in) and leave the terminal window open -- the daemon
        only receives jobs while it's running:
        <pre>{run_cmd}</pre>
        The first run also builds a small (~300MB) Docker image -- this only happens
        once. After that, nothing else gets installed on your machine; the docking
        software runs sealed inside a disposable container per job, never touching
        your system Python or packages.
      </li>
      <li>Confirm it worked: the terminal should print a line like
        <code>registered with control plane: 8 CPU cores, Linux, x86_64</code>
        (your actual hardware), then <code>polling for jobs...</code>. You can also
        check <a href="{base_url}/workers/{worker_id}">{base_url}/workers/{worker_id}</a>
        in a browser to see what hardware was detected and whether it's currently
        online (it goes offline automatically if you stop the daemon).
      </li>
      <li>That's it -- leave it running. When a researcher submits a job, your machine
        may be assigned to run it automatically. Stop providing compute any time with
        Ctrl+C in that terminal -- the daemon reports itself offline immediately.</li>
    </ol>
    """


@app.get("/workers/{worker_id}")
def get_worker(worker_id: str) -> dict:
    worker = models.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404)
    worker.pop("token", None)  # never expose the secret token over a public read
    return worker


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
