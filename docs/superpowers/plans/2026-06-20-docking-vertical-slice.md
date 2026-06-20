# Docking Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an end-to-end docking slice where a submitted job is really docked by gnina on the GPU, a tamper-evident proof is produced, and a mocked escrow releases payment against that proof — authored primarily in Codeplain `.plain` specs.

**Architecture:** A Python REST service (rendered by Codeplain from `.plain`) drives a job state machine. It shells out to the native **gnina** binary in WSL for docking, parses the poses/scores, builds a hash-manifest proof, and gates a mock escrow on that proof. Real Sui/DeepBook/Walrus live behind interfaces and are NOT built here.

**Tech Stack:** Codeplain (`plain2code.py`) → Python 3.11+, gnina (WSL2, GPU + CPU fallback), RDKit + OpenBabel for molecule prep/parse, SQLite for job state, local JSON ledger + blob folder as mock chain.

## Global Constraints

- Everything runs inside **WSL2** (Codeplain requires WSL on Windows; gnina is Linux-native). The Python service and gnina share the same WSL environment, so the service calls `gnina` directly (no `wsl` prefix needed).
- Python **3.11+**.
- `CODEPLAIN_API_KEY` must be exported before any `plain2code.py` run.
- **Commit the `.plain` files** (and config), not just generated `build/` output — the Codeplain bounty checks for genuine primary use.
- Determinism: every gnina run uses **`--seed 42`** so jobs reproduce and proofs are verifiable.
- gnina is an **external installed binary**, never generated. Only the command-build / parse / hash / orchestration logic is authored in `.plain`.
- The canonical `.plain` source lives in `plain/docking_marketplace.plain`; rendered output goes to `build/`.

---

### Task 0: Environment de-risk — gnina + Codeplain toolchain (NOT Codeplain)

This task proves the two things Codeplain cannot prove for you: that gnina runs and that the Codeplain client renders. It produces the ground-truth reference command and output shape that every later acceptance test encodes.

**Files:**
- Create: `scripts/smoke_gnina.sh`
- Create: `fixtures/README.md` (records provenance of fixtures)
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: a verified gnina invocation pattern and the exact SDF property names gnina emits (`CNNscore`, `CNNaffinity`, `minimizedAffinity`), consumed by Task 4's parser.

- [ ] **Step 1: Install gnina in WSL**

Run (in WSL):
```bash
# Preferred: prebuilt binary
wget https://github.com/gnina/gnina/releases/latest/download/gnina -O ~/gnina
chmod +x ~/gnina && sudo mv ~/gnina /usr/local/bin/gnina
gnina --version
```
Expected: prints a gnina version line. If the binary fails on GPU, note it — CPU fallback (`--cpu`) is acceptable for the slice.

- [ ] **Step 2: Install molecule-prep tooling in WSL**

Run:
```bash
sudo apt-get update && sudo apt-get install -y openbabel
python3 -m pip install rdkit
obabel -V && python3 -c "import rdkit; print(rdkit.__version__)"
```
Expected: OpenBabel and RDKit versions print.

- [ ] **Step 3: Fetch a real fixture target + reference ligand**

Run:
```bash
mkdir -p fixtures
# Small, recognizable target with a co-crystal ligand. Any valid PDB works; this is just the smoke fixture.
wget https://files.rcsb.org/download/6LU7.pdb -O fixtures/receptor_raw.pdb
# Extract the co-crystal ligand as the autobox reference + isolate the protein
grep '^ATOM'   fixtures/receptor_raw.pdb > fixtures/receptor.pdb
grep 'HETATM'  fixtures/receptor_raw.pdb | grep -v HOH > fixtures/ref_ligand.pdb
obabel fixtures/ref_ligand.pdb -O fixtures/ref_ligand.sdf
```
Expected: `fixtures/receptor.pdb` and `fixtures/ref_ligand.sdf` exist and are non-empty.

- [ ] **Step 4: Prep one test ligand from SMILES (positive-control-style) and one decoy**

