# Frontend Design — Decentralized Docking Marketplace

**Date:** 2026-06-20
**Status:** Approved (brainstorming complete)
**Scope:** Demand-side (buyer) full clickthrough. Deployed on Vercel. Built in Claude Code,
optional v0-generated hero screen as pitch-narrative polish.

This spec is the authoritative frontend design. It codes against `API_CONTRACT.md` (the
backend boundary) and is built/iterated against `mock/mock-server.js` until the real
backend is tunnelled in via one env var.

---

## 1. Goal

Build the buyer-facing UI for a decentralized compute marketplace for molecular docking.
A lab submits a docking job, watches it run live, inspects ranked binding-affinity results,
and verifies cryptographic proof of execution — with on-chain payment settlement surfaced.
The UI's job is to make a real backend computation (gnina docking) **legible and trustworthy**.

**Primary success criterion:** a single live clickthrough — submit → watch the 5-step
pipeline animate → results table → provenance/proof panel — works end-to-end on a deployed
Vercel URL against the mock (and later the real/tunnelled backend) with no code changes.

---

## 2. Stack

- **Next.js 14 (App Router) + TypeScript** — Vercel-bounty-aligned, server/client split.
- **Tailwind CSS + shadcn/ui** — dark mode, component primitives.
- **SWR** — data fetching + polling. (A Vercel OSS library; reinforces the bounty story.
  `refreshInterval` drives job polling natively.)
- **framer-motion** — stepper transitions and progressive section reveals.
- **3Dmol.js** — client-side molecular viewer, loads receptor structures directly from RCSB
  by PDB ID (no backend dependency).
- **Fonts:** geometric sans for UI (Geist or Inter), monospace (JetBrains Mono / Geist Mono)
  for hashes, SMILES, scores, IDs.

---

## 3. Visual direction (AminoAnalytica-inspired, dark technical)

Reference: AminoAnalytica's app (near-black canvas, violet accent, split-pane structural
viewer, monospace data blocks, suggestion-card affordances).

- **Background:** true near-black (`~#0A0A0B`), elevated surfaces a touch lighter
  (`~#141416`). Content floats; minimal borders, soft separation.
- **Accent:** blue (`~#3B82F6` / electric blue). Single restrained accent — used for the
  active pipeline step, the molecular structure, primary CTAs, and the proof-verified state.
  Avoid a second competing accent. Green reserved for the `ok`/`released` success
  micro-states; amber/red for `failed`/`refunded`.
- **Typography:** geometric sans for prose/labels; **monospace** for all machine values
  (job_id, sha256, SMILES, cnn_affinity, vina_affinity, blob ids).
- **Affordances:** dark suggestion cards (white title + muted subtitle) for presets and
  entry points, mirroring the reference.
- **Motion:** subtle. Section reveals fade/slide in as job state advances; the stepper's
  active node pulses gently. No gratuitous animation.
- **Tone:** reads as a *structural-biology instrument / compute console*, NOT crypto-casino.

---

## 4. Integration architecture (critical — from handoff §3)

```
Browser ──(same-origin)──▶ /api/<path>   (Next.js Route Handler on Vercel)
                                │ server-side fetch
                                ▼
                         BACKEND_BASE_URL  ──▶ Flask backend (or mock)
```

- **Single catch-all proxy:** `app/api/[...path]/route.ts` forwards `GET`/`POST` to
  `${process.env.BACKEND_BASE_URL}/<path>` server-side, passing the JSON body and returning
  the upstream status + JSON verbatim.
- The browser **only ever calls same-origin `/api/*`** → no CORS, no mixed-content, the
  backend URL never reaches the client.
- `BACKEND_BASE_URL` is **server-only** (never `NEXT_PUBLIC_*`). Swap mock → tunnel → real
  backend by changing this one env var; zero UI changes.
- **Health passthrough:** `/api/health` → backend `/health` for the connection indicator.

**Reachability for the demo:** point `BACKEND_BASE_URL` at a Cloudflare/ngrok tunnel of the
WSL `localhost:8000` backend, or run `next dev` locally against `http://localhost:8000`.

---

## 5. Routes

