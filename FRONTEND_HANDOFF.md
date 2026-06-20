# FRONTEND HANDOFF — Decentralized Docking Marketplace (Vercel / v0)

**Read this first when starting the frontend.** It defines the product, the Vercel
bounty angle, and — most importantly — the **exact backend API contract** the UI must
talk to, plus the integration gotchas (CORS, localhost-vs-Vercel, polling) that will
otherwise eat hours.

Backend repo + context: this same repo. See `SESSION_HANDOFF.md` for the backend build
state, and `docking_marketplace.plain` for the authoritative API behavior.

> **Parallel-team setup:** you build the frontend, a teammate builds the backend.
> The **shared contract both of you code to is `API_CONTRACT.md`** (change it via PR so the
> other person sees it). To build the UI without waiting on the backend, run the mock:
> `node mock/mock-server.js` (serves the full contract on `localhost:8000`, lifecycle
> animates, see `mock/README.md`). Swap to the real/tunneled backend later via one env var.

---

## 1. What you're building

The frontend for a **decentralized compute marketplace for biotech virtual screening**.
Labs submit **molecular docking** jobs; idle GPUs run them; payment settles on-chain
(Sui/DeepBook) and results carry cryptographic provenance (Sui/Walrus). The backend
really runs docking (gnina) and produces real binding-affinity scores — the UI's job is
to make that legible and trustworthy.

Two user roles:
- **Demand (lab / buyer):** submit a docking job, watch it run, inspect ranked results
  and the verifiable proof, see payment settle.
- **Supply (GPU owner):** browse available jobs, "run" them, see earnings. (Mostly
  mocked for the demo — supply-side recruitment is the honest open problem, not the
  thing being proven.)

## 2. The Vercel bounty (why this is its own workstream)

"Best use of Vercel." Build the UI with **v0** (Vercel's AI app builder → Next.js +
Tailwind + shadcn/ui) and **deploy on Vercel**. This is a deliberate split from the
backend: Codeplain owns backend logic, **v0/Vercel owns the frontend**, integrated over
HTTP. Lean into v0-generated Next.js App Router + Vercel hosting; keep secrets in Vercel
env vars (never `NEXT_PUBLIC_*`).

Also surface the **other sponsors visibly in the UI** (judges check for real roles, not
decoration): label escrow as **DeepBook**, proof storage as **Walrus**, and show the
real **gnina** CNN scores. More in §7.

## 3. Integration model (THE critical part — read carefully)

The backend is a **Flask server on `localhost:8000`, running inside WSL on the dev
machine**. A Vercel-hosted frontend (HTTPS, in the cloud) **cannot reach `localhost`**,
and a browser calling `http://localhost:8000` from an `https://` page is blocked
(mixed content). Plan for this from the start:

**Recommended architecture: Next.js Route Handlers as a server-side proxy.**
```
Browser ──(same-origin)──▶ /api/jobs        (Next.js Route Handler on Vercel)
                                │ server-side fetch
                                ▼
                         BACKEND_BASE_URL  ──▶ Flask backend
```
- The browser only ever calls **same-origin `/api/*`** → no CORS, no mixed content.
- The Route Handler does `fetch(`${process.env.BACKEND_BASE_URL}/jobs`)` server-side.
- `BACKEND_BASE_URL` is a **server-only** env var (NOT `NEXT_PUBLIC_`).

**Making the backend reachable for the demo** (pick one, set `BACKEND_BASE_URL` to it):
- **Tunnel (recommended for demo):** `cloudflared tunnel --url http://localhost:8000`
  or `ngrok http 8000` → gives a public HTTPS URL. Point `BACKEND_BASE_URL` at it.
- **Local-only demo:** run `next dev` locally (browser at `localhost:3000`) and set
  `BACKEND_BASE_URL=http://localhost:8000`. Simplest; but then "deployed on Vercel" is a
  separate build (can run against the tunnel).

**Backend change you must request (see §10):** if you ever call the backend *directly*
from the browser instead of via the proxy, the backend must enable **CORS**. The proxy
pattern avoids needing it; prefer the proxy.