Run:
```bash
# A real small molecule + a trivially non-binding decoy (ethane) to anchor the ranking test later.
obabel -:"CC(=O)Oc1ccccc1C(=O)O" -O fixtures/ligand_active.sdf --gen3d   # aspirin, stand-in active
obabel -:"CC" -O fixtures/ligand_decoy.sdf --gen3d                        # ethane, obvious non-binder
```
Expected: both SDF files exist with 3D coordinates.

- [ ] **Step 5: Write and run the gnina smoke script**

Create `scripts/smoke_gnina.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
gnina \
  -r fixtures/receptor.pdb \
  -l fixtures/ligand_active.sdf \
  --autobox_ligand fixtures/ref_ligand.sdf \
  --seed 42 --num_modes 9 --exhaustiveness 8 \
  -o fixtures/out_active.sdf
echo "=== output properties ==="
grep -E "CNNscore|CNNaffinity|minimizedAffinity" fixtures/out_active.sdf | head
```
Run:
```bash
chmod +x scripts/smoke_gnina.sh && ./scripts/smoke_gnina.sh
```
Expected: `fixtures/out_active.sdf` is produced and the grep shows `CNNscore`, `CNNaffinity`, and `minimizedAffinity` property tags. **Record the exact tag spelling** — Task 4's parser depends on it.

- [ ] **Step 6: Install + verify the Codeplain client**

Run (in WSL):
```bash
git clone https://github.com/Codeplain-ai/plain2code_client.git ~/plain2code_client
cd ~/plain2code_client && python3 -m pip install -r requirements.txt
ls examples/                          # discover real template import names
cat examples/example_hello_world_python/*.plain
export CODEPLAIN_API_KEY="<your key>"
cd examples/example_hello_world_python && python3 ../../plain2code.py *.plain
```
Expected: hello-world renders into a `build/` dir and its conformance tests pass. **Record the available template import names** from `examples/` (e.g. the Python web/REST template) — Task 1 imports one of them.

- [ ] **Step 7: Write `.env.example` and `.gitignore`**

`.env.example`:
```bash
CODEPLAIN_API_KEY=replace_me
CODEPLAIN_NO_TELEMETRY=1
```
`.gitignore`:
```
.env
__pycache__/
*.pyc
fixtures/out_*.sdf
```

- [ ] **Step 8: Commit**

```bash
git add scripts/ fixtures/README.md .env.example .gitignore
git commit -m "chore: gnina + codeplain toolchain de-risk, fixtures, smoke script"
```
(Do not commit large raw PDBs or generated `out_*.sdf`; `fixtures/README.md` records how to regenerate them.)

---

### Task 1: Codeplain skeleton — REST service with health endpoint

Smallest possible `.plain` that renders a running Python REST service. Confirms the real template name and the render→conformance loop on the actual project, before any domain logic.

**Files:**
- Create: `plain/docking_marketplace.plain`
- Create: `plain/README.md` (how to render)

**Interfaces:**
- Produces: a rendered Python REST `:App:` in `build/` with a `GET /health` route returning `{"status":"ok"}`, extended by every later task.

- [ ] **Step 1: Write the skeleton `.plain`**

Create `plain/docking_marketplace.plain` (substitute the real Python REST template import name discovered in Task 0 Step 6 if it differs from `python-rest-api-template`):
```
---
description: 'Decentralized docking marketplace — docking vertical slice'
import:
  - python-rest-api-template
---

***definitions***

- :App: is a Python REST service that accepts molecular docking jobs, runs them via the gnina binary, produces a verifiable proof of execution, and settles payment through a mock escrow.

***functional specs***

- :App: exposes `GET /health` returning JSON `{"status": "ok"}`.

  ***acceptance tests***

  - `GET /health` returns HTTP 200 with body `{"status": "ok"}`.
```

- [ ] **Step 2: Render**

