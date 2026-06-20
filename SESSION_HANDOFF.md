# SESSION HANDOFF — Decentralized Docking Marketplace

**Read this first when resuming.** Pair it with:
- `docs/superpowers/specs/2026-06-20-docking-vertical-slice-design.md` (original design spec — historical, see note at its top)
- `docs/superpowers/specs/2026-06-20-frontend-job-submission-design.md` (frontend contract, Kirill's workstream)

Last updated: 2026-06-20. **Architecture has changed substantially since the original
plan** (Codeplain dropped, control-plane/worker split for Vercel, Docker-per-job engine
execution). This doc reflects current reality, not the original 6-task Codeplain plan.

---

## 1. What we are building

A decentralized compute marketplace for molecular docking: a researcher submits a job
(protein PDB + ligand SDF), pays, and the job runs on a third party's idle hardware.
That hardware owner gets paid for the compute. Full target flow (not all built yet):

1. **Provider** signs up on the website, registers hardware, installs a local daemon
   that polls for work.
2. **Researcher** signs up, submits a job (PDB + SDF), gets a cost estimate, accepts,
   pays via Sui, job is queued.
3. **Server** assigns the job to a registered/polling provider (currently: first-come
   FIFO claim, not capability-matched).
4. That provider's daemon pulls/builds the right Docker image for the job's docking
   engine and runs it.
5. Result is verified (tamper-evident proof — **not built yet**).
6. Researcher is notified, downloads results, verifies the job ran correctly.
7. Payment releases to the provider.

## 2. Major architecture decisions (chronological, why each happened)

### 2.1 Codeplain dropped
After repeated friction (a relative-path bug in generated code, then real CPU docking
runs blowing past Codeplain's 120s conformance-test timeout, each costing render
credits to discover), Codeplain was dropped entirely. **Accepted tradeoff: lost
eligibility for the Codeplain bounty.** `docking_marketplace.plain` stays in the repo
as a historical reference for the `JobSpec`/`Job`/`Escrow` shapes only — not
maintained, not executable.

### 2.2 Control plane / worker split (because of Vercel)
A Vercel serverless function cannot run gnina/Vina docking itself: execution-time
limits and no persistent process. So the backend split into:
- **Control plane** (`api/index.py`) — Vercel-deployable FastAPI app. Job intake,
  validation, escrow record, status, claim queue. Never runs docking.
- **Worker daemon** (`worker_daemon.py`) — runs on the provider's own machine, not on
  Vercel. Polls the control plane (`POST /jobs/claim`), runs the job, reports back.

### 2.3 Pull-based claim, not push-dispatch
Originally the control plane pushed jobs directly to a fixed worker URL. Wrong model:
idle-compute providers (home machines) typically sit behind NAT and can't accept
inbound connections. Switched to polling: `POST /jobs/claim` is polled by daemons;
`claim_next_job` does an atomic pop so concurrent daemons can't double-claim.

### 2.4 Per-job Docker container, not a monolithic worker image
The orchestrator (`worker_daemon.py`) itself has almost no dependencies (`requests`
+ the Docker CLI) and runs directly on the provider's host. For each claimed job, it
runs `docker run <engine-image>` — a **fresh, disposable container per job** — rather
than being itself one big container with gnina/RDKit baked in. This means:
- The provider's host is never polluted with RDKit/gnina/CUDA packages.
- Different jobs could in principle use different engine images (different docking
  backends) without the orchestrator needing to know how to install any of them.
- GPU passthrough is a host-level decision (`docker run --gpus all`, checked once via
  `nvidia-smi` + `docker info` for the NVIDIA Container Toolkit), not a per-job concern.

Contract between orchestrator and engine image: orchestrator writes
`job_spec.json` into a temp dir, bind-mounts it at `/job`, runs the container, reads
back `/job/result.json` (`{"result": [...]}` or `{"error": "..."}`).

### 2.5 Two engine images: gnina (real target) and Vina (fast test path)
- **gnina** (`Dockerfile`, `gnina-bin/`) is the real target engine (CNN rescoring,
  legitimizes the GPU-compute pitch). Heavy: ~3.3GB image (CUDA-compat libs even for
  CPU-only hosts — gnina dynamically links cuDNN/etc. regardless of `--no_gpu`). Build
  takes 5-10 minutes. **Status: Dockerfile is correct and gnina binary is
  pre-downloaded to `gnina-bin/gnina` (gitignored, ~1.4GB) to avoid re-downloading on
  every build, but the image has not been successfully built+tested end-to-end yet** —
  repeatedly interrupted by disk-space exhaustion on this dev machine (see §4) and a
  real bug (see §5). Known-good as of last build attempt: the Dockerfile is correct.
- **AutoDock Vina** (`vina-test/Dockerfile`, `docking_worker_vina.py`,
  `engine_entrypoint_vina.py`) is a deliberately lightweight stand-in (313MB image,
  ~2 min build, no CUDA deps at all — Vina has no GPU/CNN scoring) used to validate the
  per-job Docker architecture quickly. **Status: built and verified working
  end-to-end** against the real local PDB fixtures (see §6). Vina remains the working
  path until gnina's build is finished; gnina is not abandoned, just deferred.

Both engines reuse `docking_worker.py`'s `prepare_receptor`/`split_ligands` (engine-
agnostic RDKit-based receptor PDB cleaning and multi-ligand SDF splitting) — only the
actual docking call + result parsing differs per engine.

