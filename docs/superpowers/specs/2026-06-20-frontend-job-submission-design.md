# Frontend Task — Job Submission Web App (design spec)

**Date:** 2026-06-20
**Status:** Defined for handoff; not built by the backend workstream
**Owner:** Kirill (frontend), built separately from `docking_marketplace.plain`
**Depends on:** the backend API contracts defined in
`2026-06-20-docking-vertical-slice-design.md` (Tasks 2, 6, 7 of the implementation plan)

This is a contract document, not a `.plain` spec — the frontend is a separate Next.js/
Vercel workstream (per the original platform architecture discussion), not authored
through Codeplain alongside the backend. Its purpose here is to pin down (a) the user
flow, (b) what the backend must expose for it to work, and (c) what's explicitly the
frontend's own responsibility, so the two workstreams don't drift apart.

## 1. User flow

1. **Upload protein** — user provides a PDB file (upload, or fetch-by-PDB-ID since the
   backend `:JobSpec:.receptor` already supports `pdb_id` OR `file`). The UI should show
   a cleaned/nicer view of the structure (e.g. a 3D viewer — Mol* or NGL.js — rendering
   the protein, with waters/heteroatoms-other-than-the-target stripped from the preview)
   rather than raw PDB text. This is a **preview/UX concern only** — see §3, the backend
   worker still does its own defensive cleaning regardless of what the client sends.
2. **Upload ligands** — user provides an SDF file containing the list of molecules to
   screen (maps to `:JobSpec:.ligands`, one entry per molecule).
3. **Cost estimate** — before payment, the app requests an estimate from the backend
   (see §2, new endpoint) based on ligand count and docking params, and displays it.
4. **Payment** — user connects a Sui wallet and pays the estimated amount, which funds
   the job's escrow hold (backed by real DeepBook from Task 6 of the backend plan).
   Exact flow (does the frontend sign a transaction directly against the DeepBook pool,
   or does it pay an address and the backend places the order server-side once payment
   lands?) is an **open integration question to settle once backend Task 6 exists** —
   don't build against assumptions here that Task 6 hasn't confirmed yet.
5. **Submit job** — once payment is confirmed, the app assembles the `:JobSpec:` JSON
   (receptor + ligands + box + params + payment reference) and `POST /jobs`.
6. **Track status** — the app polls `GET /jobs/{id}` for state, then once available,
   `GET /jobs/{id}/result` (ranked ligands + scores) and `GET /jobs/{id}/proof` (the
   execution proof manifest) per Task 7 of the backend plan.

## 2. Backend contract the frontend depends on

Existing (per the backend plan):
- `POST /jobs`, `GET /jobs/{id}` — Task 2.
- `GET /jobs/{id}/escrow` — Task 3.
- `GET /jobs/{id}/result`, `GET /jobs/{id}/proof` — Task 7.

**New, not yet in the backend plan — required by step 3 above:**
- `POST /jobs/estimate` — takes a partial job description (ligand count, `params`,
  optionally the receptor) and returns `{"amount": <number>, "currency": <string>}`
  *without* creating a job or holding escrow. This needs to be added to the backend
  `.plain` spec (smallest natural home: alongside Task 2, since it only needs
  `:JobSpec:`-shaped input and no state machine). Flagging here so it doesn't get
  missed — add it before the frontend needs to integrate against it.

## 3. What's the frontend's job vs. the backend's job

- **PDB "cleaning" / nice preview**: frontend-only concern, for UX. It must not be the
  *only* place cleaning happens — the backend worker (Task 4) already strips to protein
  atoms before receptor prep regardless of what the client uploaded, because the backend
  can't trust client-side processing for something that feeds a real docking run.
- **Cost estimate math**: lives server-side (`POST /jobs/estimate`) so pricing logic has
  one source of truth, not duplicated in the frontend.
- **Payment / wallet integration**: frontend's responsibility to build, but the
  semantics (what "paid" means, what address/pool it goes to) are defined by the
  backend's real Escrow implementation (Task 6) — frontend follows that contract, not
  the other way around.
- **Confidentiality disclosure**: per design spec §11.2, this v1 makes no cryptographic
  confidentiality guarantee to the user — whoever runs the docking worker can see the
  plaintext protein/ligand data. The frontend should surface this plainly (e.g. in the
  upload flow or ToS) rather than implying the target is private. Don't silently drop
  this just because it's an awkward thing to put in a UI.

## 4. Out of scope for this doc

Provider/supplier-side UI (e.g. a dashboard for someone offering idle hardware) is not
covered here — this spec is only the job-submission side. It can be added later if/when
backend Task 8 (separate worker dispatch) makes a real supplier role meaningful.