Run (in WSL, from repo root):
```bash
export CODEPLAIN_API_KEY="$CODEPLAIN_API_KEY"
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: code renders into `build/`; conformance test for `/health` passes.

- [ ] **Step 3: Smoke-run the service**

Run the generated app per its README and `curl localhost:<port>/health`.
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add plain/
git commit -m "feat: codeplain REST skeleton with health endpoint"
```

---

### Task 2: Job spec validation + state machine + submit/status endpoints

**Files:**
- Modify: `plain/docking_marketplace.plain` (add definitions, specs, acceptance tests)

**Interfaces:**
- Consumes: the `:App:` from Task 1.
- Produces:
  - `POST /jobs` accepting the Job Spec JSON (§5 of spec), returning `{"job_id": "<uuid>", "state": "queued"}`.
  - `GET /jobs/{id}` returning `{"job_id","state","reason"}` where `state ∈ {queued,running,docked,proven,settled,failed}`.
  - A persisted job record in SQLite with fields `job_id, spec_json, state, reason, created_at`.

- [ ] **Step 1: Add Job Spec + state machine definitions to `.plain`**

Append under `***definitions***`:
```
- :JobSpec: is the submitted job, a JSON object with: `receptor` (object with `pdb_id` string OR `file` path), `ligands` (non-empty array of objects each with `id` and one of `smiles`/`sdf`), `box` (object with `autobox_ligand` OR `center`+`size` arrays), `params` (object: `exhaustiveness` int, `num_modes` int, `cnn` string, `seed` int), and `payment` (object: `amount` number, `supplier_id` string).

- :JobState: is one of `queued`, `running`, `docked`, `proven`, `settled`, `failed`. A :Job: starts at `queued`. `failed` is terminal and may be entered from any non-terminal state, always recording a `reason`.

- :Job: is a persisted record: `job_id` (uuid string), `spec_json`, `state` (:JobState:), `reason` (string, empty unless failed), `created_at` (ISO timestamp).
```

- [ ] **Step 2: Add submit/status functional specs + acceptance tests**

Append under `***functional specs***`:
```
- `POST /jobs` validates the request body against :JobSpec:. On success it creates a :Job: in state `queued` and returns HTTP 202 with `{"job_id": <uuid>, "state": "queued"}`. On a malformed body it returns HTTP 400 with `{"error": <message>}` and creates no :Job:.

  ***acceptance tests***

  - Posting a valid :JobSpec: returns 202, a uuid `job_id`, and state `queued`.
  - Posting a body with an empty `ligands` array returns 400 and persists no :Job:.
  - Posting a body missing `receptor` returns 400 and persists no :Job:.

- `GET /jobs/{id}` returns the :Job: as `{"job_id","state","reason"}`, HTTP 200 if it exists, HTTP 404 otherwise.

  ***acceptance tests***

  - After a successful `POST /jobs`, `GET /jobs/{id}` returns 200 with state `queued`.
  - `GET /jobs/unknown-id` returns 404.
```

- [ ] **Step 3: Render and verify conformance**

Run:
```bash
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: all new acceptance tests pass.

- [ ] **Step 4: Commit**

```bash
git add plain/
git commit -m "feat: job spec validation, state machine, submit/status endpoints"
```

---

### Task 3: Mock chain layer — Escrow + Storage interfaces

**Files:**
- Modify: `plain/docking_marketplace.plain`

**Interfaces:**
- Produces:
  - `Escrow.hold(job_id, amount)`, `Escrow.release(job_id, proof)`, `Escrow.refund(job_id)`, `Escrow.status(job_id) -> {state, amount, supplier_id}` where escrow state ∈ `{held, released, refunded}`. Backed by a local JSON ledger file.
  - `Storage.put(blob_bytes) -> blob_id` (content hash), `Storage.get(blob_id) -> blob_bytes`. Backed by a local blob folder.
  - `release` MUST reject (raise/return error) if `proof` is missing or fails verification, leaving escrow `held`.

- [ ] **Step 1: Add chain-layer definitions**

Append under `***definitions***`:
```
- :Escrow: is a payment-hold abstraction with operations `hold(job_id, amount)`, `release(job_id, proof)`, `refund(job_id)`, and `status(job_id)`. Its state per job is one of `held`, `released`, `refunded`. The mock implementation persists a JSON ledger at `mock_chain/escrow_ledger.json`. `release` succeeds only when given a non-empty proof that passes :Proof: verification; otherwise it leaves the job `held` and reports an error.

