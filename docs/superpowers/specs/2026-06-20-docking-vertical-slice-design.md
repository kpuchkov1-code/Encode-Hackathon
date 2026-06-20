# Docking Vertical Slice — Design Spec

**Date:** 2026-06-20
**Status:** Approved (brainstorming), pending implementation plan
**Repo:** https://github.com/kpuchkov1-code/Encode-Hackathon
**Hackathon:** Encode Vibe Coding Hackathon (3 days, AI-only build). Bounties targeted by the wider project: Solvimon, Codeplain, Sui (DeepBook & Walrus), Vercel. This spec covers **only the docking vertical slice**.

---

## 1. Goal & Boundary

Build a working end-to-end **docking vertical slice** that proves the marketplace's load-bearing claim: a job is submitted, **gnina actually performs molecular docking on the GPU**, a tamper-evident proof of execution is produced, and a (mocked) escrow releases payment against that proof.

This slice is authored **primarily in Codeplain `.plain` specs**, rendered to Python, and run in **WSL2** (where gnina's GPU passthrough already works on this machine). Real DeepBook / Walrus / Solvimon integrations are **stubbed behind interfaces** and swapped in later phases — they are out of scope here.

**In scope:** job submission → real gnina docking → result parsing/ranking → proof manifest → mock escrow release/refund.

**Out of scope (interface seams left, not built):** real Sui/DeepBook/Walrus SDK calls, Solvimon take-rate metering, v0/Vercel frontend, real third-party GPU suppliers, multi-node matching/dispatch.

---

## 2. Key Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Slice boundary | Full vertical slice (submit → run → proof → mock settle) | Most demo-ready; deep on docking, thin on chain glue |
| Docking engine | **gnina** | Vina-lineage docking (trusted) + CNN rescoring on GPU (legitimizes the "idle GPU" pitch); outputs inspectable `CNNscore` / `CNNaffinity` |
| Engine runtime | External binary in **WSL2**, CPU fallback | gnina is Linux-native; WSL GPU passthrough already available |
| Demo workload | Deferred / parameterized | Worker takes any target + ligand set; specific molecules chosen on demo day. Nothing reused from prior projects |
| Build tool | **Codeplain `.plain`** authors backend (API + worker wrapper + proof packager + mock chain), maximize Codeplain coverage | Genuine primary use for the Codeplain bounty; subprocess+parsing+hashing is bounded, acceptance-testable logic |
| Chain layer | Mocked behind interfaces | Real Sui/DeepBook/Walrus deferred to later phase |

---

## 3. Architecture

```
  Buyer ──submit job──▶ ┌─────────────────────────────────────┐
                        │   Job Lifecycle API   (.plain→Py)   │
                        │   POST /jobs  GET /jobs/{id}         │
                        │   GET /jobs/{id}/result + /proof     │
                        └──────────────┬──────────────────────┘
                                       │ dispatch
                        ┌──────────────▼──────────────────────┐
                        │   Docking Worker     (.plain→Py)    │
                        │   prep ▸ build gnina cmd ▸ run ▸     │
                        │   parse poses/scores ▸ rank         │
                        └──────┬───────────────────┬──────────┘
                               │ shells out        │ artifacts
                        ┌──────▼──────┐     ┌───────▼──────────┐
                        │ gnina (WSL) │     │ Proof Packager   │
                        │ GPU binary  │     │ (.plain→Py)      │
                        └─────────────┘     │ hash manifest    │
                                            └───────┬──────────┘
                        ┌───────────────────────────▼──────────┐
                        │  Mock Chain Layer (interfaces, .plain)│
                        │  EscrowMock(hold/release/refund)      │
                        │  StorageMock  (Walrus put/get)        │
                        └───────────────────────────────────────┘
```

Everything in `.plain`-marked boxes is Codeplain-authored Python. gnina is an installed WSL dependency the generated code shells out to.

---

## 4. Components

Each component has one clear purpose, a well-defined interface, and is independently testable.

### 4.1 Job Lifecycle API
- REST endpoints: `POST /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/result`, `GET /jobs/{id}/proof`.
- Holds job state in SQLite (or a JSON store) and drives the state machine.
- On submit: validates the job spec, holds mock escrow, dispatches to the worker.
- **State machine:** `queued → running → docked → proven → settled`, with `failed` as a terminal branch from any stage. Transitions are explicit and logged.

### 4.2 Docking Worker
- Receptor prep (accept a PDB file or fetch by PDB id) and ligand prep (SMILES/SDF).
- Builds the exact gnina command (receptor, ligand, box, exhaustiveness, num_modes, CNN mode, seed).
- Executes gnina via subprocess; captures stdout + output pose SDF.
- Parses per-pose scores: `CNNscore`, `CNNaffinity`, Vina `minimizedAffinity`.
- Ranks ligands by best-pose score.

### 4.3 Proof Packager
- Builds a canonical manifest:
  - `sha256(receptor input)`
  - `sha256(each ligand input)`
  - gnina version string
  - exact parameters used
  - `sha256(each output pose file)`
  - timestamp, worker id
- Serializes the manifest to canonical JSON and hashes it → that hash is the **proof of execution**.
- Provides a `verify(manifest, artifacts)` function that recomputes hashes and confirms integrity.

### 4.4 Mock Chain Layer
- Two interfaces, mock implementations now, real Sui impls later:
  - **`Escrow`**: `hold(job_id, amount)`, `release(job_id, proof)`, `refund(job_id)` — backed by a local JSON ledger.
  - **`Storage`** (Walrus stand-in): `put(blob) -> blob_id`, `get(blob_id)` — backed by a local blob folder.
- Release is **gated on a valid proof**; an invalid/missing proof can only refund, never release.

---

## 5. Data Contracts

### Job spec (input)
```jsonc
{
  "job_id": "uuid",
  "receptor": { "pdb_id": "XXXX" },          // OR { "file": "<path|blob>" }
  "ligands":  [ { "id": "lig1", "smiles": "..." } ],  // smiles OR sdf
  "box":      { "autobox_ligand": "<ref>" },  // OR { "center":[x,y,z], "size":[x,y,z] }
  "params":   { "exhaustiveness": 8, "num_modes": 9, "cnn": "rescore", "seed": 42 },
  "payment":  { "amount": 100, "supplier_id": "node-1" }
}
```

### Result (output)
- Ranked list of ligands; each entry has its best-pose `CNNscore`, `CNNaffinity`, Vina affinity, and a path/blob ref to the pose file.

### Proof (output)
- The canonical hash manifest from §4.3. This is what Walrus would store and what escrow release gates on.

---

## 6. Data Flow (happy path)

1. Buyer `POST /jobs` with a job spec → API validates input.
2. API calls `Escrow.hold(job_id, amount)`; state `queued → running`.
3. Worker preps inputs, runs gnina, parses + ranks → state `running → docked`.
4. Proof Packager builds + stores the manifest via `Storage.put` → state `docked → proven`.
5. API calls `Escrow.release(job_id, proof)` → state `proven → settled`.
6. Buyer fetches `GET /jobs/{id}/result` and `GET /jobs/{id}/proof`.

---

## 7. Error Handling

- **gnina nonzero exit / unparseable output** → job `failed`; `Escrow.refund` (never release on unproven work). First-class, acceptance-tested path.
- **Bad input** (missing receptor, empty ligand set, malformed box) → rejected at `POST /jobs` with a clear 4xx **before any escrow hold**.
- **Determinism** — fixed `seed` so the same job reproduces the same scores, making the proof meaningfully verifiable.
- Errors are never silently swallowed; each failure transition records a reason.

---

## 8. Testing Strategy

Acceptance tests are written **into the `.plain` specs** so Codeplain's conformance run catches a broken gnina call (critical, since Codeplain de-emphasizes hand-reading generated code):

1. Given a known receptor + a single ligand, the result contains ≥1 pose, each with a **numeric** `CNNaffinity`.
2. A positive-control ligand scores better than an obvious non-binder.
3. Tampering with an output file then re-hashing **fails** proof verification.
4. A failed dock yields an escrow **refund**, not a release.
5. Bad input is rejected before any escrow hold.

---

## 9. Tech & Runtime

- **Language:** Python (rendered by Codeplain; Python 3.11+).
- **API:** Python REST framework chosen by Codeplain's Python template (Flask/FastAPI-class).
- **State:** SQLite or JSON store for job records; local JSON ledger for escrow; local folder for blob storage.
- **Engine:** gnina installed in WSL2 (GPU; CPU fallback). The generated Python invokes it via subprocess.
- **Repo requirement:** the `.plain` spec files and configs must be committed (the Codeplain bounty checks for genuine primary use, not just generated output).

---

## 10. Risks

1. **Generated subprocess call to a finicky GPU binary can silently misfire.** Mitigation: strong, specific acceptance tests in the `.plain` (§8) so conformance catches it instead of hand-debugging.
2. **gnina GPU setup in WSL is environment-sensitive.** Mitigation: CPU fallback path; verify the gnina install with a one-ligand smoke test before wiring the API.
3. **Codeplain may struggle with the messiest parts of the worker.** Mitigation: keep gnina as an external binary (not generated); only the bounded command-build/parse/hash logic is specified.
