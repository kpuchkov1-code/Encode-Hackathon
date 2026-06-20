# DockMarket — Frontend

Buyer-facing UI for the decentralized docking marketplace. Next.js 16 (App Router) +
TypeScript + Tailwind v4 + SWR + 3Dmol.js, deployed on Vercel. Codes to `../API_CONTRACT.md`.

Design spec: `../docs/superpowers/specs/2026-06-20-frontend-design.md`.

## Run locally

1. Start a backend on `:8000` — either the mock or the real one:
   ```bash
   # from repo root
   node mock/mock-server.js            # or: MOCK_SPEED=0.3 node mock/mock-server.js
   ```
2. Start the frontend:
   ```bash
   cd web
   npm install
   npm run dev                          # http://localhost:3000
   ```

`.env.local` sets `BACKEND_BASE_URL=http://localhost:8000`.

## How it talks to the backend

The browser only ever calls **same-origin `/api/*`**. `app/api/[...path]/route.ts` is a
server-side proxy that forwards to `BACKEND_BASE_URL`. This avoids CORS + mixed-content and
keeps the backend URL server-only. Swap mock → tunnel → real backend by changing one env var.

## Deploy to Vercel

1. Set the Vercel project **Root Directory** to `web`.
2. Add env var `BACKEND_BASE_URL` (server-only — NOT `NEXT_PUBLIC_*`):
   - A public tunnel of the WSL backend: `cloudflared tunnel --url http://localhost:8000`
     (or `ngrok http 8000`), then use the HTTPS URL it prints.
3. Deploy. Web Analytics is wired via `@vercel/analytics`.

## Structure

```
app/
  page.tsx              landing (greeting + suggestion cards)
  submit/page.tsx       job submission (form + live receptor preview)
  jobs/[id]/page.tsx    live job page (split-pane, progressive reveal)
  api/[...path]/route.ts  server-side proxy to BACKEND_BASE_URL
lib/
  types.ts              contract types (snake_case)
  api.ts                same-origin fetchers
  hooks.ts              SWR polling (stops on terminal state)
  presets.ts            sample + failure-case JobSpecs
components/             stepper, escrow, results, proof, 3D viewer, etc.
```

## Demo flow

`/` → "Run the sample screen" → `/submit` (pre-filled) → submit → `/jobs/<id>`:
pipeline animates `queued → running → docked → proven → settled`; escrow flips
`held → released`; results show `lig_active` outranking `lig_decoy`; proof panel shows the
SHA-256 manifest. The "Trigger a failure" card drives the `failed` + refund path.