- :Storage: is a content-addressed blob store with `put(blob) -> blob_id` and `get(blob_id) -> blob`, where `blob_id` is the sha256 hex of the blob. The mock implementation writes blobs to the `mock_chain/blobs/` folder named by their `blob_id`. This stands in for Walrus.
```

- [ ] **Step 2: Add functional specs + acceptance tests**

Append under `***functional specs***`:
```
- :Escrow: supports the hold/release/refund/status lifecycle backed by a JSON ledger.

  ***acceptance tests***

  - `hold("j1", 100)` then `status("j1")` reports `held` with amount 100.
  - After a held job, `refund("j1")` then `status("j1")` reports `refunded`.
  - `release("j1", "")` on a held job leaves status `held` and reports an error (empty proof rejected).

- :Storage: supports content-addressed put/get backed by a local folder.

  ***acceptance tests***

  - `put(b"abc")` returns the sha256 hex of `b"abc"`, and `get` of that id returns `b"abc"`.
  - Two `put` calls with identical bytes return the same `blob_id`.
```

- [ ] **Step 3: Render and verify**

```bash
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: all chain-layer acceptance tests pass.

- [ ] **Step 4: Commit**

```bash
git add plain/
git commit -m "feat: mock Escrow + Storage (Walrus stand-in) interfaces"
```

---

### Task 4: Docking worker — gnina command build, run, parse, rank

The risky, domain-heavy task. The acceptance tests encode the ground truth captured in Task 0.

**Files:**
- Modify: `plain/docking_marketplace.plain`
- Reference: `fixtures/` (receptor, ref_ligand, active, decoy from Task 0)

**Interfaces:**
- Consumes: validated `:JobSpec:` (Task 2), the verified gnina tag names (Task 0).
- Produces:
  - `dock(job_spec) -> DockResult` where `DockResult` is a list of ligand results ranked best-first, each `{"ligand_id", "cnn_score": float, "cnn_affinity": float, "vina_affinity": float, "pose_path": str}`.
  - Ligand prep: SMILES → 3D SDF via OpenBabel `--gen3d`; receptor used as-is (PDB).
  - gnina invoked once per ligand with `--seed`, `--num_modes`, `--exhaustiveness` from `params`, box from `box`, `--cpu` fallback if GPU unavailable.

- [ ] **Step 1: Add worker definitions**

Append under `***definitions***`:
```
- :LigandPrep: converts a ligand's `smiles` into a 3D SDF file using OpenBabel (`obabel -:"<smiles>" -O <out>.sdf --gen3d`). If the ligand already provides `sdf`, that is written directly to a file and used as-is.

- :GninaCommand: is the argument vector for one ligand: `gnina -r <receptor> -l <ligand_sdf> [--autobox_ligand <ref> | --center_x .. --size_x ..] --seed <params.seed> --num_modes <params.num_modes> --exhaustiveness <params.exhaustiveness> -o <out_sdf>`. If no GPU is available, `--cpu` is appended.

- :DockResult: is a list, ranked by descending `cnn_affinity`, of per-ligand records `{ligand_id, cnn_score, cnn_affinity, vina_affinity, pose_path}` parsed from gnina's output SDF property tags `CNNscore`, `CNNaffinity`, and `minimizedAffinity` (best pose per ligand).
```

- [ ] **Step 2: Add worker functional spec + acceptance tests**

