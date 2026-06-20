# Seller (Provider) View — Functional Redesign

**Date:** 2026-06-20
**Scope:** `web/` frontend + `mock/mock-server.js` + `API_CONTRACT.md`. No Codeplain `.plain` changes.
**Goal:** Make the seller's view (`/sell`, `ProviderDashboard`) genuinely functional and demo-convincing, while keeping it trivially integrable with the real backend a teammate is building later.

## Problem

The seller view is a *passive observer*: it derives everything from buyer-side data
(`useJobsList` + `useEscrows`). Its core interaction — the **Run** button — is a no-op
that only adds a job id to a local `Set`. The mock auto-advances jobs the instant they are
submitted, so nothing the seller does is causal. Telemetry (`reliability: 99.4`,
`utilization: 73`) is static and invented.

## Design

### 1. Integration seam — `POST /jobs/<job_id>/run` (frozen contract)
A provider claims and starts a queued job. Added to `API_CONTRACT.md` as 🔜 (mock
implements now; real backend builds it — this is the backend handoff §8 option (a)).

```
POST /jobs/<job_id>/run
  body:  { "supplier_id": "node-1" }
  202 -> { "job_id": "...", "state": "running", "worker_id": "node-1" }
  409 -> { "error": "job not claimable (state=...)" }   # not queued / already taken
  404 -> { "error": "job not found" }
```

When the teammate ships this server-side, the UI needs **zero changes** — same
`BACKEND_BASE_URL` swap the project already uses. The browser calls same-origin
`/api/jobs/<id>/run`, the existing `[...path]` proxy forwards the POST verbatim.

### 2. Mock implementation (`mock/mock-server.js`)
- A submitted job stays **`queued`** until either:
  - (i) `POST /jobs/<id>/run` arrives → flips to `running` immediately and runs the
    ~8s advance chain (`running→docked→proven→settled`); or
  - (ii) an auto-run fallback timer fires (`MOCK_AUTORUN_MS`, default `1500`ms) so the
    **buyer-only demo still animates untouched**.
- `MOCK_AUTORUN_MS=0` disables the fallback → jobs wait for a seller to claim them. This
  is the **two-sided demo** setting that makes Run causal.
- Running a job sets `worker_id` and reassigns `escrow.supplier_id` to the claimer, so the
  seller's earnings attribute correctly.
- `FAIL` receptor path preserved (running → failed → refunded).

### 3. Client wiring
- `lib/types.ts`: `RunJobResponse { job_id; state; worker_id }`.
- `lib/api.ts`: `runJob(id, supplierId)` → `POST /api/jobs/${id}/run`.
- Run is optimistic: on success the row shows `running` immediately (overlay while the real
  state is still `queued`), then SWR polling converges. `409`/`404` surface inline per-row.

### 4. Pure derivation helpers (`lib/provider.ts`, new — unit-tested)
Keeps `ProviderDashboard` thin; these are the test targets.
- `deriveStats(jobs, escrows, nodeId)` → `{ earned, pending, completed, refunded, inFlight }`.
- `deriveReliability(completed, refunded)` → `released / (released + refunded)` %, or `null`.
- `deriveUtilization(inFlight, capacity)` → bounded %.
- `earningsBreakdown(gross, takeRatePct=15)` → `{ gross, fee, net }` (Solvimon take-rate).
- `cumulative(amounts)` + `sparklinePath(values, w, h)` → inline-SVG path (no chart dep).

### 5. UI changes (`ProviderDashboard.tsx` + 2 new components)
- **Real-derived reputation:** reliability + utilization computed from escrow/job data, not
  constants. GPU model / DLPerf stay, clearly labeled "simulated."
- **`EarningsBreakdown.tsx`:** full-width panel — gross → −15% Solvimon take-rate → net,
  with the cumulative-earnings sparkline. Surfaces Solvimon honestly with real math.
- **`JobProgress.tsx`:** compact 5-dot stepper, mirrors the buyer `PipelineStepper`, shown
  inline for jobs you're running. Visually fuses the two sides into one marketplace.
- **Sponsor settle moments:** a settled job you ran shows "released via DeepBook · proof on
  Walrus" (real escrow `released` + proof `storage_blob_id`).
- Run button: disabled when offline or request in-flight; inline error on `409`/`404`.

### 6. Error handling
- `409` already-claimed → inline "already taken," list refreshes.
- `404` → "job no longer available."
- proxy `502` (backend down) → existing `ConnectionIndicator`, Run disabled.
- node offline → Run disabled (existing).

### 7. Testing
Unit tests for `lib/provider.ts` pure helpers (stats, reliability, take-rate, sparkline).
Manual smoke: `MOCK_AUTORUN_MS=0 node mock/mock-server.js`, submit a job, confirm it stays
queued, click Run, watch it advance and earnings increment.

## Files
- `API_CONTRACT.md` — add `POST /jobs/<id>/run` (🔜), backend action item.
- `FRONTEND_HANDOFF.md` — §10 note the new endpoint.
- `mock/mock-server.js` — run endpoint + queued-dwell / auto-run fallback.
- `web/lib/types.ts`, `web/lib/api.ts` — `RunJobResponse`, `runJob`.
- `web/lib/provider.ts` (new) — derivation helpers.
- `web/components/JobProgress.tsx`, `web/components/EarningsBreakdown.tsx` (new).
- `web/components/ProviderDashboard.tsx` — wire it all.
- `web/lib/provider.test.ts` (new, if a runner is present) — helper unit tests.
