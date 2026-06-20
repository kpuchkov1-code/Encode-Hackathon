# Copilot Console — Handoff

The buyer side is now an **Amina-style 3-pane AI copilot console** at `/console` (replaces
`/buy`+`/submit`+`/jobs`). Spec: `docs/superpowers/specs/2026-06-20-buyer-copilot-console-design.md`.
Plan: `docs/superpowers/plans/2026-06-20-buyer-copilot-console.md`.

## What works (verified)
- 3-pane shell (files · chat · structure), collapsible panes.
- **Interactive viewer:** click residues in 3D OR the sequence strip → highlight **orange**;
  shared selection drives both + the docking pocket. (Screenshot-verified.)
- File upload (drag/drop) with per-file "give assistant access" checkboxes; a `.pdb` loads
  into the viewer.
- Hybrid **JobPanel**: editable spec, **Run** is the only thing that calls `POST /jobs`;
  inline stepper/escrow/results/proof via existing SWR hooks; rehydrates from `?job=<id>`.
- `/api/chat` agent loop fails gracefully without a key (no crash).
- `next build` clean; `tsc --noEmit` clean.

## What needs a key to go live (NOT yet end-to-end tested — no gateway key on this machine)
1. Set `AI_GATEWAY_API_KEY` in `web/.env.local` (Vercel AI Gateway).
   - First run: `curl https://ai-gateway.vercel.sh/v1/models -H "Authorization: Bearer $KEY"`
     and confirm `AI_GATEWAY_MODEL` (default `anthropic/claude-sonnet-4.6`) is live.
2. For the submit/status/result tools, run the backend or mock:
   `node mock/mock-server.js` (or tunnel the real WSL backend). `BACKEND_BASE_URL` already
   points at `http://localhost:8000`.
3. (Optional) `EXA_API_KEY` for `web_search`; without it `lookup_pdb` (RCSB, no key) still works.

## Tool split (architecture)
- **Server tools** (`app/api/chat/route.ts`): `get_job_status`, `get_result`, `web_search`,
  `lookup_pdb`.
- **Client tools** (`lib/clientTools.ts`, run in-browser via round-trip): `fetch_structure`,
  `clean_structure`, `highlight_residues`, `set_pocket`, `submit_job`. The live residue
  selection is injected into every chat request as context.

## Demo script once the key is in
"fetch 6LU7" → "clean it" → click pocket residues (orange) → "dock aspirin vs a decoy here"
→ JobPanel fills → **Run** → stepper/escrow/results/proof stream in. (Use `MOCK_SPEED=0.3`
for a fast lifecycle.)

## Notes / next
- The old `/buy`, `/submit`, `/jobs/[id]` pages still exist as fallback; safe to delete once
  the console is the agreed surface.
- pdbfixer-grade cleaning (add missing atoms/H) is deliberately deferred (JS-level only).
- `clean_structure` reloads the cleaned coords into the viewer; submitting still sends the
  receptor by `pdb_id` (backend re-fetches), so cleaning is currently a UI/inspection aid.
