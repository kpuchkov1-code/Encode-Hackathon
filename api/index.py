"""Control-plane API: job intake, pricing, status, escrow, results, admin dashboard.

This is the Vercel-deployable piece -- Vercel's Python runtime serves this module's
`app` (a standard ASGI app) directly. It never runs gnina/Vina itself, and it never
reaches out to a worker either: idle-compute machines (worker_daemon.py) typically sit
behind NAT and can't accept inbound connections, so this is a pure pull model --
daemons poll POST /jobs/claim for work, run it themselves, and report back via
POST /jobs/{job_id}/worker-callback. The control plane never blocks on a docking run.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).
"""
import json
import math
import os
import re
import secrets
import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import deepbook_log  # noqa: E402
import models  # noqa: E402
import walrus  # noqa: E402

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


# --------------------------------------------------------------------------------------
# Shared page layout -- one real (if simple) visual design applied everywhere, instead
# of bare unstyled HTML. Still server-rendered, no JS framework: this is a stand-in for
# the real frontend (Kirill's separate workstream), not a replacement for it.
# --------------------------------------------------------------------------------------

_BASE_CSS = """
  :root {
    --accent: #2563eb; --accent-dark: #1d4ed8; --bg: #f8fafc; --card: #ffffff;
    --text: #0f172a; --muted: #64748b; --border: #e2e8f0; --ok: #16a34a; --bad: #dc2626;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); margin: 0; line-height: 1.5;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  nav { background: var(--card); border-bottom: 1px solid var(--border); padding: 14px 20px; }
  nav .wrap { display: flex; gap: 20px; align-items: center; padding: 0; max-width: 720px; }
  nav a { color: var(--text); text-decoration: none; font-size: 14px; font-weight: 500; }
  nav a:hover { color: var(--accent); }
  nav .brand { font-weight: 700; margin-right: auto; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  h2 { font-size: 17px; margin: 28px 0 10px; }
  p.lede { color: var(--muted); margin: 0 0 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 24px; margin-bottom: 16px; }
  label { display: block; font-size: 14px; font-weight: 500; margin: 14px 0 6px; }
  label .hint { color: var(--muted); font-weight: 400; }
  input[type=text], input[type=email], input[type=number], input:not([type]) {
    width: 100%; padding: 9px 11px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px;
  }
  input[type=file] { font-size: 14px; }
  button, .btn {
    background: var(--accent); color: #fff; border: none; border-radius: 6px;
    padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 18px;
    display: inline-block; text-decoration: none;
  }
  button:hover, .btn:hover { background: var(--accent-dark); }
  .btn.secondary { background: var(--card); color: var(--text); border: 1px solid var(--border); }
  code, pre { background: #f1f5f9; border-radius: 6px; font-size: 13px; }
  code { padding: 2px 6px; }
  pre { padding: 14px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.online { background: #dcfce7; color: var(--ok); }
  .badge.offline { background: #f1f5f9; color: var(--muted); }
  .badge.pending_payment { background: #f1f5f9; color: var(--muted); }
  .badge.queued { background: #e0e7ff; color: #4338ca; }
  .badge.running { background: #fef3c7; color: #b45309; }
  .badge.docked { background: #dbeafe; color: #1d4ed8; }
  .badge.verifying { background: #ede9fe; color: #6d28d9; }
  .badge.proven, .badge.settled { background: #dcfce7; color: var(--ok); }
  .badge.disputed, .badge.failed { background: #fee2e2; color: var(--bad); }
  .badge.kind { background: #f1f5f9; color: var(--muted); font-size: 11px; }
  td.mono, code.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: var(--muted); }
  .price { font-size: 32px; font-weight: 700; color: var(--accent); margin: 8px 0; }
  .stat { display: inline-block; margin-right: 28px; }
  .stat .n { font-size: 22px; font-weight: 700; display: block; }
  .stat .l { font-size: 12px; color: var(--muted); }
  .warn { background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 12px 14px; font-size: 14px; }
  .ok { color: var(--ok); }
  .progress { background: #f1f5f9; border-radius: 999px; height: 16px; overflow: hidden; margin: 10px 0 6px; }
  .progress > div { background: var(--accent); height: 100%; width: 0; transition: width .4s ease; }
  .progress-label { font-size: 13px; color: var(--muted); }
  .row-actions a { margin-right: 12px; font-size: 13px; }
"""

_NAV = """
<nav><div class="wrap">
  <a class="brand" href="/">Docking Marketplace</a>
  <a href="/researchers/submit">Submit a job</a>
  <a href="/researchers/jobs">My jobs</a>
  <a href="/providers/signup">Provide compute</a>
</div></nav>
"""


def page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>{_BASE_CSS}</style></head>
<body>{_NAV}<div class="wrap">{body}</div></body></html>"""


# --------------------------------------------------------------------------------------
# Pricing -- ligand count x exhaustiveness. No RDKit here (the control plane stays
# dependency-light by design, see SESSION_HANDOFF.md); ligand count is a cheap,
# dependency-free heuristic (every molecule in a standard SDF ends with a "$$$$" line).
# --------------------------------------------------------------------------------------

# Fixed, low, per-ligand price -- one flat rate per ligand docked, independent of
# exhaustiveness. Deliberately simple and cheap: a researcher can read the price off the
# ligand count alone, with no surprises. (A future version could let providers quote their
# own per-unit price for researchers to accept/decline; for now it's a fixed platform rate.)
# DeepBook is no longer in the pricing path -- it's used purely to log settled jobs on-chain
# (see deepbook_log.py); standing up a live price oracle needs a funded pool, which is out
# of scope for now.
PRICE_PER_LIGAND = float(os.environ.get("PRICE_PER_LIGAND", "0.0001"))
BASELINE_EXHAUSTIVENESS = 8  # retained for the engine params, not used in pricing anymore
MIN_PRICE = float(os.environ.get("MIN_PRICE", "0.0001"))

# --- Execution verification (optimistic, sampled re-execution) ------------------------
# A fraction of a completed job's ligands are re-docked by an *independent* worker with
# the same fixed seed; if every sampled binding affinity matches the original within
# VERIFY_TOLERANCE_KCAL, the job is proven and escrow releases -- otherwise it's disputed
# and refunded. Vina is deterministic for a fixed seed on the same engine image, so a
# tolerance this tight still leaves headroom for cross-machine float noise. Set
# VERIFY_SAMPLE_FRACTION=0 to turn verification off (jobs then settle on first result).
VERIFY_SAMPLE_FRACTION = float(os.environ.get("VERIFY_SAMPLE_FRACTION", "0.1"))
VERIFY_TOLERANCE_KCAL = float(os.environ.get("VERIFY_TOLERANCE_KCAL", "1.0"))

# A primary docking result exists (and is downloadable) from `docked` onward, through
# verification and settlement -- `disputed` included, so a researcher can still inspect a
# result that failed verification (they were refunded, but the data is theirs to see).
RESULT_READY_STATES = {"docked", "verifying", "proven", "settled", "disputed"}


def count_ligands(ligands_sdf: str) -> int:
    count = ligands_sdf.count("$$$$")
    return max(count, 1)  # a single molecule with no trailing delimiter still counts as 1


def _split_sdf_blocks(ligands_sdf: str) -> list[str]:
    """Split a multi-molecule SDF into individual molecule blocks by the `$$$$`
    delimiter -- plain text, no RDKit (the control plane stays dependency-light). Each
    returned block keeps its own trailing `$$$$\\n` so it's a valid standalone SDF."""
    blocks = []
    current = []
    for line in ligands_sdf.splitlines(keepends=True):
        current.append(line)
        if line.startswith("$$$$"):
            blocks.append("".join(current))
            current = []
    tail = "".join(current).strip()
    if tail:  # a final molecule with no trailing delimiter
        blocks.append("".join(current) if "".join(current).endswith("\n") else "".join(current) + "\n")
    return blocks


def sample_ligands_for_verification(ligands_sdf: str, fraction: float, seed_text: str) -> str:
    """Pick a deterministic-but-provider-unpredictable subset of molecule blocks to
    re-dock for verification. Deterministic (so it's reproducible and auditable) yet
    derived from a hash of the job id (so a provider can't know in advance which ligands
    will be checked and cut corners on the rest). Returns a standalone multi-molecule
    SDF of the sampled blocks."""
    import hashlib

    blocks = _split_sdf_blocks(ligands_sdf)
    n = len(blocks)
    if n == 0:
        return ligands_sdf
    k = max(1, math.ceil(fraction * n))
    # Rank blocks by H(seed_text || index); take the k smallest -- a stable pseudo-random
    # sample with no PRNG state to thread through.
    ranked = sorted(
        range(n),
        key=lambda i: hashlib.sha256(f"{seed_text}:{i}".encode()).hexdigest(),
    )
    chosen = sorted(ranked[:k])
    return "".join(blocks[i] for i in chosen)


def estimate_price(num_ligands: int, exhaustiveness: int = 0) -> float:
    """Fixed price: a flat per-ligand rate times the ligand count. exhaustiveness is
    accepted for signature compatibility but no longer affects the price."""
    return round(max(PRICE_PER_LIGAND * num_ligands, MIN_PRICE), 6)