| Route | Purpose |
|---|---|
| `/` | **Role-chooser landing** for the two-sided marketplace. Two doors: "I need compute" → `/buy`, "I have GPUs" → `/sell`. |
| `/buy` | Buyer home — marketplace pitch (the ~$50k-per-100k-compound-screen problem) + suggestion cards. Primary CTA → `/submit`. |
| `/submit` | JobSpec wizard. Left: form. Right: live 3Dmol receptor preview (renders as PDB ID is entered). Suggestion cards for presets (load sample, trigger-failure). |
| `/jobs/[id]` | **Buyer hero screen.** Split-pane. Left: pipeline stepper + escrow + results + proof, progressively revealed as state advances. Right: persistent 3Dmol receptor viewer + monospace info block. |
| `/sell` | **Provider dashboard** (supply side). Node card (connect/online, mocked GPU specs), earnings (derived from settled escrow), live job feed with simulated "Run". |

`/jobs` history list view is **out of scope** for v1 (mock serves it; add only if time remains).

**Pivot note (2026-06-20):** product reframed from docking-only to a general **bio-compute
marketplace**. The supply side (below) was promoted from out-of-scope to in-scope; the buyer
flow is unchanged.

---

## 6. The job lifecycle UI (`/jobs/[id]`)

Split-pane, the centrepiece of the demo.

**Left column — progressive reveal driven by `JobState`:**

1. **PipelineStepper** — 5 steps `queued → running → docked → proven → settled`, plus a
   `failed` terminal branch. Active step pulses; completed steps check off. Always visible.
2. **EscrowPanel (DeepBook):** appears immediately. Shows `held → released/refunded`, amount,
   supplier_id. Copy: "Payment settled on-chain via DeepBook." Includes a Solvimon
   "marketplace take-rate 15%" line.
3. **ResultsTable (gnina):** reveals at `state === docked`. Ranked ligands by `cnn_affinity`
   desc, monospace numbers (`cnn_score`, `cnn_affinity`, `vina_affinity`). Best binder
   highlighted (active ligand outranks decoy — the science payoff).
4. **ProofPanel (Walrus):** reveals at `state === proven`. `manifest_sha256` as the hero
   "proof of execution" token, input/output hashes (receptor/ligand/pose sha256s), params,
   gnina_version, worker_id, `storage_blob_id` ("Stored on Walrus"). A "Verify" affordance
   re-displays/copies the manifest hash. This is the trust differentiator.

**Right column — persistent:**

- **3Dmol.js receptor viewer**, loaded by `receptor.pdb_id` from RCSB (client-side). Violet
  cartoon on near-black, mirroring the reference.
- **Monospace info block** beneath: job_id, current state, supplier, and (once available)
  top score + manifest hash — echoing AminoAnalytica's sequence/data panel.

**Error path:** submitting `receptor.pdb_id === "FAIL"` (mock test hook) drives the job to
`failed`; render the `reason`, mark escrow `refunded`. Built deliberately for the demo.

### State → reveal mapping

| State | Stepper | Escrow | Results | Proof |
|---|---|---|---|---|
| `queued` | step 1 active | held | — | — |
| `running` | step 2 active | held | — | — |
| `docked` | step 3 active | held | **shown** | — |
| `proven` | step 4 active | held | shown | **shown** |
| `settled` | all complete | **released** | shown | shown |
| `failed` | error branch | **refunded** | (reason shown) | — |

---

## 6b. The provider dashboard (`/sell`, supply side)