Append under `***functional specs***`:
```
- The worker runs :LigandPrep: for each ligand, executes the :GninaCommand:, parses the output SDF into per-ligand best-pose scores, and returns a :DockResult: ranked by descending `cnn_affinity`.

  ***acceptance tests***

  - Given the fixture receptor and a single fixture ligand, :DockResult: contains exactly one entry whose `cnn_affinity` is a finite number and `pose_path` points to an existing SDF file.
  - Given the fixture receptor with both the active ligand and the decoy (ethane), the active ligand ranks above the decoy in :DockResult: (higher `cnn_affinity`).
  - A ligand whose `smiles` is invalid causes that ligand to be reported as failed without aborting the other ligands.
```

- [ ] **Step 3: Render and verify (allow extra time — real docking runs)**

```bash
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: worker acceptance tests pass. If GPU passthrough fails, confirm the `--cpu` fallback path is exercised and tests still pass (slower).

- [ ] **Step 4: Commit**

```bash
git add plain/
git commit -m "feat: docking worker — gnina build/run/parse/rank"
```

---

### Task 5: Proof packager — hash manifest + verify

Note (2026-06-20 revision): `:Storage:` stays the **mock** local-folder implementation
through this task — the manifest shape needs to be locked down and tested before we
spend a real Walrus call on it. Task 6 swaps it for real Walrus without changing this
task's logic, as long as `put`/`get` here are only ever called with the manifest JSON
(never raw receptor/ligand/pose bytes) — keep that true now so Task 6 is a clean swap.

**Files:**
- Modify: `plain/docking_marketplace.plain`

**Interfaces:**
- Consumes: `:JobSpec:`, `:DockResult:` (pose files), gnina version string.
- Produces:
  - `build_proof(job_spec, dock_result, gnina_version) -> Proof` where `Proof` is canonical JSON: `{receptor_sha256, ligand_sha256s: {id->hash}, params, gnina_version, pose_sha256s: {id->hash}, timestamp, worker_id, manifest_sha256}`. `manifest_sha256` is the sha256 of the canonical JSON of all other fields.
  - `verify_proof(proof, artifacts) -> bool`: recomputes every hash from the on-disk artifacts and returns True only if all match `proof`.

- [ ] **Step 1: Add proof definitions**

Append under `***definitions***`:
```
- :Proof: is a canonical-JSON manifest of one completed job: `receptor_sha256`, `ligand_sha256s` (map ligand_id -> sha256 of its prepped input), `params`, `gnina_version`, `pose_sha256s` (map ligand_id -> sha256 of its output pose file), `timestamp` (ISO), `worker_id`. The field `manifest_sha256` is the sha256 of the canonical JSON serialization (sorted keys) of all the preceding fields, and serves as the proof of execution.

- :ProofVerification: recomputes `receptor_sha256`, every `ligand_sha256s` entry, every `pose_sha256s` entry, and `manifest_sha256` from the on-disk artifacts and returns true only if all recomputed values equal those stored in the :Proof:.
```

- [ ] **Step 2: Add proof functional spec + acceptance tests**

Append under `***functional specs***`:
```
- The proof packager builds a :Proof: from a job's inputs and outputs and can verify it via :ProofVerification:. Proofs are stored through :Storage: (Walrus stand-in) and the returned `blob_id` is recorded on the :Job:.

  ***acceptance tests***

  - Building a :Proof: for a completed fixture job yields a 64-hex `manifest_sha256`, and :ProofVerification: of that proof against the same artifacts returns true.
  - Modifying one byte of a pose file then running :ProofVerification: returns false.
  - Re-running `build_proof` on identical inputs/outputs produces an identical `manifest_sha256` (determinism).
```

- [ ] **Step 3: Render and verify**

```bash
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: proof acceptance tests pass.

- [ ] **Step 4: Commit**

```bash
git add plain/
git commit -m "feat: proof packager — hash manifest + tamper-evident verify"
```

---

### Task 6: Real chain layer — swap mocked Escrow/Storage for DeepBook/Walrus