def default_box_from_receptor(pdb_text: str) -> dict:
    """Whole-protein bounding box, computed from raw ATOM coordinates with plain
    string slicing -- no RDKit dependency (the control plane stays lightweight by
    design). Used when the researcher gives neither a reference ligand nor an explicit
    center/size: previously this case crashed (float("") on empty form fields) instead
    of falling back to something that actually runs. Docking against the whole protein
    surface is far less targeted than a real binding-pocket box, so this is clearly a
    fallback, not a substitute for providing a reference ligand."""
    xs, ys, zs = [], [], []
    for line in pdb_text.splitlines():
        if line.startswith("ATOM"):
            try:
                xs.append(float(line[30:38]))
                ys.append(float(line[38:46]))
                zs.append(float(line[46:54]))
            except ValueError:
                continue
    if not xs:
        raise ValueError("could not find any ATOM coordinates in the uploaded PDB file")
    center = [(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2]
    size = [max(max(xs) - min(xs), 20.0), max(max(ys) - min(ys), 20.0), max(max(zs) - min(zs), 20.0)]
    return {"center": center, "size": size}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return page("Docking Marketplace", """
    <h1>Decentralized molecular docking marketplace</h1>
    <p class="lede">Submit a docking job and pay only for the compute it uses, or put
    your idle hardware to work running other people's jobs.</p>
    <div class="card">
      <h2>Researchers</h2>
      <p>Submit a protein (PDB) and a screening library (SDF) and get a docking job
      run on someone else's idle hardware. You'll see a price before anything runs.</p>
      <a class="btn" href="/researchers/submit">Submit a job</a>
    </div>
    <div class="card">
      <h2>Hardware providers</h2>
      <p>Sign up, run one script, and get paid when your machine docks a job.</p>
      <a class="btn secondary" href="/providers/signup">Provide compute</a>
    </div>
    """)


@app.get("/worker-package.zip")
def worker_package_local_dev_fallback() -> FileResponse:
    """In production, Vercel serves public/** as a static asset directly -- this
    route never actually runs there (see https://vercel.com/docs/frameworks/backend/fastapi,
    "app.mount is not needed and should not be used"). It exists purely so
    `python api/index.py` behaves the same way for local testing."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "worker-package.zip")
    return FileResponse(path, media_type="application/zip", filename="worker-package.zip")


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
    supplier_id: str = "any"  # no `amount` here -- price is always server-computed,
    # never trusted from the client (see estimate_price); see Task in SESSION_HANDOFF.md


class JobSpec(BaseModel):
    receptor: ReceptorSpec
    ligands_sdf: str = Field(min_length=1)
    box: BoxSpec
    params: ParamsSpec
    payment: PaymentSpec
    researcher_id: str
    # Display-only: the original PDB id when the receptor was given by id but resolved to
    # inline `file` text at submit (so the sealed engine container never needs network /
    # `requests`). Lets the job page still label the structure with its PDB id. Ignored by
    # the engine.
    receptor_pdb_id: Optional[str] = None


@app.post("/jobs/estimate")
def estimate_job(job_spec: JobSpec) -> dict:
    """Dry-run pricing -- no job is created. Needed by the frontend (Kirill's
    workstream) to show a price before the researcher commits to anything."""
    num_ligands = count_ligands(job_spec.ligands_sdf)
    price = estimate_price(num_ligands)
    return {
        "price": price,
        "num_ligands": num_ligands,
        "pricing": {"source": "fixed", "rate_per_ligand": PRICE_PER_LIGAND},
    }


def _submit_internal(job_spec: JobSpec) -> dict:
    """Creates a job in `pending_payment` -- it is NOT queued for execution until
    POST /jobs/{id}/confirm is called. Price is always computed here, server-side,
    never taken from the client. Used by the server-rendered form AND (via translation)
    the SPA's POST /jobs below."""
    if models.get_researcher(job_spec.researcher_id) is None:
        raise HTTPException(status_code=400, detail="unknown researcher_id -- sign up at /researchers/signup first")
    spec_dict = job_spec.model_dump()
    num_ligands = count_ligands(job_spec.ligands_sdf)
    price = estimate_price(num_ligands, job_spec.params.exhaustiveness)
    return models.create_job(spec_dict, price=price, researcher_id=job_spec.researcher_id)


# ---- SPA-facing POST /jobs (API_CONTRACT.md JobSpec) -----------------------------------
# The frontend posts the contract shape: ligands as an array, an optional researcher
# identifier (its connected wallet address or email), and payment carrying an `amount` the
# server ignores (price is always computed here). We translate that into the internal
# JobSpec and reuse _submit_internal so there's one job-creation code path.

class FeLigand(BaseModel):
    id: str
    smiles: Optional[str] = None
    sdf: Optional[str] = None


class FePayment(BaseModel):
    amount: Optional[float] = None  # ignored -- price is server-computed
    supplier_id: str = "any"


class FeJobSpec(BaseModel):
    receptor: ReceptorSpec
    ligands: list[FeLigand] = Field(min_length=1)
    box: BoxSpec
    params: ParamsSpec
    payment: FePayment = FePayment()
    # When the frontend sends the structure as inline `file` (so the engine never fetches),
    # it passes the original PDB id here for the job page's display label. Optional.
    receptor_pdb_id: Optional[str] = None
    # Researcher identity for "my jobs" grouping. In the on-chain product this is the
    # researcher's wallet address; email also works. Optional -- falls back to a shared
    # anonymous identity so a wallet-only user can still submit.
    researcher: Optional[str] = None


ANON_RESEARCHER_EMAIL = "anonymous@dockmarket.local"


def _ligands_to_sdf(ligands: list[FeLigand]) -> str:
    """Concatenate per-ligand SDF into the single multi-molecule SDF the engine splits on
    `$$$$`. The control plane is dependency-light (no RDKit), so it can't embed 3D from a
    SMILES string -- ligands must carry `sdf`. A SMILES-only ligand is a clear 400."""
    blocks = []
    for lig in ligands:
        if not lig.sdf:
            raise HTTPException(
                status_code=400,
                detail=f"ligand '{lig.id}' has no sdf -- the backend needs 3D SDF, not SMILES alone",
            )
        block = lig.sdf if lig.sdf.rstrip().endswith("$$$$") else lig.sdf.rstrip() + "\n$$$$\n"
        blocks.append(block)
    return "".join(blocks)


def _receptor_text(receptor: ReceptorSpec) -> Optional[str]:
    """Raw PDB text for a receptor — the uploaded file, or fetched from RCSB by id."""
    try:
        if receptor.file:
            return receptor.file
        if receptor.pdb_id:
            import requests

            r = requests.get(
                f"https://files.rcsb.org/download/{receptor.pdb_id}.pdb", timeout=20
            )
            r.raise_for_status()
            return r.text
    except Exception:  # noqa: BLE001 -- box resolution must never block submission
        return None
    return None


def _resolve_box(box: BoxSpec, receptor: ReceptorSpec, receptor_text: Optional[str] = None) -> BoxSpec:
    """Make the docking box valid for THIS receptor. An explicit center/size or a genuine
    reference-ligand SDF is targeted docking and kept as-is. Anything else — notably the
    frontend's `autobox_ligand: "ref_ligand"` placeholder used when the researcher hasn't
    picked a pocket — is meaningless for an arbitrary protein and makes the engine error on
    a garbage box. In that case we fall back to a whole-protein box derived from the actual
    receptor, so any PDB docks (blind, less targeted) instead of failing."""
    if box.center is not None and box.size is not None:
        return box
    autobox = box.autobox_ligand or ""
    if "V2000" in autobox or "V3000" in autobox:  # a real SDF molfile -> keep
        return box
    text = receptor_text or _receptor_text(receptor)
    if not text:
        return box
    try:
        return BoxSpec(**default_box_from_receptor(text))
    except Exception:  # noqa: BLE001 -- if we can't, leave it and let the engine report
        return box


@app.post("/jobs", status_code=202)
def submit_job(spec: FeJobSpec) -> dict:
    """SPA job submission (API_CONTRACT.md). Returns `{job_id, state, price}` -- state is
    `pending_payment`; the SPA then drives confirm -> wallet lock -> escrow-locked to queue
    it (or, off-chain, confirm queues directly)."""
    researcher = models.get_researcher_by_email(spec.researcher or "") or None
    if researcher is None:
        researcher = models.create_researcher_identity(spec.researcher or ANON_RESEARCHER_EMAIL)
    # Prefer inline PDB text so the sealed engine container never needs network/`requests`
    # (it failed with "No module named 'requests'" on the pdb_id fetch path). The frontend
    # sends the already-loaded structure as `file` (+ `receptor_pdb_id` for display); an API
    # caller that sends only `pdb_id` is resolved here as a fallback.
    engine_receptor = spec.receptor
    receptor_pdb_id = spec.receptor_pdb_id
    if spec.receptor.pdb_id:
        text = _receptor_text(spec.receptor)
        if text:
            engine_receptor = ReceptorSpec(file=text)
            receptor_pdb_id = receptor_pdb_id or spec.receptor.pdb_id
    internal = JobSpec(
        receptor=engine_receptor,
        ligands_sdf=_ligands_to_sdf(spec.ligands),
        box=_resolve_box(spec.box, engine_receptor),
        params=spec.params,
        payment=PaymentSpec(supplier_id=spec.payment.supplier_id),
        researcher_id=researcher["researcher_id"],
        receptor_pdb_id=receptor_pdb_id,
    )
    return _submit_internal(internal)


@app.post("/jobs/{job_id}/confirm")
def confirm_job(job_id: str) -> dict:
    """Researcher has seen the price and agreed. On-chain, this returns a `payment` intent
    (price in MIST + Move package + arbiter) so the researcher's own wallet can lock the
    funds; the job is queued only after POST /jobs/{id}/escrow-locked verifies that lock.
    Off-chain (mock), it queues immediately."""
    record = models.confirm_job(job_id)
    if record is None:
        raise HTTPException(status_code=409, detail="job not found or not awaiting payment")
    out = {"job_id": job_id, "state": record["state"]}
    if record.get("payment"):
        out["payment"] = record["payment"]
    return out


@app.get("/chain/info")
def chain_info() -> dict:
    """Public on-chain config for the frontend wallet flow: which Move escrow package to
    call and which address must be named as arbiter. `onchain: false` when running in
    off-chain mock mode (no wallet step)."""
    info = models.chain_info()
    if info is None:
        return {"onchain": False}
    return {"onchain": True, **info}


@app.get("/jobs/{job_id}/payment-intent")
def payment_intent(job_id: str) -> dict:
    """What the researcher's browser wallet needs to lock the right amount for this job."""
    intent = models.payment_intent(job_id)
    if intent is None:
        raise HTTPException(status_code=404)
    return intent


class EscrowLocked(BaseModel):
    escrow_object_id: str


@app.post("/jobs/{job_id}/escrow-locked")
def escrow_locked(job_id: str, body: EscrowLocked) -> dict:
    """Called by the researcher's browser right after their wallet locks the escrow.
    The backend reads the escrow straight from chain and verifies it locks THIS job, names
    this platform as arbiter, and holds at least the price -- only then is the job queued.
    The platform never trusts the caller's word; it trusts the chain."""
    try:
        record = models.record_escrow_lock(job_id, body.escrow_object_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"job_id": job_id, "state": record["state"]}


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
    # Opportunistic recovery: a daemon polling for work is the natural moment to sweep up
    # jobs abandoned by some other daemon that died mid-run, since the serverless control
    # plane has no background process of its own to do it. Requeued jobs become claimable
    # right here in the same poll cycle.
    models.reclaim_stale_jobs()
    job = models.claim_next_job(claim.worker_id)
    if job is None:
        return {"job": None}
    return {"job": {"job_id": job["job_id"], "job_spec": job["spec"]}}


# ---------------------------------------------------------------------------------------
# Frontend (SPA) compatibility API
# ---------------------------------------------------------------------------------------
# The Next.js frontend in web/ codes to API_CONTRACT.md, which models a simpler 6-state
# lifecycle than the real backend (which adds pending_payment / verifying / disputed for
# the on-chain escrow + independent-verification machinery). These helpers + endpoints
# present the real job/escrow/result/proof data in exactly the shapes the SPA expects, so
# the frontend's proxy (web/app/api/[...path]/route.ts -> BACKEND_BASE_URL) can talk to
# this backend unchanged. Internal consumers (the worker daemon, the server-rendered HTML
# pages) read models.* directly and are unaffected by these projections.

# Map the real internal state to the contract's lifecycle. `verifying` still has results
# available (the primary dock finished), so it presents as `docked`; `disputed` is a
# verification failure that refunds, so it presents as `failed`. `pending_payment` is
# passed through -- the SPA's submit flow handles it explicitly (wallet lock step).
_FE_STATE_MAP = {
    "pending_payment": "pending_payment",
    "queued": "queued",
    "running": "running",
    "docked": "docked",
    "verifying": "docked",
    "proven": "proven",
    "settled": "settled",
    "disputed": "failed",
    "failed": "failed",
}


def _fe_state(state: str) -> str:
    return _FE_STATE_MAP.get(state, state)


@app.get("/jobs")
def list_jobs() -> dict:
    """List endpoint the SPA's provider dashboard polls to compute the job feed + earnings.
    Returns only primary jobs (internal verification re-runs are an implementation detail)
    newest first, in the contract's {jobs:[{job_id, state, created_at}]} shape."""
    jobs = [j for j in models.list_all_jobs() if j.get("kind", "primary") != "verification"]
    jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)
    return {
        "jobs": [
            {
                "job_id": j["job_id"],
                "state": _fe_state(j["state"]),
                "created_at": j.get("created_at") or "",
                "price": j.get("price"),
                "supplier_id": (j.get("spec", {}).get("payment", {}) or {}).get("supplier_id", "any"),
            }
            for j in jobs
        ]
    }


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    return {
        "job_id": job["job_id"],
        "state": _fe_state(job["state"]),
        "reason": job["reason"],
        "price": job.get("price"),
    }