Honest framing: the API contract has **no supply-side endpoints** (no node registration, no
job-claim). Per the original handoff, supply is "mostly mocked — supply-side recruitment is
the open problem, not the thing being proven." So the dashboard is wired to **real** `GET
/jobs` + escrow data, but node specs and the "Run" action are simulated and labelled as such.

- **NodeCard:** offline by default. "Connect hardware" flips to online and shows mocked
  specs (node_id `node-1`, RTX 4090, 24 GB, CUDA 12.4, eu-west-1) + an offline toggle. Using
  `node-1` means the node owns the sample jobs' escrow, so earnings populate.
- **EarningsPanel (DeepBook):** earned (sum of `released` escrow where `supplier_id` = node),
  pending payout (`held`), jobs completed. Derived live from escrow.
- **JobFeed:** polls `GET /jobs`; rows show job, state, reward (escrow amount), action.
  Queued jobs get a **Run** button (disabled until the node is online); clicking it
  optimistically tags the job as claimed-by-you. Settled → "+ paid", failed → "refunded".
- A persistent disclosure line states the simulated parts.

## 7. Data layer

- **`lib/types.ts`** — TypeScript types mirroring `API_CONTRACT.md` exactly. snake_case keys
  preserved (`JobSpec`, `JobState`, `DockResult`, `Proof`, `Escrow`, `JobStatus`).
- **`lib/api.ts`** — typed fetchers hitting same-origin `/api/*` (`getHealth`, `createJob`,
  `getJob`, `getEscrow`, `getResult`, `getProof`).
- **Hooks (SWR):**
  - `useJob(id)` — polls `/api/jobs/<id>` every ~1500ms; **stops polling** (`refreshInterval: 0`)
    once `state ∈ {settled, failed}`.
  - `useEscrow(id)` — polls alongside job until terminal.
  - `useResult(id)` — fetched only once `state` reaches `docked` (avoids 409 spam).
  - `useProof(id)` — fetched only once `state` reaches `proven`.
  - `useHealth()` — light poll for the connection indicator.

---

## 8. Components

- `PipelineStepper` — 5 steps + failed branch, animated active/complete states.
- `EscrowPanel` (DeepBook) — held/released/refunded, amount, supplier, take-rate line.
- `ResultsTable` (gnina) — ranked ligand rows, mono numbers, best-binder highlight.
- `ProofPanel` (Walrus) — manifest hash hero, hash list, params, blob id, Verify/copy.
- `ReceptorViewer` — 3Dmol.js wrapper, loads PDB ID from RCSB, blue cartoon, near-black bg.
- `JobInfoBlock` — monospace metadata panel (right column).
- `SubmitForm` — PDB ID input, repeatable ligand rows (id + smiles), Advanced collapsibles
  (box, params), supplier select, "Load sample" + preset suggestion cards.
- `ConnectionIndicator` — `/health` badge in the nav.
- `SuggestionCard` — reusable dark card (title + subtitle) for landing/submit affordances.
- `SponsorBadge` — small consistent label component (DeepBook / Walrus / gnina / Solvimon).

---

## 9. Sponsor surfacing (judge-visibility, deliberate)

- **DeepBook (Sui):** EscrowPanel — `held → released/refunded`, amount, supplier. "Settled
  on-chain via DeepBook." (Backend value mocked; UI presents the role.)
- **Walrus (Sui):** ProofPanel — `manifest_sha256` prominent, hashes listed, `storage_blob_id`
  as "Stored on Walrus," Verify affordance. The trust differentiator screen.
- **gnina (science):** ResultsTable with real `cnn_affinity` / `cnn_score` / `vina_affinity`.
- **Solvimon:** "marketplace take-rate (15%)" line on the payment panel (pitch-level).
- **Vercel:** Route Handler proxy, server-only env vars, Vercel Analytics, SWR, clean deploy.

---

## 10. Out of scope (YAGNI for v1)

- `/jobs` history list view — mock serves it; add only if time remains.
- Docked-pose 3D overlay — needs an unbuilt backend pose endpoint. (Receptor-only viewer
  IS in scope, client-side from RCSB.)
- Auth / real wallet connect.

---

## 11. Env / deployment

- `BACKEND_BASE_URL` — server-only Vercel env var (tunnel URL or `http://localhost:8000`).
- Never expose backend URL or any secret as `NEXT_PUBLIC_*`.
- Local dev: `.env.local` with `BACKEND_BASE_URL=http://localhost:8000`, `next dev`; mock
  via `node mock/mock-server.js` (optionally `MOCK_SPEED=0.3` for fast lifecycle iteration).
- Vercel: set `BACKEND_BASE_URL` to the tunnel URL in project settings.

---

## 12. Backend changes to request (tracked, not blocking v1)

Per handoff §10 — flag to the backend session but do not block on:
1. `GET /jobs` list endpoint (for the optional history view).
2. Pose file endpoint (only if the docked-pose overlay is later pursued).
3. Confirm job dispatch model (auto-on-submit vs explicit `POST /jobs/<id>/run`) and align
   the status page accordingly.