### 2.6 Persistence: Upstash REST (Vercel KV), not SQLite/local JSON
A Vercel function has no filesystem shared across invocations, so `models.py` was
rewritten to use Upstash Redis's REST API (the same store Vercel KV provisions) —
reads `KV_REST_API_URL` / `KV_REST_API_TOKEN`, the exact env var names Vercel injects
when a KV store is linked to the project. **Status: written, not yet tested** — no
real Vercel/Upstash account has been set up yet. This blocks running `api/index.py` at
all right now (`os.environ["KV_REST_API_URL"]` raises if unset). See §7 for the
recommended unblock (local Upstash-compatible REST shim via Docker, no cloud account
needed for dev).

### 2.7 One multi-molecule SDF, not a per-ligand JSON array
The real product input is one SDF file containing a screening library (matches the
original problem statement), not a JSON array of individually-specified ligands.
`docking_worker.split_ligands` uses RDKit's `SDMolSupplier` to split it; each ligand's
ID comes from its SDF title (`_Name` property) if present, else a positional fallback
(`ligand_0`, `ligand_1`, ...).

### 2.8 RDKit only, never OpenBabel
Explicit, standing instruction — OpenBabel has known issues with hydrogen handling
during ligand prep. All ligand/receptor prep in this codebase uses RDKit.

## 3. Current file map