This is the task that turns "decorative Sui imports" into a real, judge-visible role,
per the SESSION_HANDOFF demo-day note and §11.2 of the design spec. It swaps the
*implementation* behind the existing `:Escrow:`/`:Storage:` interfaces — callers in
Tasks 2, 5, and 7 do not change.

**Files:**
- Modify: `plain/docking_marketplace.plain` (implementation reqs for `:Escrow:`/`:Storage:`, plus new acceptance tests for the confidentiality constraints)
- Create: `scripts/setup_sui_testnet.sh` (wallet/keypair + testnet SUI/DEEP faucet steps)

**Interfaces:**
- `:Escrow:` keeps `hold/release/refund/status`, now backed by a real DeepBook pool on
  testnet: `hold(job_id, amount)` places a generic compute-unit buy order sized to
  `amount`; `release` settles it (transfers to the supplier address); `refund` cancels
  it. The order object/event must contain **only** an opaque compute-unit count and
  price — no `job_id`, receptor, or ligand data.
- `:Storage:` keeps `put(blob) -> blob_id` / `get(blob_id) -> blob`, now backed by real
  Walrus testnet HTTP publisher/aggregator calls. `put` is only ever invoked with the
  proof manifest JSON from Task 5 (not raw molecule files).

- [ ] **Step 1: Stand up a Sui testnet identity**

Create a testnet keypair (`sui client new-address ed25519` or equivalent), fund it from
the testnet faucet (SUI + enough for a DEEP/USDC-pool test order if DEEP isn't free),
and confirm an existing DeepBook testnet pool you can place a small order against.
Record the pool ID, keypair location (gitignored), and faucet steps in
`scripts/setup_sui_testnet.sh`.

- [ ] **Step 2: Real Walrus `put`/`get`**

Implement `:Storage:` against Walrus's testnet HTTP publisher (`PUT` blob, get back a
blob ID) and aggregator (`GET` by blob ID) endpoints — no Sui SDK required for this
part, just HTTP. Keep the mock implementation available behind a config flag for fast
local test runs; the acceptance tests below must run against the real endpoint at least
once.

  ***acceptance tests***

  - `put(manifest_bytes)` against the real Walrus testnet returns a blob ID, and `get`
    of that ID returns the same bytes.
  - `put` is never called anywhere in the codebase with raw receptor/ligand/pose file
    bytes — only with the proof manifest JSON. (Enforce via a focused unit test on the
    call sites, since this is a "never do X" constraint conformance can't observe
    structurally.)

- [ ] **Step 3: Real DeepBook-backed Escrow**

Implement `hold`/`release`/`refund` as real signed Sui transactions against the testnet
DeepBook pool from Step 1, sized generically by compute-units (derive a compute-unit
estimate from `params.exhaustiveness * num_ligands`, not from anything job-identifying).

  ***acceptance tests***

  - `hold(job_id, amount)` produces a real on-chain order; `status(job_id)` reflects
    `held` by reading the order's on-chain state, not a local flag.
  - The on-chain order data contains no `job_id`, receptor, or ligand identifiers —
    only a compute-unit count and price (assert by reading back the raw order object).
  - `release`/`refund` correctly settle/cancel the real order.

- [ ] **Step 4: Render, verify, commit**

```bash
bash scripts/render.sh docking_marketplace.plain --render-from <N>
git add plain/ scripts/setup_sui_testnet.sh
git commit -m "feat: real DeepBook escrow + real Walrus storage behind existing interfaces"
```

---

### Task 7: Wire the full lifecycle — dispatch, settle, refund-on-failure

Ties every component into the state machine: submit holds escrow, runs the worker, builds+stores the proof, and releases (or refunds) escrow. By this point `:Escrow:`/`:Storage:` are the real Task 6 implementations, not mocks.

**Files:**
- Modify: `plain/docking_marketplace.plain`

