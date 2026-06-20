"""Control-plane API: job intake, pricing, status, escrow, results, admin dashboard.

This is the Vercel-deployable piece -- Vercel's Python runtime serves this module's
`app` (a standard ASGI app) directly. It never runs gnina/Vina itself, and it never
reaches out to a worker either: idle-compute machines (worker_daemon.py) typically sit
behind NAT and can't accept inbound connections, so this is a pure pull model --
daemons poll POST /jobs/claim for work, run it themselves, and report back via
POST /jobs/{job_id}/worker-callback. The control plane never blocks on a docking run.

Hand-written (Codeplain dropped, see SESSION_HANDOFF.md).
"""
import math
import os
import secrets
import sys
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field, model_validator

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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
"""

_NAV = """
<nav><div class="wrap">
  <span class="brand">Docking Marketplace</span>
  <a href="/researchers/submit">Submit a job</a>
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

PRICE_PER_LIGAND_AT_BASELINE = 2.0  # USD-equivalent units; arbitrary placeholder rate
BASELINE_EXHAUSTIVENESS = 8
MIN_PRICE = 1.0

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


def estimate_price(num_ligands: int, exhaustiveness: int) -> float:
    price = PRICE_PER_LIGAND_AT_BASELINE * num_ligands * (exhaustiveness / BASELINE_EXHAUSTIVENESS)
    return round(max(price, MIN_PRICE), 2)


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


@app.post("/jobs/estimate")
def estimate_job(job_spec: JobSpec) -> dict:
    """Dry-run pricing -- no job is created. Needed by the frontend (Kirill's
    workstream) to show a price before the researcher commits to anything."""
    num_ligands = count_ligands(job_spec.ligands_sdf)
    price = estimate_price(num_ligands, job_spec.params.exhaustiveness)
    return {"price": price, "num_ligands": num_ligands}


@app.post("/jobs", status_code=202)
def submit_job(job_spec: JobSpec) -> dict:
    """Creates a job in `pending_payment` -- it is NOT queued for execution until
    POST /jobs/{id}/confirm is called. Price is always computed here, server-side,
    never taken from the client."""
    if models.get_researcher(job_spec.researcher_id) is None:
        raise HTTPException(status_code=400, detail="unknown researcher_id -- sign up at /researchers/signup first")
    spec_dict = job_spec.model_dump()
    num_ligands = count_ligands(job_spec.ligands_sdf)
    price = estimate_price(num_ligands, job_spec.params.exhaustiveness)
    return models.create_job(spec_dict, price=price, researcher_id=job_spec.researcher_id)


@app.post("/jobs/{job_id}/confirm")
def confirm_job(job_id: str) -> dict:
    """Researcher has seen the price and agreed -- hold escrow and actually queue the
    job for a worker daemon to claim."""
    record = models.confirm_job(job_id)
    if record is None:
        raise HTTPException(status_code=409, detail="job not found or not awaiting payment")
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


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    return {"job_id": job["job_id"], "state": job["state"], "reason": job["reason"], "price": job.get("price")}


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
    if job["state"] not in RESULT_READY_STATES:
        raise HTTPException(status_code=409, detail=f"job is in state {job['state']}, not yet docked")
    return job["result"]


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