@app.get("/jobs/{job_id}/escrow")
def get_escrow(job_id: str) -> dict:
    if models.get_job(job_id) is None:
        raise HTTPException(status_code=404)
    record = models.escrow_status(job_id)
    if record is None:
        raise HTTPException(status_code=404)
    return record


@app.get("/jobs/{job_id}/receptor")
def get_receptor(job_id: str) -> dict:
    """The ACTUAL receptor a job was submitted with, so any page can render the real
    structure instead of a hardcoded/default one. Returns the uploaded PDB text verbatim
    when the researcher uploaded a file, otherwise the PDB id (the client fetches that from
    RCSB). No default — a job with neither yields an empty result."""
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    spec = job.get("spec") or {}
    receptor = spec.get("receptor") or {}
    if receptor.get("file"):
        # Inline PDB text. If it was resolved from a pdb_id at submit, show that id;
        # otherwise it's a user upload.
        label = spec.get("receptor_pdb_id") or "uploaded"
        return {"kind": "file", "pdb": receptor["file"], "pdb_id": spec.get("receptor_pdb_id") or "", "label": label}
    pdb_id = receptor.get("pdb_id") or ""
    return {"kind": "pdb_id", "pdb_id": pdb_id, "label": pdb_id}


@app.get("/jobs/{job_id}/result")
def get_result(job_id: str) -> dict:
    """Docking results in the SPA contract's DockResult shape. The Vina engine produces a
    `vina_affinity` (kcal/mol, more negative = better) and a docked pose, but no gnina CNN
    scores -- those fields are surfaced as null so the frontend can show a dash rather than
    a fake number. Ranked best-first by vina_affinity. Errored ligands are omitted from the
    ranked list (the per-ligand error is still in the raw record / download zip)."""
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job["state"] not in RESULT_READY_STATES:
        raise HTTPException(status_code=409, detail=f"result not ready (state={job['state']})")
    rows = [r for r in (job.get("result") or []) if "error" not in r]
    rows.sort(key=lambda r: r.get("vina_affinity", 0.0))  # more negative kcal/mol = better
    return {
        "job_id": job_id,
        "ligands": [
            {
                "ligand_id": r["ligand_id"],
                "cnn_score": None,
                "cnn_affinity": None,
                "vina_affinity": r.get("vina_affinity"),
                "pose_path": f"poses/{r['ligand_id']}.pdbqt",
            }
            for r in rows
        ],
    }


@app.get("/jobs/{job_id}/proof")
def get_proof(job_id: str) -> dict:
    """Proof-of-execution in the SPA contract's Proof shape. Built from the SAME canonical
    hashes the platform anchors to Walrus (walrus.build_manifest), so the manifest hash the
    UI shows is the real tamper-evidence token -- not a decorative one. Available once the
    job is proven/settled."""
    import hashlib

    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job["state"] not in ("proven", "settled"):
        raise HTTPException(status_code=409, detail=f"proof not ready (state={job['state']})")

    spec = job.get("spec", {})
    params = spec.get("params", {}) or {}
    results = [r for r in (job.get("result") or []) if "error" not in r]
    seed = params.get("seed", 0)
    manifest = walrus.build_manifest(job_id, seed, "vina", results)  # positional result hashes
    ligand_sha256s = {
        r["ligand_id"]: manifest["ligands"][i]["result_sha256"]
        for i, r in enumerate(results)
        if i < len(manifest.get("ligands", []))
    }
    pose_sha256s = {
        r["ligand_id"]: hashlib.sha256((r.get("pose_pdbqt") or "").encode("utf-8")).hexdigest()
        for r in results
        if r.get("pose_pdbqt")
    }
    receptor_text = (spec.get("receptor", {}) or {}).get("file") or (spec.get("receptor", {}) or {}).get("pdb_id", "")
    walrus_rec = job.get("walrus") or {}
    return {
        "manifest_sha256": manifest.get("bundle_sha256", ""),
        "receptor_sha256": hashlib.sha256(receptor_text.encode("utf-8")).hexdigest(),
        "ligand_sha256s": ligand_sha256s,
        "pose_sha256s": pose_sha256s,
        "params": {
            "exhaustiveness": params.get("exhaustiveness"),
            "num_modes": params.get("num_modes"),
            "cnn": params.get("cnn") or "none",
            "seed": seed,
        },
        "gnina_version": "AutoDock Vina 1.2.5",
        "timestamp": job.get("started_at") or job.get("created_at") or "",
        "worker_id": job.get("claimed_by") or "",
        "storage_blob_id": walrus_rec.get("blob_id") or "",
    }


class RunRequest(BaseModel):
    supplier_id: str = "any"


@app.post("/jobs/{job_id}/run", status_code=202)
def run_job(job_id: str, body: RunRequest) -> dict:
    """Supply-side 'Run' action from the SPA provider dashboard: attribute a queued job to
    a supplier so its escrow/earnings reflect the claim. NOTE: real docking is performed by
    the pull-based worker daemon (POST /jobs/claim), not triggered here -- this endpoint
    records the supplier attribution and reports the job as running; the daemon does the
    actual compute. Returns 409 if the job isn't claimable."""
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["state"] != "queued":
        raise HTTPException(status_code=409, detail=f"job not claimable (state={job['state']})")
    worker_id = body.supplier_id or "any"
    # Record the supplier attribution; the pull-based daemon performs the actual dock and
    # will flip the state to running on its next claim. We report the real current state so
    # the UI reflects truth (it advances to running once a daemon picks the job up).
    models.update_job_extra(job_id, supplier_id=worker_id)
    return {"job_id": job_id, "state": _fe_state(job["state"]), "worker_id": worker_id}


class ResearcherSignup(BaseModel):
    email: str


@app.post("/researchers", status_code=201)
def create_researcher(body: ResearcherSignup) -> dict:
    """SPA researcher sign-up/sign-in (JSON form of /researchers/signup). The email is the
    identity; signing in again with the same email returns the same account. Idempotent."""
    email = (body.email or "").strip()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="A valid email is required.")
    identity = models.create_researcher_identity(email)
    return {
        "researcher_id": identity["researcher_id"],
        "email": identity.get("email", email),
    }


class ProviderSignup(BaseModel):
    email: str
    sui_address: str


@app.post("/providers", status_code=201)
def create_provider(body: ProviderSignup, request: Request) -> dict:
    """SPA provider registration (JSON form of /providers/signup). Issues a worker identity
    (idempotent by email) and returns the one-liner the provider runs on their machine to
    start the daemon -- the SPA shows the command + package link. The token is returned once."""
    sui = body.sui_address.strip()
    if not _valid_sui_address(sui):
        raise HTTPException(status_code=400, detail="A valid Sui payout address (0x + 64 hex chars) is required.")
    identity = models.create_worker_identity(sui_address=sui, email=body.email)
    base = str(request.base_url).rstrip("/")
    return {
        "worker_id": identity["worker_id"],
        "token": identity["token"],
        "email": identity.get("email", "") or _norm_email(body.email),
        "sui_address": identity.get("sui_address", sui),
        "control_plane_url": base,
        "package_url": f"{base}/worker-package.zip",
        "run_command": (
            f"CONTROL_PLANE_URL={base} WORKER_ID={identity['worker_id']} "
            f"WORKER_TOKEN={identity['token']} ./install_worker.sh"
        ),
    }


@app.get("/researchers/{key}/jobs")
def researcher_jobs_json(key: str) -> dict:
    """The buyer's 'My jobs' list for the SPA, resolved from their wallet address (or email)
    -- the same key passed as `researcher` at submit. Newest first, in FE-friendly shape."""
    researcher = models.get_researcher_by_email(key)
    if researcher is None:
        return {"researcher": key, "jobs": []}
    jobs = models.list_researcher_jobs(researcher["researcher_id"])
    return {
        "researcher": key,
        "jobs": [
            {
                "job_id": j["job_id"],
                "state": _fe_state(j["state"]),
                "price": j.get("price"),
                "num_ligands": _job_total_ligands(j),
                "created_at": j.get("created_at") or "",
            }
            for j in jobs
        ],
    }


@app.get("/providers/{worker_id}/json")
def provider_json(worker_id: str) -> dict:
    """Real worker record for the SPA provider dashboard (status, hardware, jobs, earnings).
    Mirrors /workers/{id}/json but namespaced for the provider UI."""
    worker = models.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404)
    worker.pop("token", None)
    jobs = models.list_worker_jobs(worker_id)
    worker["jobs"] = [
        {
            "job_id": j["job_id"],
            "state": _fe_state(j["state"]),
            "price": j.get("price"),
            "kind": j.get("kind", "primary"),
            "created_at": j.get("created_at") or "",
        }
        for j in jobs
    ]
    return worker


@app.get("/jobs/{job_id}/download")
def download_result(job_id: str) -> Response:
    """Zips the actual docked pose files (sent back inline in the worker callback,
    since the worker's own job_dir is deleted right after the job ends -- nothing to
    fetch from the worker's machine after the fact) plus a results.json summary, so
    the researcher gets a real downloadable file, not just numbers in a browser tab."""
    import io
    import json
    import zipfile

    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job["state"] not in RESULT_READY_STATES:
        raise HTTPException(status_code=409, detail=f"job is in state {job['state']}, not yet docked")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("results.json", json.dumps(job["result"], indent=2))
        for entry in job["result"]:
            if "pose_pdbqt" in entry:
                zf.writestr(f"{entry['ligand_id']}_pose.pdbqt", entry["pose_pdbqt"])
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=job-{job_id[:8]}-results.zip"},
    )


# A job is still "live" (worth auto-refreshing the page for) until it reaches one of
# these final resting states.
TERMINAL_STATES = {"settled", "disputed", "failed"}


def _job_total_ligands(job: dict) -> int:
    p = job.get("progress") or {}
    if p.get("total"):
        return int(p["total"])
    return count_ligands(job.get("spec", {}).get("ligands_sdf", ""))


def _job_done_ligands(job: dict) -> int:
    """How many ligands are finished, for a progress bar. Once a result exists the job is
    fully docked, so report total; otherwise use the live per-ligand progress ping."""
    total = _job_total_ligands(job)
    if job.get("result") is not None or job["state"] in (
            "docked", "verifying", "proven", "settled"):
        return total
    return int((job.get("progress") or {}).get("done", 0))


