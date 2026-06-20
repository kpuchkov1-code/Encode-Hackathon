# Frontend Handoff — for the next Claude instance

**This is the build-state handoff for the `web/` frontend.** Read this first, then
`README.md` (run/deploy) and `../API_CONTRACT.md` (the backend boundary). The original
*design* brief is `../FRONTEND_HANDOFF.md`; the approved design spec is
`../docs/superpowers/specs/2026-06-20-frontend-design.md`.

`web/` **is the frontend folder.** It's a self-contained Next.js app.

---

## What this is

A **two-sided decentralized marketplace for bio-compute** (docking today; pitched for
folding/MD/screening too). Buyers submit molecular jobs that run on idle GPUs; providers
rent out hardware to earn. Payment settles on-chain (DeepBook), results carry cryptographic
proof (Walrus), and docking uses real gnina CNN scores. Product is currently branded
**"DockMarket" — this is a PLACEHOLDER name** (see Open threads).

## Current state: working end-to-end against the mock

Verified this session (headless screenshots + curl through the proxy):
- Buy flow: landing → submit (live 3D receptor) → live job page (stepper → results → proof).
- Sell flow: provider dashboard with real earnings + simulated node telemetry.
- Account menu (mock auth), settings page, video hero.
- `npm run build` is clean; all routes compile.

## Quick start

```bash
# 1. backend (mock) — from repo root
node mock/mock-server.js            # :8000  (MOCK_SPEED=0.3 for faster lifecycle)
# 2. frontend — from web/
npm install
npm run dev                         # :3000
```
`.env.local` already has `BACKEND_BASE_URL=http://localhost:8000` (server-only, gitignored).

## Architecture (don't relearn the hard way)

- **Proxy:** the browser only calls same-origin `/api/*`. `app/api/[...path]/route.ts`
  forwards server-side to `BACKEND_BASE_URL`. No CORS, no mixed-content, backend URL never
  reaches the client. Swap mock → tunnel → real backend via that ONE env var.
- **Polling discipline** (`lib/hooks.ts`): `useJob` polls every 1.5s and **stops on terminal
  state**; `useResult`/`useProof` stay `null` until the state gate opens (no 409 spam).
- **Two data tiers on the sell side:** earnings, job feed, market demand are **real**
  (derived from `GET /jobs` + escrow — the same ledger the buy side writes). Node specs,
  telemetry (utilization/reliability/DLPerf), and the "Run" action are **simulated and
  labelled**. Keep that honest split; it's the spine of the pitch.

## File map

```
app/
  page.tsx              role-chooser landing (video bg)
  buy/page.tsx          buyer home (pitch + sample cards)
  submit/page.tsx       → SubmitForm (Suspense-wrapped; useSearchParams)
  jobs/[id]/page.tsx    → JobView (server extracts id + ?pdb=, client polls)
  sell/page.tsx         → ProviderDashboard
  settings/page.tsx     cosmetic settings
  api/[...path]/route.ts  server-side proxy
lib/  types.ts (contract mirror) · api.ts · hooks.ts · presets.ts
components/  Nav, AccountMenu, ConnectionIndicator, SuggestionCard, SponsorBadge,
  PipelineStepper, EscrowPanel, ResultsTable, ProofPanel, ReceptorViewer, JobInfoBlock,
  Copyable, SubmitForm, JobView, ProviderDashboard
public/hero_loop.mp4   landing background video
shot.mjs               headless screenshot tool (see Gotchas)
```

## Gotchas learned this session (READ before editing)

1. **This is Next.js 16 + Tailwind v4 + React 19 — newer than training.** `params` and
   `searchParams` are **Promises** (`await` in server, `use()` in client). `RouteContext<...>`
   and `PageProps<...>` are **generated types** — plain `tsc` won't see them; run
   `npm run build` (or `next typegen`) to validate. There's an `AGENTS.md` telling you to read
   `node_modules/next/dist/docs/` before writing Next code — do it.
2. **Tailwind v4 is CSS-first.** No `tailwind.config.js`. Design tokens live in
   `app/globals.css` under `@theme`. Custom colors there: `background/surface/surface-2/
   border/foreground/muted/accent/accent-bright`. `.input` and animations also there.
3. **Turbopack dev stale-cache:** changing `next.config.ts` mid-session corrupts the dev
   manifest → pages 500 with "global-error.js … not in the React Client Manifest". Fix: stop
   `next dev`, kill any orphaned node procs running from `web/`, `rm -rf .next`, restart.
   (Production build is unaffected — it was clean throughout.)
4. **3Dmol receptor viewer** (`ReceptorViewer.tsx`): loads PDB straight from RCSB by id,
   client-side, in a dynamic `import("3dmol")` inside useEffect (SSR-unsafe otherwise).
   Smoothness = `antialias + upscale + ambientOcclusion`. Zoom clamp = `setZoomLimits(40,500)`
   (constants at top). **Use the DEFAULT cartoon** — overriding `style:"oval"`/`thickness`
   turns the protein into goofy spaghetti tubes. `FAIL` / <4-char ids render the idle state.
5. **Headless visual verification:** the browser-tools MCP connector isn't running, so use
   `node shot.mjs "<url>" out.png` (Playwright + WebGL flags) to screenshot any route and
   `Read` the PNG. PNG outputs and `shot_*.mjs` scratch scripts are gitignored.
6. **Video hero:** `public/hero_loop.mp4`, `<video autoPlay loop muted playsInline>` (muted
   is required for autoplay). A gradient scrim sits over it for text legibility.
7. **Mock test hook:** submit with `receptor.pdb_id === "FAIL"` → job goes `failed`, escrow
   `refunded`. Use it to exercise the error/refund UI.

## What's real vs mocked

- **Real (via mock/real backend):** job lifecycle, docking results, proof hashing, escrow.
- **Mocked in the UI:** auth (localStorage), provider node specs + telemetry + "Run",
  the hero stats numbers (128 GPUs / 3,412 jobs), wallet balance.

## Open threads / next steps

1. **NAME.** "DockMarket" is a placeholder (we pivoted from docking-only to bio-compute).
   Premium/serious direction chosen. Crucible/Codon/Forge are TAKEN by funded biotechs.
   Leading candidates: **Anneal** (DNA annealing + simulated annealing — on-theme) and
   **Reactor**. Run a WHOIS (.com/.io/.bio) + USPTO/Google conflict check before committing,
   then swap the name in `Nav.tsx`, `app/layout.tsx` metadata, and landing copy.
2. **Deploy to Vercel:** set project Root Directory = `web`; add `BACKEND_BASE_URL`
   (server-only) pointing at a `cloudflared`/`ngrok` tunnel of the WSL backend; deploy.
   `@vercel/analytics` is already wired.
3. **Real backend swap:** just point `BACKEND_BASE_URL` at it. Confirm the 🔜 `GET /jobs`
   list endpoint is live (the sell side needs it) and the job-dispatch model (auto vs
   explicit run) per `../SESSION_HANDOFF.md`.
4. **Optional polish:** poster frame for the hero video (faster first paint); a real
   `POST /jobs/<id>/claim` endpoint to make the sell-side "Run" genuine (currently simulated);
   `/jobs` history list view for buyers.

## Not yet done

- Frontend not yet deployed. Name not finalized. No real wallet/auth. Supply side is a
  convincing dashboard on real escrow data, not real GPU execution (by design — see the
  honest-framing note in the spec).