**Interfaces:**
- Consumes: Tasks 2–6 (`POST /jobs`, `:Escrow:`, `:Storage:`, worker `dock`, proof `build_proof`/`verify_proof`).
- Produces:
  - `GET /jobs/{id}/result` → `:DockResult:` JSON (200 once `state ≥ docked`, else 409).
  - `GET /jobs/{id}/proof` → the stored `:Proof:` JSON (200 once `state ≥ proven`, else 409).
  - Lifecycle: on `POST /jobs` → `Escrow.hold` → `running` → `dock` → `docked` → `build_proof` + `Storage.put` → `proven` → `Escrow.release(proof)` → `settled`. Any worker/proof error → `failed` + `Escrow.refund`.

- [ ] **Step 1: Add lifecycle + result/proof endpoint specs**

Append under `***functional specs***`:
```
- On a successful `POST /jobs`, :App: runs the job lifecycle: hold escrow for `payment.amount`, transition `queued -> running`, run the docking worker (`running -> docked`), build and store the :Proof: via :Storage: (`docked -> proven`), then `Escrow.release(job_id, proof)` (`proven -> settled`). If docking or proof-building fails, the :Job: transitions to `failed` with a `reason` and `Escrow.refund(job_id)` is called. The lifecycle runs asynchronously so `POST /jobs` still returns promptly with `queued`.

  ***acceptance tests***

  - A submitted fixture job eventually reaches state `settled`, and `Escrow.status` for it reports `released`.
  - For a settled job, `GET /jobs/{id}/result` returns 200 with a ranked :DockResult:, and `GET /jobs/{id}/proof` returns 200 with a :Proof: whose :ProofVerification: passes.
  - A job whose every ligand fails docking reaches state `failed` with a non-empty `reason`, and `Escrow.status` reports `refunded`; `GET /jobs/{id}/proof` returns 409.

- `GET /jobs/{id}/result` returns the :DockResult: (200 when state is `docked` or later, 409 otherwise). `GET /jobs/{id}/proof` returns the stored :Proof: (200 when state is `proven` or later, 409 otherwise).

  ***acceptance tests***

  - `GET /jobs/{id}/result` on a job still `queued` returns 409.
  - `GET /jobs/{id}/proof` on a job in state `docked` (not yet `proven`) returns 409.
```

- [ ] **Step 2: Render and verify the full end-to-end conformance suite**

```bash
python3 ~/plain2code_client/plain2code.py plain/docking_marketplace.plain
```
Expected: the complete acceptance suite (Tasks 1–6) passes, including the end-to-end settle and refund paths.

- [ ] **Step 3: Manual end-to-end smoke**

Run the generated service, then:
```bash
curl -X POST localhost:<port>/jobs -H 'content-type: application/json' -d @fixtures/sample_job.json
# poll until settled, then:
curl localhost:<port>/jobs/<id>/result
curl localhost:<port>/jobs/<id>/proof
```
Expected: result shows ranked ligands with CNN scores; proof returns a manifest with a `manifest_sha256`. (Create `fixtures/sample_job.json` referencing the fixture receptor + active/decoy ligands.)

- [ ] **Step 4: Commit**

```bash
git add plain/ fixtures/sample_job.json
git commit -m "feat: full docking lifecycle — dispatch, settle, refund-on-failure"
```

---

### Task 8 (stretch): Dispatch the worker to a separate process/host

Only attempt this if Tasks 0–7 land with time to spare. Per design spec §11.1, nothing
before this task actually demonstrates "idle compute" — the worker has run in-process
on the API host the whole time. This task is the minimal real step toward that claim:
run the docking worker as a **separate process reachable over HTTP** (can still be on
the same physical machine for the demo — the point is the dispatch boundary, not
physical distance), so `payment.supplier_id` refers to something real.

**Files:**
- Modify: `plain/docking_marketplace.plain` (`:WorkerDispatch:` interface, replacing the
  in-process call from Task 4 with an HTTP call to a worker service)