def _progress_html(job: dict) -> str:
    """A live progress bar for multi-ligand jobs that are queued/running. Single-ligand
    jobs (or terminal ones) get nothing -- a bar there is just noise."""
    state = job["state"]
    total = _job_total_ligands(job)
    if total <= 1 or state in ("pending_payment", "failed", "disputed", "settled", "proven"):
        return ""
    done = _job_done_ligands(job)
    pct = int(round(100 * done / total)) if total else 0
    if state == "queued":
        label = "Queued — waiting for a provider to pick this up…"
        pct = 0
    elif state == "running" and done == 0:
        label = f"Running on a provider's hardware — preparing {total} ligands…"
    elif state == "running":
        label = f"Docking… {done} / {total} ligands ({pct}%)"
    else:  # docked / verifying
        label = f"Docked all {total} ligands"
    return f"""<div class="card">
      <div class="progress"><div style="width:{pct}%"></div></div>
      <p class="progress-label">{label}</p>
    </div>"""


@app.get("/jobs/{job_id}/page", response_class=HTMLResponse)
def get_job_page(job_id: str) -> str:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    state = job["state"]
    # Auto-refresh while the job is still moving, so the researcher watches it progress
    # without manually reloading. Stops once it reaches a terminal state.
    refresh = '<meta http-equiv="refresh" content="5">' if state not in TERMINAL_STATES else ""
    nlig = _job_total_ligands(job)

    body = f"""
    <h1>Job {job_id[:8]} {_state_badge(state)}</h1>
    <div class="card">
      <p><strong>Status:</strong> {state}</p>
      <p><strong>Ligands:</strong> {nlig}</p>
      <p><strong>Price:</strong> ${job.get('price', '?')}</p>
    """
    if state == "pending_payment":
        body += f'<p class="row-actions"><a class="btn" href="/jobs/{job_id}/pay">Pay &amp; submit</a></p>'
    if state in ("failed", "disputed"):
        body += f"<p><strong>Reason:</strong> {job.get('reason', '')}</p>"
    body += "</div>"

    body += _progress_html(job)

    if state in RESULT_READY_STATES and job.get("result"):
        ok = [r for r in job["result"] if "vina_affinity" in r]
        failed = [r for r in job["result"] if "vina_affinity" not in r]
        rows = "".join(
            f"<tr><td class='mono'>{r['ligand_id']}</td>"
            f"<td>{r.get('vina_affinity', r.get('error', ''))}</td></tr>"
            for r in job["result"]
        )
        summary = f"{len(ok)} docked"
        if failed:
            summary += f" · {len(failed)} failed"
        best = min((r["vina_affinity"] for r in ok), default=None)
        best_html = f" · best affinity <strong>{best} kcal/mol</strong>" if best is not None else ""
        body += f"""<div class="card">
          <p class="lede">{summary}{best_html} (more negative = stronger predicted binding)</p>
          <table><tr><th>Ligand</th><th>Affinity (kcal/mol) / error</th></tr>{rows}</table>
          <a class="btn" href="/jobs/{job_id}/download">Download results (.zip)</a>
        </div>"""

    body += _verification_html(job)
    body += _walrus_html(job)
    body += _escrow_chain_html(job_id)
    return page(f"Job {job_id[:8]}", refresh + body)


def _verification_html(job: dict) -> str:
    """Render the independent-re-execution verification outcome, when present."""
    v = job.get("verification")
    if not v:
        return ""
    status = v.get("status", "?")
    label = {
        "pending": "Independent re-execution in progress…",
        "passed": "Verified — an independent re-run reproduced the result",
        "failed": "Disputed — an independent re-run did NOT reproduce the result",
        "inconclusive": "Inconclusive — could not be independently verified",
        "skipped": "Not independently verified",
    }.get(status, status)
    rows = [f"<p><strong>Verification:</strong> {label}</p>"]
    if v.get("checked_ligands") is not None:
        rows.append(f"<p>Re-docked {v['checked_ligands']} sampled ligand(s); max affinity "
                    f"deviation {v.get('max_deviation_kcal')} kcal/mol "
                    f"(tolerance {v.get('tolerance_kcal')}).</p>")
    if v.get("reason"):
        rows.append(f'<p class="lede">{v["reason"]}</p>')
    return '<div class="card">' + "".join(rows) + "</div>"


def _walrus_html(job: dict) -> str:
    """Render the Walrus tamper-evidence anchor (blob id + bundle hash) as a public link."""
    w = job.get("walrus")
    if not w:
        return ""
    return f"""<div class="card">
      <p><strong>Result anchored on Walrus (tamper-evident, public):</strong></p>
      <p>Bundle SHA-256: <code>{w.get('bundle_sha256', '')[:24]}…</code></p>
      <p>Blob: <a href="{w.get('aggregator_url', '#')}">{w.get('blob_id', '')[:24]}…</a></p>
    </div>"""


def _suiscan(kind: str, ident: str) -> str:
    """Public Suiscan testnet explorer link -- lets anyone independently verify the
    escrow movement on-chain. kind is 'tx' or 'object'."""
    return f"https://suiscan.xyz/testnet/{kind}/{ident}"


def _escrow_chain_html(job_id: str) -> str:
    """Render the on-chain escrow trail (lock/release/refund tx digests + escrow object)
    as Suiscan links, when the job's escrow was settled on Sui. Renders nothing for
    mock (off-chain) escrow so unconfigured deploys look unchanged."""
    escrow = models.escrow_status(job_id)
    chain = (escrow or {}).get("chain")
    rows = []
    if chain:
        sui = f"{chain.get('amount_mist', 0) / 1_000_000_000:.4f} SUI"
        rows.append(f"<p><strong>Escrow on Sui testnet:</strong> {sui}</p>")
        if chain.get("payer"):
            rows.append(f'<p>Locked by researcher (their own wallet): <a href="{_suiscan("account", chain["payer"])}">{chain["payer"][:18]}…</a></p>')
        if chain.get("lock_digest"):
            rows.append(f'<p>Lock tx: <a href="{_suiscan("tx", chain["lock_digest"])}">{chain["lock_digest"][:18]}…</a></p>')
        if chain.get("escrow_object_id"):
            rows.append(f'<p>Escrow object: <a href="{_suiscan("object", chain["escrow_object_id"])}">{chain["escrow_object_id"][:18]}…</a></p>')
        for label, key in (("Release", "release_digest"), ("Refund", "refund_digest")):
            if chain.get(key):
                rows.append(f'<p>{label} tx: <a href="{_suiscan("tx", chain[key])}">{chain[key][:18]}…</a></p>')
        if chain.get("paid_to"):
            rows.append(f'<p>Paid to provider: <a href="{_suiscan("object", chain["paid_to"])}">{chain["paid_to"][:18]}…</a></p>')
    # DeepBook settlement log: the marketplace transaction recorded on Sui's on-chain order
    # book (an opaque compute-unit count only). Independent of the escrow trail above.
    deepbook = (models.get_job(job_id) or {}).get("deepbook")
    if deepbook and deepbook.get("digest"):
        rows.append(
            f'<p><strong>DeepBook log:</strong> settled '
            f'{deepbook.get("compute_units", "?")} compute unit(s) recorded on the '
            f'<a href="{_suiscan("object", deepbook.get("pool_id", ""))}">{deepbook.get("pool", "DEEP/SUI")}</a> '
            f'order book &mdash; <a href="{_suiscan("tx", deepbook["digest"])}">{deepbook["digest"][:18]}…</a></p>'
        )
    if not rows:
        return ""
    return '<div class="card">' + "".join(rows) + "</div>"


class WorkerCallback(BaseModel):
    result: Optional[list[dict]] = None
    error: Optional[str] = None


@app.post("/jobs/{job_id}/worker-callback")
def worker_callback(job_id: str, callback: WorkerCallback) -> dict:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)

    # A zombie worker -- one that was declared dead, had its job reclaimed/requeued or
    # failed, then came back to life and finished -- must not be able to clobber a job
    # that's since moved on. Only a job still genuinely `running` accepts a callback.
    if job["state"] != "running":
        return {"ok": True, "ignored": f"job already in state {job['state']}"}

    models.finish_running(job_id)  # reached a terminal state -- reclaim sweep can ignore it

    if job.get("kind") == "verification":
        return _handle_verification_callback(job, callback)

    if callback.error is not None:
        models.update_job(job_id, state="failed", reason=callback.error)
        models.escrow_refund(job_id)
        return {"ok": True}

    # Primary docking finished: results are in. Mark `docked` and STOP. The Walrus proof
    # and the escrow release are executed by a separate, retriable layer
    # (POST /jobs/{id}/finalize) -- so the slow proof step can't blow this function's time
    # budget, and, per product rule, the provider is paid ONLY after the proof is anchored.
    models.update_job(job_id, state="docked", result=callback.result)
    return {"ok": True, "state": "docked"}


@app.post("/jobs/{job_id}/finalize")
def finalize_job(job_id: str) -> dict:
    """Proof-then-pay layer. Idempotent and retriable; each call does at most ONE bounded
    step, so it always fits the serverless time budget. Driven by the provider worker and/or
    the job page poll until the job reaches a terminal state:

      docked  -> EXECUTE THE PROOF: anchor the hashes-only manifest on Walrus. Once anchored,
                 either kick off independent verification (`verifying`) or mark `proven`.
                 If Walrus is enabled but the anchor hasn't landed, stay `docked` so the
                 caller retries -- the job never advances (or pays) without its proof.
      proven  -> release escrow to the provider (PAYMENT) and mark `settled`.

    Payment is therefore impossible before the Walrus proof exists.
    """
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    state = job["state"]

    if state == "docked":
        # Anchor the proof (time-bounded by WALRUS_TIMEOUT). publish_manifest returns None
        # when Walrus is disabled OR the attempt failed/timed out.
        manifest = walrus.build_manifest(
            job_id, job["spec"]["params"]["seed"], "vina", job.get("result") or []
        )
        anchor = walrus.publish_manifest(manifest)
        if anchor:
            models.update_job_extra(job_id, walrus=anchor)
        elif walrus.WALRUS_ENABLED:
            return {"state": "docked", "proof_pending": True}

        # Proof anchored. Re-dock a sample on an independent worker if one is online;
        # otherwise the anchored manifest is the proof -> `proven`.
        if VERIFY_SAMPLE_FRACTION > 0 and _independent_worker_available(job.get("claimed_by")):
            sub_sdf = sample_ligands_for_verification(
                job["spec"]["ligands_sdf"], VERIFY_SAMPLE_FRACTION, job_id
            )
            sub_spec = {**job["spec"], "ligands_sdf": sub_sdf}
            verifier_job_id = models.create_verification_job(
                parent_job_id=job_id, spec=sub_spec, exclude_worker=job.get("claimed_by")
            )
            models.update_job(job_id, state="verifying")
            models.update_job_extra(job_id, verification={
                "status": "pending",
                "verifier_job_id": verifier_job_id,
                "sample_fraction": VERIFY_SAMPLE_FRACTION,
                "tolerance_kcal": VERIFY_TOLERANCE_KCAL,
            })
            return {"state": "verifying", "verifier_job_id": verifier_job_id}
        models.update_job(job_id, state="proven")
        return {"state": "proven"}

    if state == "proven":
        # Proof is in place -> release payment now. On-chain release goes through the
        # signing bridge; if that's unreachable (e.g. the bridge tunnel is down) the release
        # raises. Don't 500 -- keep the job `proven` so the caller retries, and settlement
        # resumes automatically once the bridge is back. Payment is never lost or duplicated
        # (escrow_release is a no-op once the escrow is already released).
        try:
            _settle_primary(job)
        except Exception as exc:  # noqa: BLE001 -- surface as retriable, not a crash
            return {"state": "proven", "payment_pending": True, "error": str(exc)[:200]}
        return {"state": models.get_job(job_id)["state"]}

    # verifying -> awaiting the verifier callback; terminal/other -> nothing to do.
    return {"state": state}