| File | Role |
|---|---|
| `api/index.py` | Control plane (Vercel-deployable FastAPI). `POST /jobs`, `POST /jobs/claim`, `GET /jobs/{id}`, `GET /jobs/{id}/escrow`, `GET /jobs/{id}/result`, `POST /jobs/{id}/worker-callback` |
| `models.py` | Job + escrow persistence via Upstash REST. **Needs `KV_REST_API_URL`/`KV_REST_API_TOKEN` to run at all** |
| `worker_daemon.py` | Orchestrator — runs on provider hardware. Polls, runs `docker run <engine-image>` per job, reports back. Deps: `requests` + Docker CLI only |
| `docking_worker.py` | Engine-agnostic receptor/ligand prep (RDKit). Also gnina-specific `run_gnina`/`parse_best_pose` |
| `docking_worker_vina.py` | Vina-specific docking (reuses `docking_worker.py`'s prep functions) |
| `worker_setup.py` | Self-bootstrap for the gnina engine image: installs Python deps, downloads gnina binary if missing, resolves CUDA-compat library paths at call time |
| `engine_entrypoint.py` / `engine_entrypoint_vina.py` | Per-job container entrypoints: read `/job/job_spec.json`, write `/job/result.json` |
| `Dockerfile` | gnina engine image (not yet successfully built end-to-end on this machine) |
| `vina-test/Dockerfile` | Vina engine image (built, tested, working) |
| `gnina-bin/gnina` | Pre-downloaded gnina binary (gitignored, ~1.4GB) — avoids re-download on every gnina image build |
| `install_worker.sh` | Intended one-command setup for a provider's machine. **Needs updating** — still describes the earlier single-container daemon model, not the orchestrator+per-job-container model in §2.4 |
| `docking_marketplace.plain` | Historical Codeplain spec. Not executable, not maintained |
| `fixtures/` | Real test data: `receptor.pdb` (6LU7), `ligand_active.sdf` (aspirin), `ligand_decoy.sdf` (ethane), `ref_ligand.sdf` |

## 4. Environment notes (this dev machine: native Ubuntu, no GPU)

- No NVIDIA GPU (Intel iGPU only). Engines run CPU-only (`--no_gpu` for gnina; Vina has
  no GPU mode at all).
- **Disk is the recurring failure mode on this machine** — only ~230GB total, and
  Docker image builds (especially gnina's CUDA-compat layer, ~2.5GB of pip wheels) can
  push it to 100% full, which causes severe I/O slowdown (builds that should take
  minutes take 30-90+ minutes) rather than a clean failure. **Always check `df -h /`
  and `docker system df` before a build; run `docker builder prune -af` between
  attempts.** This is a known, repeated lesson, not a one-off.
- `gnina-bin/gnina` (pre-downloaded binary) and `.venv` exist locally for direct
  (non-Docker) testing/development; `.venv`'s own copy of the nvidia CUDA-compat
  wheels was deleted once already to free space — Docker images are now the source of
  truth for those libraries, not `.venv`.

## 5. A real bug worth remembering

The gnina Dockerfile has its **own separate, hardcoded copy** of the nvidia
CUDA-compat package list (duplicating `worker_setup.GPU_LIB_PACKAGES`), because Docker
layer caching needs a literal `RUN` command, not a Python function call. When
`nvidia-nvtx-cu11` (ships `libnvToolsExt.so.1`, which gnina actually needs — `cu12`'s
nvtx package only ships `libnvtx3interop.so.1`, a different file) was added to fix a
missing-library bug, it was added to `worker_setup.py` but **not** to the Dockerfile's
duplicate list — so every rebuild silently reused the cached, still-broken layer for
~2 hours before the mismatch was caught. **If `worker_setup.GPU_LIB_PACKAGES` ever
changes again, the Dockerfile's `RUN pip install nvidia-...` list must be updated to
match, or the fix silently won't apply.**

## 6. What's actually been verified working

- **Vina engine, full path**: `docker run --rm -v <job_dir>:/job docking-engine-vina:latest`
  against the real `fixtures/receptor.pdb` + a 2-ligand test SDF (aspirin + ethane,
  inline `file`/`ligands_sdf` content, not `pdb_id` fetch) → correct result:
  `ligand_0` (active) `-4.557` kcal/mol vs `ligand_1` (decoy) `-1.466` kcal/mol, correct
  ranking (more negative = better).
- **Full loop, current architecture (verified 2026-06-20)**: control plane
  (`api/index.py`, backed by a local Upstash-compatible REST shim — see §7) +
  orchestrator (`worker_daemon.py`) + Vina engine container, all running as separate
  processes/containers. `POST /jobs` → queued → daemon polls `POST /jobs/claim` →
  spins up a real `docker run docking-engine-vina` per job → container docks against
  the real local PDB fixture → reports back via `POST /jobs/{id}/worker-callback` →
  state `docked`, `GET /jobs/{id}/result` returns the correct ranked result
  (`ligand_0` -4.557 kcal/mol > `ligand_1` -1.466 kcal/mol). Escrow correctly stays
  `held` (release isn't wired to anything yet — see §8 #4/#5).
  **Gotcha hit during this test**: a stale `worker_daemon.py` process from before the
  Docker-per-job rewrite was still running in the background and won the claim race on
  the first attempt, producing a confusing `gninaw: No such file or directory` error
  (it was calling the old in-process code path against a deleted local gnina binary).
  Always check `ps aux | grep worker_daemon` for stale instances before testing.

## 7. Recommended next step: local Upstash-compatible shim, then full loop test

To unblock testing `api/index.py` without a real Vercel/Upstash account, run a local
REST-compatible shim (`hiett/serverless-redis-http`, a small proxy in front of a plain
`redis` container that speaks the exact same REST protocol Upstash/Vercel KV use):

```bash
docker run -d --name local-redis redis:7-alpine
docker run -d --name local-redis-http -p 8079:80 \
  -e SRH_MODE=env -e SRH_TOKEN=local-dev-token \
  -e SRH_CONNECTION_STRING="redis://local-redis:6379" \
  --link local-redis hiett/serverless-redis-http:latest
export KV_REST_API_URL=http://localhost:8079
export KV_REST_API_TOKEN=local-dev-token
```

Same env var names as production — swapping to real Vercel KV later is just changing
the URL/token, no code change. Then run `api/index.py` + `worker_daemon.py`
(`ENGINE_IMAGE=docking-engine-vina:latest`) together and submit a real job, end to end,
through the actual claim/Docker/callback path (not a direct `docker run` test like §6).

## 8. Remaining work (roughly in priority order)

1. ~~Verify the full loop end to end~~ — **done 2026-06-20, see §6.**
2. Finish building + verifying the gnina engine image (the real target engine) once
   disk space allows — Dockerfile is believed correct (§5's fix applied), just needs an
   uninterrupted build.
3. Update `install_worker.sh` to match the orchestrator+per-job-container model (§2.4)
   instead of the older single-container daemon description.
4. Proof/verification step (tamper-evident hash manifest) — not built at all yet.
   Needed for "researcher verifies the job ran correctly" in the product flow (§1).
5. Real Sui payment (researcher pays, provider gets paid) — `escrow_hold`/
   `escrow_release`/`escrow_refund` exist in `models.py` but are pure bookkeeping, no
   real blockchain calls. DeepBook/Walrus integration per the original design spec's
   confidentiality constraints (§11 of the design spec doc) still applies once this is
   built: never put job-identifying data on-chain or in a public Walrus blob.
6. Hardware registration on signup (`POST /workers/register` or similar) — not built.
   Currently any daemon with any `WORKER_ID` can claim any job; no capability matching.
7. `POST /jobs/estimate` (cost estimate before payment) — needed by the frontend
   (Kirill's design doc), not built yet.
8. Notification to researcher on job completion — not built; likely frontend/email
   territory, not backend.

## 9. Real production deployment (2026-06-20)

The control plane is **actually deployed**, not just locally tested:
- Vercel project: `encode-hackathon/encode_hackathon`, logged in as `alirp366-8280`.
- Storage: real Upstash Redis provisioned via Vercel's marketplace integration
  (`vercel integration add upstash/upstash-kv`) — injects `KV_REST_API_URL`/
  `KV_REST_API_TOKEN` automatically, exactly the names `models.py` already expects, so
  no code change was needed going from the local shim (§7) to real production storage.
- Production URL: **https://encodehackathon-dusky.vercel.app**
- `.vercelignore` added — only `api/`, `models.py`, `requirements.txt` actually deploy.
  Without it, the first deploy attempt tried to upload 1.3GB (the gnina binary, `.venv`,
  fixtures, etc.) and failed Vercel's 100MB limit. Worker-side files
  (`docking_worker*.py`, `worker_*.py`, `engine_entrypoint*.py`, `Dockerfile`) never
  belong in this deployment — they run on provider hardware, not Vercel.
- **Verified end-to-end against the real deployment**: local `worker_daemon.py`
  (`CONTROL_PLANE_URL=https://encodehackathon-dusky.vercel.app`) polled the real
  production API, claimed a real job, ran it in the Vina engine container, reported
  back, and `GET .../jobs/{id}/result` from the live URL returned the correct ranked
  result. This is the actual target architecture working for real, not a local stand-in.
- `.env.local` (gitignored) has the real Upstash credentials for local testing against
  production storage if needed; `vercel env pull` re-fetches it if missing.

## 10. Local dev quick-start (the loop verified in §6, also runnable against prod — §9)

```bash
# Option A: local Upstash-compatible shim (no cloud account needed)
docker run -d --name local-redis redis:7-alpine
docker run -d --name local-redis-http -p 8079:80 \
  -e SRH_MODE=env -e SRH_TOKEN=local-dev-token \
  -e SRH_CONNECTION_STRING="redis://local-redis:6379" \
  --link local-redis hiett/serverless-redis-http:latest
export KV_REST_API_URL=http://localhost:8079 KV_REST_API_TOKEN=local-dev-token

# Option B: real production storage (credentials in .env.local, gitignored)
# set -a; . .env.local; set +a

cd /home/ali/Projects/encode_hackathon && . .venv/bin/activate
python api/index.py &   # port 8000 -- or just use https://encodehackathon-dusky.vercel.app directly

# orchestrator (check for stale instances first! ps aux | grep worker_daemon)
export ENGINE_IMAGE=docking-engine-vina:latest WORKER_ID=test-node-1 \
       CONTROL_PLANE_URL=http://localhost:8000  # or the prod URL
python worker_daemon.py &

# submit a job (use a real JobSpec with inline file/ligands_sdf content, see /tmp/test_job.json pattern)
curl -X POST http://localhost:8000/jobs -H 'content-type: application/json' -d @some_job.json
```

## 11. Frontend dependency

Kirill's frontend needs `POST /jobs/estimate` (see `docs/superpowers/specs/2026-06-20-frontend-job-submission-design.md`
§2) — flagged here so it doesn't get missed when picking up backend work.