- Create: a minimal worker HTTP service (could itself be Codeplain-authored, or a thin
  hand-written shim if time is short — judge by remaining time, not purity)

**Interfaces:**
- `:WorkerDispatch:` — `dispatch(job_spec) -> DockResult`, implemented in Task 4 as a
  direct function call. This task changes the implementation to an HTTP POST to a
  separate worker process (`POST /dock` on a second port/host), with the API polling or
  awaiting the response. The job lifecycle (Task 7) should not need to change — it
  already calls through `:WorkerDispatch:`, not gnina directly.

- [ ] **Step 1: Extract the worker into its own runnable service**

Stand up the Task 4 worker logic behind its own `POST /dock` endpoint, runnable as an
independent process (own venv/container if useful, but same gnina binary).

  ***acceptance tests***

  - Calling `POST /dock` directly on the worker service with a fixture job spec returns
    the same `:DockResult:` shape Task 4 produced in-process.

- [ ] **Step 2: Point the API's `:WorkerDispatch:` at the worker service over HTTP**

  ***acceptance tests***

  - A full job submitted via `POST /jobs` against the main API still reaches `settled`,
    now via an HTTP call to the separate worker process (verify by, e.g., checking the
    worker process's own log/PID differs from the API's).
  - If the worker process is killed mid-job, the job reaches `failed` (not stuck) and
    `Escrow.refund` is called — the dispatch boundary must fail closed, not hang.

- [ ] **Step 3: Commit**

```bash
git add plain/
git commit -m "feat: dispatch docking worker to a separate process (idle-compute boundary, stretch)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-20-docking-vertical-slice-design.md`):
- §3 architecture (API, worker, proof, chain layer) → Tasks 1–7. ✓
- §4.1 Job Lifecycle API + state machine → Tasks 2, 7. ✓
- §4.2 Docking Worker → Task 4 (dispatch boundary: Task 8, stretch). ✓
- §4.3 Proof Packager (build + verify) → Task 5. ✓
- §4.4 Chain Layer (Escrow + Storage, mocked → real, release gated on proof) → Task 3 (mocks), Task 6 (real DeepBook/Walrus), gating exercised in Task 7. ✓
- §5 data contracts (Job spec, Result, Proof) → Tasks 2, 4, 5. ✓
- §6 data flow happy path → Task 7. ✓
- §7 error handling (gnina failure→refund, bad input→4xx pre-hold, determinism) → Tasks 2, 4, 5, 7. ✓
- §11.1 idle-compute gap → Task 8 (stretch; explicitly not assumed done). ✓
- §11.2 confidentiality constraints (no job data on-chain/in Walrus, no provider-side secrecy claim) → Task 6 acceptance tests. ✓
- §8 testing (all 5 acceptance scenarios) → distributed across Tasks 2, 4, 5, 7. ✓
- §9 runtime (WSL, Python 3.11+, gnina external, commit `.plain`) → Global Constraints + Task 0. (Also verified to run native-Linux/CPU-only, see SESSION_HANDOFF §4a.) ✓
- §10 risks (subprocess misfire→strong acceptance tests; GPU fragility→CPU fallback; gnina smoke before wiring; mocked-Sui demo risk; idle-compute gap) → Task 0, Task 4, Task 6, Task 8. ✓

**Placeholder scan:** Template import name in Task 1 is the one genuine unknown; Task 0 Step 6 resolves it empirically and Task 1 instructs substitution. No `TBD`/`TODO`/"handle edge cases" left.

**Type consistency:** `DockResult` record fields (`ligand_id, cnn_score, cnn_affinity, vina_affinity, pose_path`) are identical in Tasks 4, 5, 7. `Proof` fields (`receptor_sha256, ligand_sha256s, params, gnina_version, pose_sha256s, timestamp, worker_id, manifest_sha256`) are identical in Tasks 5, 7. Escrow states (`held/released/refunded`) and job states (`queued/running/docked/proven/settled/failed`) are consistent across Tasks 2, 3, 6, 7.