def _independent_worker_available(original_worker_id: str | None) -> bool:
    """True if some worker other than the one that ran the job is currently online and
    could perform an independent re-execution."""
    for wid in models.list_workers():
        if wid == original_worker_id:
            continue
        w = models.get_worker(wid)
        if w and w.get("status") == "online":
            return True
    return False


def _settle_primary(job: dict, *, note: str | None = None) -> None:
    """Release escrow to the provider and mark the primary job settled. Idempotent and
    resumable: the slow on-chain release runs ONLY while the escrow is still `held`, so a
    retry after a partial settlement -- escrow released on-chain but the serverless function
    died before marking `settled` -- finishes the job WITHOUT re-calling the bridge (a second
    release would abort on an already-consumed escrow). `note` records why verification was
    skipped, when it was."""
    job_id = job["job_id"]
    escrow = models.escrow_status(job_id)
    escrow_state = (escrow or {}).get("state")
    if escrow_state == "held":
        provider_address = None
        if job.get("claimed_by"):
            worker = models.get_worker(job["claimed_by"])
            provider_address = (worker or {}).get("sui_address") or None
        # May raise if the on-chain signing bridge is unreachable; the caller turns that into
        # a retriable `payment_pending` so nothing is lost.
        if models.escrow_release(job_id, proof=True, provider_address=provider_address):
            escrow_state = "released"
    if escrow_state == "released" and models.get_job(job_id).get("state") != "settled":
        models.update_job(job_id, state="settled")
        if job.get("claimed_by"):
            models.increment_worker_stats(job["claimed_by"], completed=True, earned=job.get("price", 0))
        # Best-effort: record the settled transaction on DeepBook (an opaque compute-unit
        # count, never anything identifying). A logging hiccup must never affect settlement.
        entry = deepbook_log.log_settlement(count_ligands(job.get("spec", {}).get("ligands_sdf", "")))
        if entry:
            models.update_job_extra(job_id, deepbook=entry)
    if note:
        models.update_job_extra(job_id, verification={"status": "skipped", "reason": note})


def _handle_verification_callback(verif_job: dict, callback: WorkerCallback) -> dict:
    """The independent re-run came back. Compare its affinities to the primary's for the
    sampled ligands (matched by ligand_id); within tolerance -> prove + settle the
    parent, beyond it -> dispute + refund. A verifier engine error can't itself condemn
    the provider, so it settles the parent with the result unverified."""
    parent_id = verif_job.get("parent_job_id")
    parent = models.get_job(parent_id) if parent_id else None
    if parent is None or parent["state"] != "verifying":
        return {"ok": True, "ignored": "parent gone or not awaiting verification"}

    if callback.error is not None:  # couldn't re-run -> don't punish the provider
        models.update_job_extra(parent_id, verification={
            "status": "inconclusive", "reason": f"verifier errored: {callback.error}"})
        _settle_primary(parent)
        return {"ok": True, "verification": "inconclusive"}

    primary_aff = {r["ligand_id"]: r["vina_affinity"]
                   for r in (parent.get("result") or []) if "vina_affinity" in r}
    verif_aff = {r["ligand_id"]: r["vina_affinity"]
                 for r in (callback.result or []) if "vina_affinity" in r}
    common = [lid for lid in verif_aff if lid in primary_aff]

    if not common:  # naming mismatch (e.g. unnamed ligands) -> can't compare; don't punish
        models.update_job_extra(parent_id, verification={
            "status": "inconclusive", "reason": "no overlapping ligand ids to compare"})
        _settle_primary(parent)
        return {"ok": True, "verification": "inconclusive"}

    deviations = {lid: abs(primary_aff[lid] - verif_aff[lid]) for lid in common}
    max_dev = max(deviations.values())
    detail = {
        "status": "passed" if max_dev <= VERIFY_TOLERANCE_KCAL else "failed",
        "checked_ligands": len(common),
        "max_deviation_kcal": round(max_dev, 4),
        "tolerance_kcal": VERIFY_TOLERANCE_KCAL,
    }
    if max_dev <= VERIFY_TOLERANCE_KCAL:
        models.update_job(parent_id, state="proven")
        models.update_job_extra(parent_id, verification=detail)
        _settle_primary(parent)
        return {"ok": True, "verification": "passed"}

    # Beyond tolerance: the provider's result doesn't reproduce. Dispute -> refund, no pay.
    models.update_job(parent_id, state="disputed",
                      reason=f"verification mismatch: max deviation {max_dev:.2f} kcal/mol "
                             f"exceeds tolerance {VERIFY_TOLERANCE_KCAL}")
    models.update_job_extra(parent_id, verification=detail)
    models.escrow_refund(parent_id)
    return {"ok": True, "verification": "failed"}


class ProgressUpdate(WorkerAuth):
    done: int
    total: int


@app.post("/jobs/{job_id}/progress")
def job_progress(job_id: str, update: ProgressUpdate) -> dict:
    """Live per-ligand progress, forwarded by the worker daemon as the engine docks each
    ligand. Token-gated (only the worker actually running the job can report) and only
    accepted while the job is `running`, so a stale ping can't disturb a finished job."""
    _require_worker_token(update)
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    if job["state"] != "running" or job.get("claimed_by") != update.worker_id:
        return {"ok": True, "ignored": f"job in state {job['state']}"}
    models.update_job_extra(job_id, progress={
        "done": update.done,
        "total": update.total,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
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


@app.post("/workers/{worker_id}/heartbeat")
def worker_heartbeat(worker_id: str, auth: WorkerAuth) -> dict:
    """Pinged from a background thread independent of the main claim/run loop -- while
    a daemon is blocked running a docker container for a job (which can take far
    longer than the heartbeat timeout), it can't reach POST /jobs/claim to heartbeat
    that way, so without this it would falsely show as offline while actively working."""
    _require_worker_token(auth)
    models.update_worker(worker_id, heartbeat=True)
    return {"ok": True}


@app.get("/providers/signup", response_class=HTMLResponse)
def providers_signup_form() -> str:
    return page("Provide idle compute", """
    <h1>Provide idle compute</h1>
    <p class="lede">Just your email -- no password, no account ID to remember. New email
    signs you up; a known email signs you back in and hands you the same setup command
    again (so you never lose your worker token). Hardware is detected automatically by
    the daemon when it starts (CPU cores, GPU if present) -- you don't describe it
    yourself.</p>
    <div class="card">
      <form method="post" action="/providers/signup">
        <label>Email</label>
        <input type="email" name="email" required style="width:100%;margin:8px 0 16px">
        <label>Sui payout address (testnet) &mdash; where you get paid when a job you
        run is verified. A 66-character address starting with <code>0x</code>.
        <strong>Required</strong> &mdash; you can't be paid without it.</label>
        <input type="text" name="sui_address" placeholder="0x..." required
               pattern="0x[0-9a-fA-F]{64}" style="width:100%;margin:8px 0 16px">
        <button type="submit">Continue</button>
      </form>
    </div>
    """)


@app.post("/providers/signup", response_class=HTMLResponse)
def providers_signup_submit(request: Request, email: str = Form(...), sui_address: str = Form(...)) -> str:
    sui_address = sui_address.strip()
    if not _valid_sui_address(sui_address):
        raise HTTPException(status_code=400, detail="A valid Sui payout address (0x + 64 hex chars) is required.")
    # Sign-up-or-sign-in by email (same model as researchers): a returning email recovers
    # the existing worker_id + token rather than minting a duplicate identity.
    identity = models.create_worker_identity(sui_address=sui_address, email=email)
    worker_id, token = identity["worker_id"], identity["token"]
    base_url = str(request.base_url).rstrip("/")
    run_cmd = f"CONTROL_PLANE_URL={base_url} WORKER_ID={worker_id} WORKER_TOKEN={token} ./install_worker.sh"
    return page(f"Signed up: {worker_id}", f"""
    <h1>Signed up: {worker_id}</h1>
    <p class="lede"><strong>Lost this command?</strong> Just
    <a href="/providers/signup">sign in with the same email</a> any time to get it back --
    your worker identity and token are tied to your email, not to this page.</p>
    <div class="card">
      <p>Follow these steps on the computer that will actually provide compute (it can
      be a different machine than the one you're signing up from). You do not need a
      GitHub account or any access to our source code -- just this one setup package.</p>
      <h2>1. Install prerequisites</h2>
      <p>Docker (<a href="https://docs.docker.com/get-docker/">get it here</a> if you
      don't have it -- make sure <code>docker --version</code> works) and Python 3
      (<code>python3 --version</code>; on Windows, use WSL).</p>
      <h2>2. Download and unpack the worker package</h2>
      <pre>curl -L {base_url}/worker-package.zip -o worker-package.zip
unzip worker-package.zip -d worker-package
cd worker-package
chmod +x install_worker.sh</pre>
      <h2>3. Run it (leave the terminal open)</h2>
      <pre>{run_cmd}</pre>
      <p class="lede">First run also builds a small (~300MB) Docker image, once. After
      that, nothing else touches your system Python or packages -- the docking software
      runs sealed inside a disposable container per job.</p>
      <h2>4. Confirm it worked</h2>
      <p>The terminal should print your real detected hardware, then
      <code>polling for jobs...</code>. Check status any time:
      <a href="{base_url}/workers/{worker_id}">{base_url}/workers/{worker_id}</a></p>
      <p class="lede">Stop providing compute any time with Ctrl+C -- the daemon reports
      itself offline immediately.</p>
    </div>
    """)


@app.get("/workers/{worker_id}", response_class=HTMLResponse)
def get_worker_page(worker_id: str) -> str:
    worker = models.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404)
    worker.pop("token", None)
    badge = f'<span class="badge {worker["status"]}">{worker["status"]}</span>'

    jobs = models.list_worker_jobs(worker_id)
    any_live = any(j["state"] not in TERMINAL_STATES for j in jobs)

    # Real settled payouts: an escrow released on-chain to THIS worker's payout address.
    # That's actual money received, distinct from the `total_earned` proxy (price of all
    # docked jobs). Show both so the distinction is honest.
    payout_addr = (worker.get("sui_address") or "").lower()
    real_paid = 0.0
    real_paid_count = 0

    def row(j):
        jid = j["job_id"]
        state = j["state"]
        kind = j.get("kind", "primary")
        kind_badge = f' <span class="badge kind">{kind}</span>' if kind != "primary" else ""
        escrow = models.escrow_status(jid)
        chain = (escrow or {}).get("chain") or {}
        nonlocal real_paid, real_paid_count
        paid_cell = "—"
        if chain.get("release_digest") and (chain.get("paid_to") or "").lower() == payout_addr:
            real_paid += j.get("price", 0) or 0
            real_paid_count += 1
            paid_cell = f'<a href="{_suiscan("tx", chain["release_digest"])}">${j.get("price", 0):g} ✓</a>'
        elif kind == "verification":
            paid_cell = '<span class="muted">internal check</span>'
        elif state in ("disputed", "failed"):
            paid_cell = '<span class="muted">not paid</span>'
        return f"""<tr>
          <td><a class="mono" href="/jobs/{jid}/page">{jid[:8]}</a>{kind_badge}</td>
          <td>{_state_badge(state)}</td>
          <td>{_job_total_ligands(j)}</td>
          <td class="muted">{_age(j.get('started_at') or j.get('created_at'))}</td>
          <td>{paid_cell}</td>
        </tr>"""

    rows = "".join(row(j) for j in jobs)  # populates real_paid via nonlocal
    rows = rows or '<tr><td colspan=5 class="muted">No jobs run yet — leave the daemon running to pick up work.</td></tr>'
    refresh = '<meta http-equiv="refresh" content="6">' if any_live else ""

    def stat(n, label):
        return f'<div class="stat"><span class="n">{n}</span><span class="l">{label}</span></div>'

    return page(f"Worker {worker_id}", f"""
    {refresh}
    <style>.wrap{{max-width:900px}}</style>
    <h1>{worker_id} {badge}</h1>
    <div class="card">
      <p><strong>Hardware:</strong> {worker.get("hardware_info", "unknown")}</p>
      <p><strong>Sui payout address:</strong> <span class="mono">{worker.get("sui_address") or "(none on file — no real payouts)"}</span></p>
      <p><strong>Registered:</strong> {worker.get("registered_at", "?")}</p>
    </div>
    <div class="card">
      {stat(worker.get("jobs_completed", 0), "jobs completed")}
      {stat(f"${real_paid:g}", "received on-chain")}
      {stat(real_paid_count, "paid jobs")}
      {stat(f"${worker.get('total_earned', 0):g}", "lifetime (incl. proxy)")}
    </div>
    <h2>Jobs run by this machine</h2>
    <div class="card">
      <table>
        <tr><th>Job</th><th>State</th><th>Ligands</th><th>Age</th><th>Payout</th></tr>
        {rows}
      </table>
    </div>
    """)


@app.get("/workers/{worker_id}/json")
def get_worker_json(worker_id: str) -> dict:
    worker = models.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404)
    worker.pop("token", None)
    return worker


