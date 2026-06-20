# API CONTRACT v1 — Docking Marketplace

**Single source of truth for the backend API.** Both the frontend (Vercel/v0) and the
backend (Codeplain/Flask) code to THIS file. It is the coordination boundary between the
two parallel workstreams.

**Change process:** treat this as a versioned contract. Any change to a shape, status
code, or field name is a breaking change — bump the version, change this file in a PR, and
tell the other person. The `mock-server.js` in `mock/` implements this contract exactly;
keep them in lockstep.

- Base URL: configurable (`BACKEND_BASE_URL`). Real backend runs on `http://localhost:8000`.
- **All JSON keys are `snake_case`.** Content-Type `application/json`.
- ✅ = implemented in the real backend now. 🔜 = contract frozen, backend building it
  (frontend can build against it today using the mock).

---

## Endpoints

### ✅ `GET /health`
Connection check.
- `200` → `{ "status": "ok" }`

### ✅ `POST /jobs`
Create a docking job. Body = **JobSpec** (below).
- `202` → `{ "job_id": "<uuid>", "state": "queued" }`
- `400` → `{ "error": "<message>" }` (invalid body: missing `receptor`, empty `ligands`, bad JSON)

### ✅ `GET /jobs/<job_id>`
Poll a job. **The polling endpoint** — call every ~1.5–2s until a terminal state.
- `200` → `{ "job_id": "...", "state": "<JobState>", "reason": "<str, empty unless failed>" }`
- `404` → `{ "error": "job not found" }`

### ✅ `GET /jobs/<job_id>/escrow`
Payment hold (DeepBook stand-in).
- `200` → `{ "state": "held" | "released" | "refunded", "amount": <number>, "supplier_id": "..." }`
- `404`

### 🔜 `POST /jobs/<job_id>/run` (supply side — a provider claims + starts a queued job)
The seller dashboard's "Run" action. Claims a `queued` job for a provider and starts
docking. This is the backend handoff §8 option (a) — building it server-side makes the
supply side genuinely causal with **zero UI changes** (the mock implements it now).
- Body: `{ "supplier_id": "node-1" }`
- `202` → `{ "job_id": "...", "state": "running", "worker_id": "node-1" }`
- `409` → `{ "error": "job not claimable (state=...)" }` (not `queued` / already taken)
- `404` → `{ "error": "job not found" }`

On success the backend SHOULD set the job's `worker_id` and attribute escrow to
`supplier_id`, so the provider's earnings (via `GET /jobs/<id>/escrow`) reflect the claim.

### 🔜 `GET /jobs` (list — needed for dashboards)
- `200` → `{ "jobs": [ { "job_id": "...", "state": "...", "created_at": "<iso>" } ] }`

### 🔜 `GET /jobs/<job_id>/result`
Ranked docking results (best first). Available once `state` is `docked`/`proven`/`settled`.
- `200` → **DockResult** (below)
- `409` → `{ "error": "result not ready (state=...)" }`

### 🔜 `GET /jobs/<job_id>/proof`
Proof of execution (Walrus stand-in). Available once `state` is `proven`/`settled`.
- `200` → **Proof** (below)
- `409` → `{ "error": "proof not ready (state=...)" }`

---

## Data models

### JobSpec (request body of `POST /jobs`)
```json
{
  "receptor": { "pdb_id": "6LU7" },
  "ligands": [
    { "id": "lig_active", "smiles": "CC(=O)Oc1ccccc1C(=O)O" },
    { "id": "lig_decoy",  "smiles": "CC" }
  ],
  "box":     { "autobox_ligand": "ref_ligand" },
  "params":  { "exhaustiveness": 8, "num_modes": 5, "cnn": "rescore", "seed": 42 },
  "payment": { "amount": 100, "supplier_id": "node-1" }
}
```
- `receptor`: object with `pdb_id` (string) OR `file` (string).
- `ligands`: non-empty array; each has `id` (string) and `smiles` OR `sdf` (string).
- `box`: `{ "autobox_ligand": string }` OR `{ "center": [x,y,z], "size": [x,y,z] }`.
- `params`: `exhaustiveness` int, `num_modes` int, `cnn` string, `seed` int.
- `payment`: `amount` number, `supplier_id` string.

### JobState (string enum)
`queued → running → docked → proven → settled`, plus terminal `failed`.
| state | meaning |
|---|---|
| `queued` | accepted; escrow `held` |
| `running` | docking on a GPU node (gnina) |
| `docked` | `/result` available |
| `proven` | `/proof` available (stored on Walrus) |
| `settled` | escrow `released` to supplier |
| `failed` | `reason` set; escrow `refunded` |

### DockResult (`GET /jobs/<id>/result`)
```json
{
  "job_id": "...",
  "ligands": [
    { "ligand_id": "lig_active", "cnn_score": 0.68, "cnn_affinity": 3.82,
      "vina_affinity": -5.43, "pose_path": "poses/lig_active.sdf" }
  ]
}
```
Sorted by `cnn_affinity` descending (best binder first). Higher `cnn_affinity` = better.

### Proof (`GET /jobs/<id>/proof`)
```json
{
  "manifest_sha256": "<64 hex>",
  "receptor_sha256": "<hex>",
  "ligand_sha256s": { "lig_active": "<hex>" },
  "pose_sha256s":   { "lig_active": "<hex>" },
  "params": { "exhaustiveness": 8, "num_modes": 5, "cnn": "rescore", "seed": 42 },
  "gnina_version": "gnina v1.3.2 ...",
  "timestamp": "<iso>",
  "worker_id": "node-1",
  "storage_blob_id": "<id>"
}
```
`manifest_sha256` is THE proof token (sha256 of the canonical manifest).

---

## Test hooks (mock only)
- Submitting a job with `receptor.pdb_id === "FAIL"` drives the job to `failed` (and
  escrow `refunded`) so the frontend can build/exercise the error + refund UI.
- `MOCK_AUTORUN_MS` (default `1500`) controls how long a submitted job sits `queued`
  before the mock auto-advances it. Set `MOCK_AUTORUN_MS=0` to disable auto-advance so jobs
  wait for a real `POST /jobs/<id>/run` — the **two-sided demo** mode where the seller's
  Run button is causal. The real backend has no such knob; it advances on `run` (or its
  own dispatch).

## Notes for both sides
- Docking is **async**: `POST /jobs` returns immediately as `queued`; the frontend polls.
- Internal components (escrow, storage) are exposed through endpoints so they're
  observable/testable — keep them that way.
- Backend `.plain` must keep `snake_case` keys and these exact status codes.