**Async / polling:** docking is slow. `POST /jobs` returns immediately with
`state: "queued"`. The UI must **poll `GET /jobs/<id>`** (e.g. every 1.5–2 s) and advance
a status stepper until `state` reaches `settled` (or `failed`). Stop polling on a terminal
state.

## 4. Backend API contract (authoritative)

Base URL = `BACKEND_BASE_URL` (proxied via `/api`). All JSON keys are **snake_case**.
✅ = live now. 🔜 = coming in backend Tasks 4–6 (build the UI against these shapes now;
they won't change).

### ✅ `GET /health`
→ `200 {"status": "ok"}`. Use for a connection indicator.

### ✅ `POST /jobs`
Body = **JobSpec** (see §5). 
→ `202 {"job_id": "<uuid>", "state": "queued"}` on success.
→ `400 {"error": "<message>"}` if invalid (e.g. empty `ligands`, missing `receptor`).

### ✅ `GET /jobs/<job_id>`
→ `200 {"job_id": "...", "state": "<JobState>", "reason": "<str, empty unless failed>"}`
→ `404` if unknown. **This is the polling endpoint.**

### ✅ `GET /jobs/<job_id>/escrow`
→ `200 {"state": "held"|"released"|"refunded", "amount": <number>, "supplier_id": "..."}`
→ `404` if unknown. Surface as the **DeepBook** payment panel.

### 🔜 `GET /jobs/<job_id>/result`  (backend Task 4/6)
→ `200` ranked **DockResult** (best first):
```json
{
  "job_id": "...",
  "ligands": [
    { "ligand_id": "lig_active", "cnn_score": 0.68, "cnn_affinity": 3.82,
      "vina_affinity": -5.43, "pose_path": "..." }
  ]
}
```
→ `409` if the job isn't `docked` yet. Render as the results table (rank by `cnn_affinity`).

### 🔜 `GET /jobs/<job_id>/proof`  (backend Task 5/6)
→ `200` **Proof** manifest:
```json
{
  "manifest_sha256": "<64 hex>",
  "receptor_sha256": "<hex>",
  "ligand_sha256s": { "lig_active": "<hex>" },
  "pose_sha256s": { "lig_active": "<hex>" },
  "params": { "exhaustiveness": 8, "num_modes": 5, "cnn": "rescore", "seed": 42 },
  "gnina_version": "gnina v1.3.2 ...",
  "timestamp": "2026-06-20T...Z",
  "worker_id": "node-1",
  "storage_blob_id": "<id>"
}
```
→ `409` if not `proven` yet. This is the **Walrus** provenance panel — the trust story.

### 🔜 `GET /jobs`  (list — request from backend; see §10)
Needed for dashboards (list all jobs). Not built yet — flag to the backend session.

## 5. JobSpec (the submission form)

The `POST /jobs` body. Build the submit form around this exact shape:
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
Form mapping:
- **Receptor:** text input "PDB ID" (default `6LU7`). (`receptor.file` is an alt the UI
  can ignore for now.)
- **Ligands:** repeatable rows — `id` + `smiles`. Provide a "load sample" button using
  `fixtures/sample_job.json`.
- **Box:** default to `autobox_ligand` text; hide center/size behind "Advanced".
- **Params:** sensible defaults shown above; expose as an "Advanced" section.
- **Payment:** `amount` (number) + `supplier_id` (select from a mocked supplier list).
A canonical valid example lives at `fixtures/sample_job.json`.

## 6. Job lifecycle (drive the status UI)

`JobState`: `queued → running → docked → proven → settled`, with `failed` as a terminal
error branch (carries `reason`). Build a **5-step stepper** plus an error state:

| State | UI meaning |
|---|---|
| `queued` | accepted, escrow **held** (DeepBook) |
| `running` | docking on a GPU node (gnina) |
| `docked` | results available (`/result`) |
| `proven` | proof stored (Walrus), `/proof` available |
| `settled` | payment **released** to supplier (DeepBook) |
| `failed` | show `reason`; escrow **refunded** |

## 7. Surfacing the sponsors (judge-visibility — do this deliberately)

- **DeepBook (Sui):** the escrow panel. Show `held → released/refunded`, the amount, and
  the supplier. Frame copy as "Payment settled on-chain via DeepBook." (Backend value is
  mocked; the UI presents the role.)
- **Walrus (Sui):** the proof panel. Show `manifest_sha256` prominently as "Proof of
  execution," list the input/output hashes, and `storage_blob_id` as "Stored on Walrus."
  Add a "Verify" affordance (re-displays the hash) — this is the differentiator screen.
- **gnina (the science):** the results table with real `cnn_affinity` / `cnn_score` /
  `vina_affinity`. Optionally a 3D pose viewer (3Dmol.js) — nice-to-have; needs a backend
  endpoint to serve the pose SDF (flag in §10).
- **Solvimon:** a small "marketplace take-rate (15%)" line on payment — pitch-level only
  for now.

## 8. Suggested stack + v0 guidance

- **Next.js (App Router) + Tailwind + shadcn/ui**, generated via **v0**, deployed on
  **Vercel**. TypeScript.
- Put all backend calls behind **Route Handlers in `app/api/.../route.ts`** (the proxy in
  §3). The browser never sees `BACKEND_BASE_URL`.
- Data fetching: TanStack Query (or SWR) for the polling on `GET /jobs/<id>`.
- Aesthetic direction (suggestion, not law): clean scientific-credibility look — lots of
  whitespace, monospace for hashes/scores, a restrained accent color, subtle motion. The
  proof/provenance screen should feel "cryptographic and trustworthy," the results screen
  "data-dense and scientific." Avoid generic crypto-bro neon.
- Good v0 prompts to seed: "a job submission wizard for a molecular docking marketplace",
  "a job status page with a 5-step pipeline stepper and live polling", "a provenance panel
  showing SHA-256 hashes and an on-chain settlement badge".

## 9. Demo flow (the end-to-end clickthrough to design toward)

1. **Landing:** the problem (~$50k per 100k-compound screen), the marketplace pitch.
2. **Submit job:** fill JobSpec (or "load sample"), pick a supplier, submit → get `job_id`.
3. **Status page:** stepper advances live (queued→running→docked→proven→settled) as the
   real gnina job runs; DeepBook escrow panel flips `held → released`.
4. **Results:** ranked ligand table; the active ligand outranks the decoy by `cnn_affinity`
   (real numbers, e.g. 3.82 > 2.62).
5. **Provenance:** the Walrus proof panel with the hash manifest — "verify your unpublished
   molecule was processed and not altered."

## 10. Backend changes to request (action items for the backend session)

Add these to the backend so the UI is fully functional:
1. **`GET /jobs` list endpoint** — return all jobs (`job_id`, `state`, `created_at`) for
   dashboards/history. (Not built yet.)
2. **CORS** — only required if you call the backend directly from the browser instead of
   via the Next proxy. If so, enable `flask-cors` for the frontend origin (add to the
   `.plain` implementation reqs).
3. **Pose file endpoint (optional)** — e.g. `GET /jobs/<id>/result/<ligand_id>/pose`
   returning the docked pose SDF, if you want the 3D viewer.
4. **A way to trigger/advance a job** — depending on how backend Task 4/6 lands, there may
   be a synchronous `POST /jobs/<id>/run` or automatic dispatch on submit. Confirm with
   `SESSION_HANDOFF.md` §8 and align the status page to whichever it is.

## 11. Mocked vs real (be honest in the pitch)

- **Real:** docking (gnina on GPU), CNN affinity scores, job lifecycle, proof hashing.
- **Mocked behind interfaces:** DeepBook escrow (JSON ledger), Walrus storage (local
  blobs), Solvimon billing, and the supply side (no real third-party GPUs — own/simulated
  nodes). The claim being demoed is that the **mechanism works end-to-end**, not that
  supply-side adoption is solved.

## 12. Env vars / deployment

- `BACKEND_BASE_URL` — server-only (Vercel env var). The tunnel or `http://localhost:8000`.
- Do NOT expose the backend URL or any key as `NEXT_PUBLIC_*`.
- Local dev: `.env.local` with `BACKEND_BASE_URL=http://localhost:8000`, run `next dev`.
- Vercel: set `BACKEND_BASE_URL` to the tunnel URL in project settings.