# A researcher's session is just a cookie holding their internal researcher_id, set at
# sign-in. The user identifies by EMAIL only -- the id is mapped from it server-side and
# never typed into a form (see create_researcher_identity / get_researcher_by_email).
SESSION_COOKIE = "rid"


def _current_researcher(request: Request) -> dict | None:
    """The signed-in researcher for this request (from the session cookie), or None."""
    rid = request.cookies.get(SESSION_COOKIE)
    return models.get_researcher(rid) if rid else None


@app.get("/researchers/signup", response_class=HTMLResponse)
def researchers_signup_form(request: Request) -> str:
    # Already signed in? Skip straight to submitting.
    if _current_researcher(request) is not None:
        return RedirectResponse("/researchers/submit", status_code=303)
    wallet_note = (
        "<p class=\"lede\">You pay with <strong>your own Sui wallet</strong> (Slush / Sui "
        "Wallet / Suiet browser extension). When you submit a job you'll connect it and "
        "sign the escrow lock yourself &mdash; we never hold your key. Testnet "
        "play-money.</p>"
        if models.SUI_ONCHAIN else
        "<p class=\"lede\">Escrow is running in off-chain mock mode, so no wallet is "
        "needed.</p>"
    )
    return page("Sign in", f"""
    <h1>Sign in to submit docking jobs</h1>
    <p class="lede">Just your email -- no password, no account ID to remember. New email
    signs you up; a known email signs you back in.</p>
    {wallet_note}
    <div class="card">
      <form method="post" action="/researchers/signup">
        <label>Email</label>
        <input type="email" name="email" required>
        <button type="submit">Continue</button>
      </form>
    </div>
    """)


@app.post("/researchers/signup")
def researchers_signup_submit(email: str = Form(...)) -> Response:
    # Sign-up-or-sign-in: maps the email to a (possibly new) researcher_id, then drops the
    # id into the session cookie so the rest of the UI never has to ask for it.
    identity = models.create_researcher_identity(email)
    resp = RedirectResponse("/researchers/submit", status_code=303)
    resp.set_cookie(SESSION_COOKIE, identity["researcher_id"], httponly=True, samesite="lax")
    return resp


@app.get("/researchers/logout")
def researchers_logout() -> Response:
    resp = RedirectResponse("/researchers/signup", status_code=303)
    resp.delete_cookie(SESSION_COOKIE)
    return resp


def _progress_cell(job: dict) -> str:
    """Compact progress for a dashboard table cell."""
    state = job["state"]
    if state in RESULT_READY_STATES or state in ("proven", "settled"):
        return '<span class="ok">done</span>'
    total = _job_total_ligands(job)
    if state == "running" and total > 1:
        done = _job_done_ligands(job)
        return f'{done}/{total}'
    if state == "running":
        return "running"
    return '<span class="muted">—</span>'


@app.get("/researchers/jobs", response_class=HTMLResponse)
def researchers_jobs(request: Request):
    """The researcher's own 'my jobs' dashboard: every job they've submitted, newest
    first, with live status/progress and the right next action for each."""
    researcher = _current_researcher(request)
    if researcher is None:
        return RedirectResponse("/researchers/signup", status_code=303)
    jobs = models.list_researcher_jobs(researcher["researcher_id"])
    any_live = any(j["state"] not in TERMINAL_STATES for j in jobs)

    spent = sum(j.get("price", 0) for j in jobs
                if j["state"] in ("settled", "proven", "verifying", "docked"))
    settled = sum(1 for j in jobs if j["state"] in ("settled", "proven"))
    running = sum(1 for j in jobs if j["state"] in ("queued", "running", "verifying", "docked"))

    def row(j):
        jid = j["job_id"]
        state = j["state"]
        if state == "pending_payment":
            action = f'<a href="/jobs/{jid}/pay">Pay &amp; submit</a>'
        elif state in RESULT_READY_STATES and j.get("result"):
            action = f'<a href="/jobs/{jid}/download">Download</a>'
        else:
            action = f'<a href="/jobs/{jid}/page">View</a>'
        return f"""<tr>
          <td><a class="mono" href="/jobs/{jid}/page">{jid[:8]}</a></td>
          <td>{_state_badge(state)}</td>
          <td>{_job_total_ligands(j)}</td>
          <td>{_progress_cell(j)}</td>
          <td>{('$' + format(j['price'], 'g')) if j.get('price') is not None else '—'}</td>
          <td class="muted">{_age(j.get('created_at'))}</td>
          <td class="row-actions">{action}</td>
        </tr>"""

    rows = "".join(row(j) for j in jobs) or '<tr><td colspan=7 class="muted">No jobs yet — <a href="/researchers/submit">submit one</a>.</td></tr>'
    refresh = '<meta http-equiv="refresh" content="6">' if any_live else ""

    def stat(n, label):
        return f'<div class="stat"><span class="n">{n}</span><span class="l">{label}</span></div>'

    return page("My jobs", f"""
    {refresh}
    <style>.wrap{{max-width:900px}}</style>
    <h1>My jobs</h1>
    <p class="lede">Signed in as <strong>{researcher.get('email','')}</strong> ·
      <a href="/researchers/submit">submit another</a> · <a href="/researchers/logout">sign out</a></p>
    <div class="card">
      {stat(len(jobs), "total")}{stat(running, "in progress")}{stat(settled, "completed")}{stat(f"${spent:g}", "spent")}
    </div>
    <div class="card">
      <table>
        <tr><th>Job</th><th>State</th><th>Ligands</th><th>Progress</th><th>Price</th><th>Age</th><th></th></tr>
        {rows}
      </table>
    </div>
    """)


@app.get("/researchers/submit", response_class=HTMLResponse)
def researchers_submit_form(request: Request):
    researcher = _current_researcher(request)
    if researcher is None:
        return RedirectResponse("/researchers/signup", status_code=303)
    return page("Submit a docking job", f"""
    <h1>Submit a docking job</h1>
    <p class="lede">Signed in as <strong>{researcher.get('email','')}</strong> ·
      <a href="/researchers/logout">sign out</a></p>
    <p class="lede">You'll see a price estimate before anything is charged or run.</p>
    <div class="card">
      <form method="post" action="/researchers/submit" enctype="multipart/form-data">
        <label>Protein (PDB file)</label>
        <input type="file" name="receptor_pdb" required>
        <label>Ligands <span class="hint">(one or more SDF files -- each can contain a whole screening library)</span></label>
        <input type="file" name="ligand_sdfs" multiple required>
        <label>Reference ligand for docking box <span class="hint">(SDF, optional -- defines a precise binding pocket)</span></label>
        <input type="file" name="ref_ligand_sdf">
        <label>Box center x,y,z <span class="hint">(optional, only used if no reference ligand given)</span></label>
        <input name="center" placeholder="0,0,0">
        <label>Box size x,y,z <span class="hint">(optional, only used if no reference ligand given)</span></label>
        <input name="size" placeholder="20,20,20">
        <p class="lede">Leaving both blank docks against the whole protein surface
        instead of a specific pocket -- works, but less targeted.</p>
        <button type="submit">Get price estimate</button>
      </form>
    </div>
    """)