@app.get("/jobs/{job_id}/page", response_class=HTMLResponse)
def get_job_page(job_id: str) -> str:
    job = models.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404)
    state = job["state"]
    body = f"""
    <h1>Job {job_id[:8]}</h1>
    <div class="card">
      <p><strong>Status:</strong> {state}</p>
      <p><strong>Price:</strong> ${job.get('price', '?')}</p>
    """
    if state in ("failed", "disputed"):
        body += f"<p><strong>Reason:</strong> {job.get('reason', '')}</p>"
    if state in RESULT_READY_STATES and job.get("result"):
        rows = "".join(
            f"<tr><td>{r['ligand_id']}</td><td>{r.get('vina_affinity', r.get('error', ''))}</td></tr>"
            for r in job["result"]
        )
        body += f"""
          <table><tr><th>Ligand</th><th>Affinity (kcal/mol) / error</th></tr>{rows}</table>
          <a class="btn" href="/jobs/{job_id}/download">Download results (.zip)</a>
        """
    else:
        body += "<p class=\"lede\">Refresh this page to check progress.</p>"
    body += "</div>"
    body += _verification_html(job)
    body += _walrus_html(job)
    body += _escrow_chain_html(job_id)
    return page(f"Job {job_id[:8]}", body)


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
    if not chain:
        return ""
    sui = f"{chain.get('amount_mist', 0) / 1_000_000_000:.4f} SUI"
    rows = [f"<p><strong>Escrow on Sui testnet:</strong> {sui}</p>"]
    if chain.get("escrow_object_id"):
        rows.append(f'<p>Escrow object: <a href="{_suiscan("object", chain["escrow_object_id"])}">{chain["escrow_object_id"][:18]}…</a></p>')
    for label, key in (("Lock", "lock_digest"), ("Release", "release_digest"), ("Refund", "refund_digest")):
        if chain.get(key):
            rows.append(f'<p>{label} tx: <a href="{_suiscan("tx", chain[key])}">{chain[key][:18]}…</a></p>')
    if chain.get("paid_to"):
        rows.append(f'<p>Paid to provider: <a href="{_suiscan("object", chain["paid_to"])}">{chain["paid_to"][:18]}…</a></p>')
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

    models.update_job(job_id, state="docked", result=callback.result)

    # Anchor a hashes-only manifest of this result on Walrus (best-effort, public,
    # tamper-evident -- see walrus.py). Never identifies the molecules; never blocks.
    manifest = walrus.build_manifest(
        job_id, job["spec"]["params"]["seed"], "vina", callback.result or []
    )
    anchor = walrus.publish_manifest(manifest)
    if anchor:
        models.update_job_extra(job_id, walrus=anchor)

    # Optimistic verification: re-dock a sample on an INDEPENDENT worker before paying.
    # Needs a second, currently-online worker; with none available we can't verify, so we
    # settle now and record that no independent check was possible (no silent gap).
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
        return {"ok": True, "verifying": True, "verifier_job_id": verifier_job_id}

    note = None if VERIFY_SAMPLE_FRACTION <= 0 else "no independent verifier online"
    _settle_primary(job, note=note)
    return {"ok": True}


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
    """Release escrow to the provider and mark the primary job settled. `note` records
    why verification was skipped, when it was."""
    job_id = job["job_id"]
    provider_address = None
    if job.get("claimed_by"):
        worker = models.get_worker(job["claimed_by"])
        provider_address = (worker or {}).get("sui_address") or None
    released = models.escrow_release(job_id, proof=True, provider_address=provider_address)
    if released:
        models.update_job(job_id, state="settled")
        if job.get("claimed_by"):
            models.increment_worker_stats(job["claimed_by"], completed=True, earned=job.get("price", 0))
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
    <p class="lede">Hardware is detected automatically by the daemon when it starts
    (CPU cores, GPU if present) -- you don't need to describe it yourself. Your worker
    ID and access token are generated for you, not typed in, so no two providers can
    ever collide on or impersonate the same identity.</p>
    <div class="card">
      <form method="post" action="/providers/signup">
        <label>Sui payout address (testnet) &mdash; where you get paid when a job you
        run is verified. Starts with <code>0x</code>. Optional, but without it you
        won't receive real payouts.</label>
        <input type="text" name="sui_address" placeholder="0x..." style="width:100%;margin:8px 0 16px">
        <button type="submit">Sign up</button>
      </form>
    </div>
    """)


@app.post("/providers/signup", response_class=HTMLResponse)
def providers_signup_submit(request: Request, sui_address: str = Form("")) -> str:
    identity = models.create_worker_identity(sui_address=sui_address)
    worker_id, token = identity["worker_id"], identity["token"]
    base_url = str(request.base_url).rstrip("/")
    run_cmd = f"CONTROL_PLANE_URL={base_url} WORKER_ID={worker_id} WORKER_TOKEN={token} ./install_worker.sh"
    return page(f"Signed up: {worker_id}", f"""
    <h1>Signed up: {worker_id}</h1>
    <p class="warn"><strong>Save this command somewhere</strong> -- the token in it is
    only shown once and cannot be recovered if lost (you'd need to sign up again for a
    new identity).</p>
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
    return page(f"Worker {worker_id}", f"""
    <h1>{worker_id} {badge}</h1>
    <div class="card">
      <p><strong>Hardware:</strong> {worker.get("hardware_info", "unknown")}</p>
      <p><strong>Sui payout address:</strong> {worker.get("sui_address") or "(none on file — no real payouts)"}</p>
      <p><strong>Registered:</strong> {worker.get("registered_at", "?")}</p>
      <div class="stat"><span class="n">{worker.get("jobs_completed", 0)}</span><span class="l">jobs completed</span></div>
      <div class="stat"><span class="n">{worker.get("total_earned", 0)}</span><span class="l">earned (proxy, not yet real settlement)</span></div>
    </div>
    """)


