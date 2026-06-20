# Mock backend

A zero-dependency Node server implementing `../API_CONTRACT.md` exactly, so the frontend
can be built **without the real backend running**. It also serves as the reference for
what the real backend must return.

## Run
```bash
node mock/mock-server.js
# faster lifecycle for quick UI iteration:
MOCK_SPEED=0.3 node mock/mock-server.js
# different port:
PORT=8001 node mock/mock-server.js
```
Listens on `http://localhost:8000`. Sends permissive CORS headers, so you can call it
directly from the browser during local dev (no proxy needed) OR through your Next.js
Route Handler proxy.

## What it does
- Implements every endpoint in `API_CONTRACT.md` (incl. the 🔜 `/result`, `/proof`, `/jobs` list).
- A submitted job advances `queued → running → docked → proven → settled` over ~10s
  (scaled by `MOCK_SPEED`), so polling/stepper UIs animate.
- Escrow flips `held → released` on settle.
- Results rank the bigger molecule higher (mirrors real aspirin > ethane); proof has real
  SHA-256 hashes derived from the submitted spec.

## Test hooks
- Submit with `receptor.pdb_id === "FAIL"` → the job goes to `failed` and escrow `refunded`,
  so you can build the error/refund UI.

## Wiring it into Next.js
Point your server-only env var at it:
```
# .env.local
BACKEND_BASE_URL=http://localhost:8000
```
Your Route Handlers (`app/api/.../route.ts`) fetch `${process.env.BACKEND_BASE_URL}/...`.
When the real backend is ready (or tunneled), just change `BACKEND_BASE_URL` — no UI changes.

## Keeping in sync
This file and `mock-server.js` implement `API_CONTRACT.md`. If the contract changes, update
the mock in the same PR so frontend and backend never drift.