@app.post("/researchers/submit", response_class=HTMLResponse)
async def researchers_submit_handler(
    request: Request,
    receptor_pdb: UploadFile = File(...),
    ligand_sdfs: list[UploadFile] = File(...),
    ref_ligand_sdf: Optional[UploadFile] = File(None),
    center: str = Form(""),
    size: str = Form(""),
):
    researcher = _current_researcher(request)
    if researcher is None:
        return RedirectResponse("/researchers/signup", status_code=303)
    researcher_id = researcher["researcher_id"]

    pdb_text = (await receptor_pdb.read()).decode()
    ligand_chunks = []
    for f in ligand_sdfs:
        ligand_chunks.append((await f.read()).decode())
    ligands_sdf = "".join(ligand_chunks)

    if ref_ligand_sdf is not None and ref_ligand_sdf.filename:
        box = {"autobox_ligand": (await ref_ligand_sdf.read()).decode()}
    elif center.strip() and size.strip():
        try:
            box = {
                "center": [float(x) for x in center.split(",")],
                "size": [float(x) for x in size.split(",")],
            }
        except ValueError:
            return page("Invalid box", """
            <h1>Invalid box center/size</h1>
            <p>Center and size must each be three comma-separated numbers, e.g.
            "0,0,0". <a href="/researchers/submit">Go back</a>.</p>
            """)
    else:
        # Neither a reference ligand nor explicit center/size was given -- this used
        # to crash (float("") on the empty form fields). Fall back to a whole-protein
        # box instead of failing outright.
        try:
            box = default_box_from_receptor(pdb_text)
        except ValueError as exc:
            return page("Could not determine docking box", f"""
            <h1>Could not determine a docking box</h1>
            <p>{exc}. Provide a reference ligand or explicit center/size.
            <a href="/researchers/submit">Go back</a>.</p>
            """)

    job_spec = JobSpec(
        receptor=ReceptorSpec(file=pdb_text),
        ligands_sdf=ligands_sdf,
        box=BoxSpec(**box),
        # Low exhaustiveness/num_modes -- this form is for quick end-to-end testing of
        # the marketplace flow, not docking quality. No `cnn` -- that's gnina-specific
        # and we're using Vina for now.
        params=ParamsSpec(exhaustiveness=1, num_modes=1, seed=42),
        payment=PaymentSpec(supplier_id="any"),
        researcher_id=researcher_id,
    )
    created = _submit_internal(job_spec)
    job_id, price = created["job_id"], created["price"]
    num_ligands = created.get("num_ligands", count_ligands(ligands_sdf))
    pricing_badge = (
        f'<p class="lede" style="font-size:0.9em;opacity:0.85">Flat rate: '
        f'${PRICE_PER_LIGAND:g} per ligand &times; {num_ligands} ligand(s).</p>'
    )
    if models.SUI_ONCHAIN:
        # Real on-chain settlement: send the researcher to the wallet-connect pay page,
        # where their own wallet signs the escrow lock. The job queues only after that.
        action = f"""
      <p class="lede">Next you'll connect your Sui wallet and lock
      <strong>${price}</strong> into on-chain escrow. The funds are released to the
      provider only on a verified result, and refunded to you if the job fails.</p>
      <a class="btn" href="/jobs/{job_id}/pay">Connect wallet &amp; pay</a>"""
    else:
        action = f"""
      <p class="lede">Nothing runs until you confirm. Payment is off-chain mock
      bookkeeping in this mode.</p>
      <form method="post" action="/jobs/{job_id}/confirm-and-redirect">
        <button type="submit">Confirm &amp; submit</button>
      </form>"""
    return page("Confirm your job", f"""
    <h1>Ready to submit</h1>
    <div class="card">
      <p class="lede">{num_ligands} ligand(s) detected.</p>
      <p class="price">${price}</p>
      {pricing_badge}
      {action}
    </div>
    <p class="lede">Job ID: <code>{job_id}</code></p>
    """)


@app.post("/jobs/{job_id}/confirm-and-redirect", response_class=HTMLResponse)
def confirm_job_html(request: Request, job_id: str) -> str:
    record = models.confirm_job(job_id)
    base_url = str(request.base_url).rstrip("/")
    if record is None:
        return page("Could not confirm", "<h1>Could not confirm</h1><p>Job not found or already confirmed.</p>")
    return page("Job submitted", f"""
    <h1>Job queued</h1>
    <div class="card">
      <p>Your job is now queued for a worker to pick up.</p>
      <a class="btn" href="{base_url}/jobs/{job_id}/page">Check status &amp; download results</a>
    </div>
    """)


@app.get("/jobs/{job_id}/pay", response_class=HTMLResponse)
def pay_page(job_id: str) -> str:
    """Wallet-connect + sign-the-lock page. The researcher connects their own Sui wallet
    (Slush / Sui Wallet / Suiet) and signs a transaction that locks the job price into the
    on-chain escrow -- their coins, their signature, their key never leaves the browser.
    The created escrow object id is then POSTed to /jobs/{id}/escrow-locked, which verifies
    the lock on-chain before queueing the job. Vanilla JS + the official @mysten SDKs over
    the esm.sh CDN, so there's no build step."""
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    intent = models.payment_intent(job_id)
    if not intent.get("onchain"):
        # Off-chain mode has no wallet step -- just confirm.
        return page("No wallet needed", f"""
        <h1>Off-chain mode</h1>
        <div class="card">
          <p class="lede">Escrow is in off-chain mock mode, so there's no wallet step.</p>
          <form method="post" action="/jobs/{job_id}/confirm-and-redirect">
            <button type="submit">Confirm &amp; submit</button>
          </form>
        </div>""")
    price = job.get("price")
    network = intent["network"]
    sui = intent["amount_mist"] / 1_000_000_000
    # The intent values are injected into the page as a JSON blob the script reads. job_id
    # is an opaque UUID -- safe to embed (no molecule/identity data, per the on-chain rule).
    intent_json = json.dumps({
        "jobId": job_id,
        "packageId": intent["package_id"],
        "module": intent["module"],
        "arbiter": intent["arbiter"],
        "amountMist": str(intent["amount_mist"]),
        "network": network,
    })
    body = f"""
    <h1>Pay for job</h1>
    <div class="card">
      <p class="lede">Lock <strong>{sui:g} SUI</strong> (${price}) into on-chain escrow.
      Released to the provider only on a verified result; refunded to you if the job fails.
      <strong>You sign with your own wallet</strong> &mdash; we never hold your key.</p>
      <p id="status" class="lede">Starting&hellip;</p>
      <div id="wallets"></div>
    </div>
    <p class="lede">Job ID: <code>{job_id}</code></p>
    <script type="module">
      const INTENT = {intent_json};
      const statusEl = document.getElementById('status');
      const walletsEl = document.getElementById('wallets');
      const setStatus = (m, cls) => {{ statusEl.textContent = m; statusEl.className = 'lede ' + (cls || ''); }};
      const log = (...a) => console.log('[pay]', ...a);

      // Surface *anything* that goes wrong so the page can never sit silently "stuck".
      window.addEventListener('error', e => setStatus('Script error: ' + (e.message || e), 'warn'));
      window.addEventListener('unhandledrejection', e =>
        setStatus('Error: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'), 'warn'));
      setStatus('Loading wallet support…');

      // Load the official @mysten SDKs from the CDN. Both packages are pinned to ONE
      // @mysten/sui version (1.36.0) so the wallet, the transaction builder and the client
      // all share a single SDK instance -- the Transaction the wallet receives is exactly
      // the class it understands. (NOTE: @mysten/sui v2 moved SuiClient/getFullnodeUrl out
      // of /client, which is what broke the previous attempt with "SDK exports missing".)
      // `?bundle` collapses the sui subpaths into a single module so there's no slow
      // request-waterfall that can hang. Each import is raced against a timeout, so a dead
      // CDN/ad-blocker turns into a visible message instead of an endless spinner.
      const SUI = '@mysten/sui@1.36.0';
      const withTimeout = (p, ms, what) => Promise.race([p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out loading ' + what)), ms))]);
      const load = (url, what) => withTimeout(import(url), 15000, what);

      let getWallets, Transaction, SuiClient, getFullnodeUrl;
      try {{
        const [wstd, txmod, clientmod] = await Promise.all([
          load('https://esm.sh/@mysten/wallet-standard@0.14.0?deps=' + SUI, 'wallet standard'),
          load('https://esm.sh/' + SUI + '/transactions?bundle', 'transactions'),
          load('https://esm.sh/' + SUI + '/client?bundle', 'client'),
        ]);
        getWallets = wstd.getWallets;
        Transaction = txmod.Transaction;
        SuiClient = clientmod.SuiClient;
        getFullnodeUrl = clientmod.getFullnodeUrl;
        const missing = [['getWallets', getWallets], ['Transaction', Transaction],
          ['SuiClient', SuiClient], ['getFullnodeUrl', getFullnodeUrl]]
          .filter(([, v]) => !v).map(([k]) => k);
        if (missing.length) throw new Error('SDK exports missing: ' + missing.join(', '));
      }} catch (e) {{
        setStatus('Could not load wallet libraries: ' + (e && e.message ? e.message : e)
          + '. Disable any ad/script blocker for this page and reload.', 'warn');
        throw e;
      }}

      const client = new SuiClient({{ url: getFullnodeUrl(INTENT.network) }});
      const chain = 'sui:' + INTENT.network;

      function suiWallets() {{
        return getWallets().get().filter(w =>
          w.features['standard:connect'] &&
          (w.features['sui:signAndExecuteTransaction'] || w.features['sui:signTransaction'] ||
           w.features['sui:signAndExecuteTransactionBlock']));
      }}

      async function execTx(w, account, tx) {{
        const f = w.features;
        if (f['sui:signAndExecuteTransaction'])
          return await f['sui:signAndExecuteTransaction'].signAndExecuteTransaction({{ transaction: tx, account, chain }});
        if (f['sui:signTransaction']) {{
          const signed = await f['sui:signTransaction'].signTransaction({{ transaction: tx, account, chain }});
          return await client.executeTransactionBlock({{ transactionBlock: signed.bytes, signature: signed.signature }});
        }}
        return await f['sui:signAndExecuteTransactionBlock'].signAndExecuteTransactionBlock(
          {{ transactionBlock: tx, account, chain }});
      }}

      async function payWith(w) {{
        for (const b of walletsEl.querySelectorAll('button')) b.disabled = true;
        try {{
          setStatus('Connecting to ' + w.name + '… approve the connection in your wallet.');
          const out = await w.features['standard:connect'].connect();
          const account = (out && out.accounts && out.accounts[0]) || (w.accounts && w.accounts[0]);
          if (!account) throw new Error('wallet returned no account');
          log('connected', account.address);

          setStatus('Building lock transaction…');
          const tx = new Transaction();
          tx.setSender(account.address);
          const [coin] = tx.splitCoins(tx.gas, [BigInt(INTENT.amountMist)]);
          tx.moveCall({{
            target: INTENT.packageId + '::' + INTENT.module + '::lock',
            arguments: [
              coin,
              tx.pure.vector('u8', Array.from(new TextEncoder().encode(INTENT.jobId))),
              tx.pure.address(INTENT.arbiter),
            ],
          }});

          setStatus('Approve the payment in your wallet…');
          const res = await execTx(w, account, tx);
          const digest = res.digest;
          log('tx digest', digest);
          setStatus('Locked. Confirming on-chain (tx ' + digest.slice(0, 10) + '…)…');

          const full = await client.waitForTransaction({{ digest, options: {{ showObjectChanges: true }} }});
          const created = (full.objectChanges || []).find(
            o => o.type === 'created' && o.objectType && o.objectType.endsWith('::escrow::Escrow'));
          if (!created) throw new Error('escrow object not found in tx ' + digest);

          setStatus('Verifying lock with the marketplace…');
          const r = await fetch('/jobs/' + INTENT.jobId + '/escrow-locked', {{
            method: 'POST', headers: {{ 'content-type': 'application/json' }},
            body: JSON.stringify({{ escrow_object_id: created.objectId }}),
          }});
          if (!r.ok) throw new Error('backend rejected lock: ' + (await r.text()));
          setStatus('Paid and queued! Redirecting…', 'ok');
          window.location = '/jobs/' + INTENT.jobId + '/page';
        }} catch (e) {{
          log('error', e);
          setStatus('Error: ' + (e && e.message ? e.message : e), 'warn');
          for (const b of walletsEl.querySelectorAll('button')) b.disabled = false;
        }}
      }}

      function render() {{
        const ws = suiWallets();
        walletsEl.innerHTML = '';
        if (!ws.length) {{
          setStatus('No Sui wallet detected. Install Slush / Sui Wallet / Suiet (set to '
            + INTENT.network + '), then reload this page.', 'warn');
          return;
        }}
        setStatus(ws.length === 1
          ? 'Wallet detected. Click to pay:'
          : 'Choose a wallet to pay with:');
        for (const w of ws) {{
          const b = document.createElement('button');
          b.textContent = (ws.length === 1 ? 'Pay with ' : '') + w.name;
          b.style.marginRight = '8px';
          b.onclick = () => payWith(w);
          if (w.icon) {{
            const img = document.createElement('img');
            img.src = w.icon; img.width = 18; img.height = 18;
            img.style.cssText = 'vertical-align:middle;margin-right:6px';
            b.prepend(img);
          }}
          walletsEl.appendChild(b);
        }}
      }}

      // Wallets register asynchronously; re-render whenever one appears.
      getWallets().on('register', render);
      render();
      setTimeout(render, 400);
      setTimeout(render, 1200);
    </script>"""
    return page("Pay for job", body)