@app.get("/workers/{worker_id}/json")
def get_worker_json(worker_id: str) -> dict:
    worker = models.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404)
    worker.pop("token", None)
    return worker


@app.get("/researchers/signup", response_class=HTMLResponse)
def researchers_signup_form() -> str:
    return page("Researcher signup", """
    <h1>Sign up to submit docking jobs</h1>
    <p class="lede">Just an email -- no password. Used to track your jobs and spend.</p>
    <div class="card">
      <form method="post" action="/researchers/signup">
        <label>Email</label>
        <input type="email" name="email" required>
        <button type="submit">Sign up</button>
      </form>
    </div>
    """)


@app.post("/researchers/signup", response_class=HTMLResponse)
def researchers_signup_submit(email: str = Form(...)) -> str:
    identity = models.create_researcher_identity(email)
    researcher_id = identity["researcher_id"]
    return page("Signed up", f"""
    <h1>Signed up: {researcher_id}</h1>
    <p class="warn"><strong>Save your researcher ID</strong> -- you'll need it to
    submit jobs: <code>{researcher_id}</code></p>
    <a class="btn" href="/researchers/submit">Submit a job</a>
    """)


@app.get("/researchers/submit", response_class=HTMLResponse)
def researchers_submit_form() -> str:
    return page("Submit a docking job", """
    <h1>Submit a docking job</h1>
    <p class="lede">You'll see a price estimate before anything is charged or run.</p>
    <div class="card">
      <form method="post" action="/researchers/submit" enctype="multipart/form-data">
        <label>Researcher ID <span class="hint">-- no account yet? <a href="/researchers/signup">sign up</a></span></label>
        <input name="researcher_id" required>
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
    researcher_id: str = Form(...),
    receptor_pdb: UploadFile = File(...),
    ligand_sdfs: list[UploadFile] = File(...),
    ref_ligand_sdf: Optional[UploadFile] = File(None),
    center: str = Form(""),
    size: str = Form(""),
) -> str:
    if models.get_researcher(researcher_id) is None:
        return page("Unknown researcher", f"""
        <h1>Unknown researcher ID</h1>
        <p>"{researcher_id}" isn't a registered researcher.
        <a href="/researchers/signup">Sign up</a> first, then try again.</p>
        """)

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
    created = submit_job(job_spec)
    job_id, price = created["job_id"], created["price"]
    base_url = str(request.base_url).rstrip("/")
    return page("Confirm your job", f"""
    <h1>Ready to submit</h1>
    <div class="card">
      <p class="lede">{created.get("num_ligands", count_ligands(ligands_sdf))} ligand(s) detected.</p>
      <p class="price">${price}</p>
      <p class="lede">Nothing runs until you confirm. Payment is mock bookkeeping for
      now -- real Sui settlement is a later phase.</p>
      <form method="post" action="/jobs/{job_id}/confirm-and-redirect">
        <button type="submit">Confirm &amp; submit</button>
      </form>
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


# --------------------------------------------------------------------------------------
# Admin dashboard -- shared-password gate (ADMIN_PASSWORD env var). Shows business-
# sensitive data (user lists, hardware, spend/earnings), so it isn't left wide open
# like the rest of these barebones pages.
# --------------------------------------------------------------------------------------

_admin_auth = HTTPBasic()


def _require_admin(credentials: HTTPBasicCredentials = Depends(_admin_auth)) -> None:
    expected = os.environ.get("ADMIN_PASSWORD")
    if not expected or not secrets.compare_digest(credentials.password, expected):
        raise HTTPException(status_code=401, detail="invalid admin credentials", headers={"WWW-Authenticate": "Basic"})


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