# --------------------------------------------------------------------------------------
# Admin dashboard -- shared-password gate (ADMIN_PASSWORD env var). Shows business-
# sensitive data (user lists, hardware, spend/earnings), so it isn't left wide open
# like the rest of these barebones pages.
# --------------------------------------------------------------------------------------

_admin_auth = HTTPBasic(auto_error=False)


def _require_admin(credentials: Optional[HTTPBasicCredentials] = Depends(_admin_auth)) -> None:
    expected = os.environ.get("ADMIN_PASSWORD")
    if not expected:
        return  # no ADMIN_PASSWORD configured -> dashboard is open (no gate)
    if credentials is None or not secrets.compare_digest(credentials.password, expected):
        raise HTTPException(status_code=401, detail="invalid admin credentials", headers={"WWW-Authenticate": "Basic"})


def _valid_sui_address(addr: str) -> bool:
    """A Sui address is 0x followed by 64 hex chars (32 bytes)."""
    return bool(re.fullmatch(r"0x[0-9a-fA-F]{64}", addr or ""))


def _short(s: Optional[str], n: int = 8) -> str:
    """First n chars of an id, for compact tables. Empty/None -> em dash."""
    return (s[:n] if s else "—")


def _age(iso: Optional[str]) -> str:
    """Human 'time since' for an ISO timestamp (e.g. '12s', '4m', '2h', '3d')."""
    if not iso:
        return "—"
    try:
        then = datetime.fromisoformat(iso)
        if then.tzinfo is None:
            then = then.replace(tzinfo=timezone.utc)
    except ValueError:
        return "—"
    secs = (datetime.now(timezone.utc) - then).total_seconds()
    if secs < 90:
        return f"{int(secs)}s"
    if secs < 5400:
        return f"{int(secs // 60)}m"
    if secs < 172800:
        return f"{int(secs // 3600)}h"
    return f"{int(secs // 86400)}d"


def _state_badge(state: str) -> str:
    return f'<span class="badge {state}">{state}</span>'


def _job_links(job: dict) -> str:
    jid = job["job_id"]
    return f'<a class="mono" href="/jobs/{jid}/page">{jid[:8]}</a>'


@app.get("/admin/dashboard", response_class=HTMLResponse)
def admin_dashboard(_: None = Depends(_require_admin)) -> str:
    workers = [w for w in (models.get_worker(wid) for wid in models.list_workers()) if w]
    researchers = [r for r in (models.get_researcher(rid) for rid in models.list_researchers()) if r]
    jobs = models.list_all_jobs()

    # Newest first; verification jobs carry no price/researcher (internal re-runs).
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    worker_addr = {w["worker_id"]: w for w in workers}

    # ---- aggregate counts -------------------------------------------------------------
    ACTIVE_STATES = ("pending_payment", "queued", "running", "docked", "verifying")
    TERMINAL_STATES = ("settled", "proven", "disputed", "failed")
    by_state: dict[str, int] = {}
    for j in jobs:
        by_state[j.get("state", "?")] = by_state.get(j.get("state", "?"), 0) + 1
    active_jobs = [j for j in jobs if j.get("state") in ACTIVE_STATES]

    online_count = sum(1 for w in workers if w["status"] == "online")
    total_jobs_completed = sum(w.get("jobs_completed", 0) for w in workers)
    total_earned = sum(w.get("total_earned", 0) for w in workers)
    total_spent = sum(r.get("total_spent", 0) for r in researchers)
    walrus_anchored = sum(1 for j in jobs if j.get("walrus"))
    verified_ok = sum(1 for j in jobs if (j.get("verification") or {}).get("status") == "passed")

    # Escrow currently locked = held escrows across all jobs. Fetch each once and reuse
    # for both the held-total and the per-row escrow column.
    escrows = {j["job_id"]: models.escrow_status(j["job_id"]) for j in jobs}
    held_total = sum(e.get("amount", 0) for e in escrows.values() if e and e.get("state") == "held")

    onchain = "on-chain (Sui testnet)" if models.SUI_ONCHAIN else "mock (off-chain)"

    # ---- stat strip -------------------------------------------------------------------
    def stat(n, label):
        return f'<div class="stat"><span class="n">{n}</span><span class="l">{label}</span></div>'

    stats = "".join([
        stat(len(jobs), "total jobs"),
        stat(len(active_jobs), "active now"),
        stat(by_state.get("running", 0), "running"),
        stat(by_state.get("verifying", 0), "verifying"),
        stat(by_state.get("settled", 0) + by_state.get("proven", 0), "settled"),
        stat(by_state.get("disputed", 0) + by_state.get("failed", 0), "disputed/failed"),
        stat(f"{online_count}/{len(workers)}", "providers online"),
        stat(len(researchers), "researchers"),
        stat(f"{held_total:g}", "escrow held"),
        stat(f"{total_spent:g}", "researcher spend"),
        stat(f"{total_earned:g}", "provider earned"),
        stat(walrus_anchored, "Walrus-anchored"),
    ])

    # ---- active jobs table (the live view) --------------------------------------------
    def active_row(j):
        prov = j.get("claimed_by")
        prov_cell = f'<a class="mono" href="/workers/{prov}">{prov[:10]}</a>' if prov else '<span class="muted">unclaimed</span>'
        kind = j.get("kind", "primary")
        kind_badge = f' <span class="badge kind">{kind}</span>' if kind != "primary" else ""
        nlig = count_ligands(j.get("spec", {}).get("ligands_sdf", ""))
        price = j.get("price")
        price_cell = f"${price:g}" if price is not None else "—"
        return f"""<tr>
          <td>{_job_links(j)}{kind_badge}</td>
          <td>{_state_badge(j.get('state','?'))}</td>
          <td>{prov_cell}</td>
          <td>{nlig}</td>
          <td>{price_cell}</td>
          <td>{j.get('attempts', 0)}</td>
          <td class="muted">{_age(j.get('started_at') or j.get('created_at'))}</td>
        </tr>"""

    active_rows = "".join(active_row(j) for j in active_jobs) or '<tr><td colspan=7 class="muted">No active jobs</td></tr>'

    # ---- all jobs table ---------------------------------------------------------------
    def job_row(j):
        v = (j.get("verification") or {}).get("status")
        v_cell = {"passed": "✓ verified", "failed": "✗ disputed", "inconclusive": "~ inconclusive",
                  "skipped": "— skipped", "pending": "… pending"}.get(v, "—")
        esc = escrows.get(j["job_id"])
        esc_cell = esc.get("state") if esc else "—"
        walrus = j.get("walrus")
        w_cell = f'<a href="{walrus["aggregator_url"]}">blob</a>' if walrus else "—"
        rid = j.get("researcher_id")
        prov = j.get("claimed_by")
        kind = j.get("kind", "primary")
        kind_badge = f' <span class="badge kind">{kind}</span>' if kind != "primary" else ""
        price = j.get("price")
        return f"""<tr>
          <td>{_job_links(j)}{kind_badge}</td>
          <td>{_state_badge(j.get('state','?'))}</td>
          <td class="mono muted">{_short(rid)}</td>
          <td class="mono muted">{_short(prov, 10)}</td>
          <td>{count_ligands(j.get('spec', {}).get('ligands_sdf', ''))}</td>
          <td>{('$' + format(price, 'g')) if price is not None else '—'}</td>
          <td>{esc_cell}</td>
          <td>{v_cell}</td>
          <td>{w_cell}</td>
          <td class="muted">{_age(j.get('created_at'))}</td>
        </tr>"""

    MAX_ROWS = 60
    shown = jobs[:MAX_ROWS]
    overflow = f'<p class="muted">Showing newest {MAX_ROWS} of {len(jobs)} jobs.</p>' if len(jobs) > MAX_ROWS else ""
    job_rows = "".join(job_row(j) for j in shown) or '<tr><td colspan=10 class="muted">No jobs yet</td></tr>'

    # ---- providers table --------------------------------------------------------------
    worker_rows = "".join(f"""
      <tr>
        <td class="mono"><a href="/workers/{w['worker_id']}">{w['worker_id'][:14]}</a></td>
        <td><span class="badge {w['status']}">{w['status']}</span></td>
        <td class="muted">{_age(w.get('last_seen') or w.get('registered_at'))}</td>
        <td>{w.get('hardware_info', '') or '<span class="muted">unknown</span>'}</td>
        <td class="mono muted">{_short(w.get('sui_address'), 12)}</td>
        <td>{w.get('jobs_completed', 0)}</td>
        <td>{w.get('total_earned', 0):g}</td>
      </tr>""" for w in workers) or '<tr><td colspan=7 class="muted">None yet</td></tr>'

    researcher_rows = "".join(f"""
      <tr>
        <td class="mono">{_short(r['researcher_id'], 14)}</td>
        <td>{r.get('email', '')}</td>
        <td>{r.get('jobs_submitted', 0)}</td>
        <td>{r.get('total_spent', 0):g}</td>
      </tr>""" for r in researchers) or '<tr><td colspan=4 class="muted">None yet</td></tr>'

    return page("Admin dashboard", f"""
    <meta http-equiv="refresh" content="8">
    <style>.wrap{{max-width:1100px}}</style>
    <h1>Admin dashboard</h1>
    <p class="lede">Live marketplace state · escrow mode: <strong>{onchain}</strong> ·
      queue depth {models.queue_depth()} · running set {models.running_count()} ·
      auto-refresh 8s</p>

    <div class="card">{stats}</div>

    <h2>Active jobs ({len(active_jobs)})</h2>
    <div class="card">
      <table>
        <tr><th>Job</th><th>State</th><th>Provider</th><th>Ligands</th><th>Price</th><th>Try</th><th>Age</th></tr>
        {active_rows}
      </table>
    </div>

    <h2>All jobs</h2>
    {overflow}
    <div class="card">
      <table>
        <tr><th>Job</th><th>State</th><th>Researcher</th><th>Provider</th><th>Lig</th><th>Price</th>
            <th>Escrow</th><th>Verification</th><th>Walrus</th><th>Age</th></tr>
        {job_rows}
      </table>
    </div>

    <h2>Hardware providers ({online_count} online)</h2>
    <div class="card">
      <table>
        <tr><th>Worker</th><th>Status</th><th>Last seen</th><th>Hardware</th><th>Sui payout</th><th>Jobs</th><th>Earned</th></tr>
        {worker_rows}
      </table>
    </div>

    <h2>Researchers</h2>
    <div class="card">
      <table><tr><th>Researcher</th><th>Email</th><th>Submitted</th><th>Spent</th></tr>
        {researcher_rows}
      </table>
    </div>
    """)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
