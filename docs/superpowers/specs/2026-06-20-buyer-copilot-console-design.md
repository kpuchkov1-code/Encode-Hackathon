# Frontend Design — Buyer Copilot Console (Amina-inspired)

**Date:** 2026-06-20
**Status:** Approved (brainstorming complete)
**Supersedes (buyer surface only):** `2026-06-20-frontend-design.md` §5–6 routes `/buy`, `/submit`,
`/jobs/[id]` are replaced by a single copilot console. The seller side (`/sell`), the integration
architecture, the API contract, and the data layer are **unchanged** and carried forward verbatim.

This spec codes against the frozen `API_CONTRACT.md` and is built/iterated against
`mock/mock-server.js` until the real backend is tunnelled in via one env var.

---

## 1. Goal

Replace the buyer-side wizard + status flow with an **AI copilot console** modelled on
AminoAnalytica's Amina: a 3-pane workspace (files · chat · interactive structure viewer) where a
lab loads a structure, selects a binding pocket visually, and submits/watches/inspects a real
gnina docking job — all driven by natural-language chat over the **existing** marketplace backend.

**Primary success criterion:** a single live clickthrough — *load 6LU7 → select pocket residues
(highlight orange) → "dock aspirin vs a decoy here" → confirm the auto-filled job panel → watch the
pipeline/escrow/results/proof cards stream into chat* — works end-to-end on a deployed Vercel URL
against the mock (and later the real/tunnelled backend) with no code changes.

**Non-goal:** rebuilding backend logic. The chat is a natural-language *front-end* to the same
`POST /jobs` + polling endpoints. Deterministic marketplace behaviour is untouched.

---

## 2. Stack (unchanged from prior spec, plus the assistant)

- **Next.js 14 (App Router) + TypeScript**, **Tailwind + shadcn/ui**, **SWR** (polling),
  **framer-motion**, **3Dmol.js**. Fonts: geometric sans for UI, monospace for machine values.
- **Assistant brain:** Claude via the **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`), model string
  e.g. `anthropic/claude-sonnet-4.6`. Always `curl https://ai-gateway.vercel.sh/v1/models` to
  confirm the live model id; never trust a memorised id.
- **Agent loop:** server-side tool-calling loop in `app/api/chat/route.ts` (streamed).
- **Web search tool backend:** **Exa** API (`EXA_API_KEY`), plus no-key RCSB/UniProt lookups.

---

## 3. Visual direction

Carries the prior spec's AminoAnalytica dark-technical language (near-black `~#0A0A0B` canvas,
elevated surfaces `~#141416`, single restrained **blue** accent `~#3B82F6`, monospace for all
machine values, subtle motion, structural-instrument tone — not crypto-casino). **One addition:
orange (`~#F59E0B`) is the dedicated residue-selection / highlight colour**, mirroring Amina's
selected-residue treatment. Orange is used *only* for structure selection, never for status.

---

## 4. Integration architecture (unchanged — from prior spec §4)

```
Browser ──(same-origin)──▶ /api/<path>   (Next.js Route Handler on Vercel)
                                │ server-side fetch
                                ▼
                         BACKEND_BASE_URL  ──▶ Flask backend (or mock)
```

- Single catch-all proxy `app/api/[...path]/route.ts` forwards to `${BACKEND_BASE_URL}/<path>`.
- Browser only ever calls same-origin `/api/*` → no CORS, no mixed content.
- `BACKEND_BASE_URL` is **server-only**. Swap mock → tunnel → real backend via one env var.
- **New sibling route** `app/api/chat/route.ts` (the agent loop) sits alongside the proxy; it may
  itself call the proxy/backend server-side when executing the `submit_job`/status tools.

---

## 5. Routes (buyer side)

| Route | Purpose |
|---|---|
| `/` | Role-chooser landing (unchanged): "I need compute" → `/console`, "I have GPUs" → `/sell`. |
| `/console` | **The copilot console** — 3-pane workspace. Replaces `/buy`, `/submit`, `/jobs/[id]`. |
| `/sell` | Provider dashboard (unchanged — see prior spec §6b). |

A job is addressable as `/console?job=<id>` so a run is shareable/resumable; the console rehydrates
chat + viewer + lifecycle cards from the job id.

---

## 6. The console layout (3-pane)

```
┌─ FILES ─────────┬─ COPILOT CHAT ──────────────┬─ STRUCTURE / JOB ────────┐
│ ⬆ upload / drop │  assistant ▸ "Loaded 6LU7.   │  [ PDB ID: 6LU7  ▶ ⟳ ⤓ ◉]│
│ ☑ give access   │   220 res · cleaned 154 H2O" │      ╭─ 3D viewer ─╮      │
│  ▸ 6LU7.pdb     │  ┌ JOB PANEL (hybrid) ─────┐ │      │ ribbons +    │      │
│  ▸ ligands.smi  │  │ receptor 6LU7        ✓  │ │      │ orange sel   │      │
│                 │  │ ligands  2 · edit       │ │      ╰──────────────╯      │
│                 │  │ pocket   A:140-145 ✓sel │ │   seq: …I V G G Y…        │
│                 │  │ payment  100 · node-1   │ │   ▓▓ selected → orange    │
│                 │  │ [ Run screen ▶ ]        │ │   sel: A:140-145          │
│                 │  └─────────────────────────┘ │                          │
│                 │  ▸ stepper·escrow·results·   │  (right pane stays the    │
│                 │    proof  (inline cards)     │   structure; lifecycle    │
│ ───────────────┤  [ Files | Tools | 🌐 Web ]  │   streams into chat ◀ )   │
│                 │  > message…              ▲  │                          │
└─────────────────┴──────────────────────────────┴──────────────────────────┘
```

- **Left — FilesPanel:** drag/drop + picker upload; file list with per-file **"give assistant
  access" checkboxes** (Amina pattern). Accepts `.pdb`, `.smi`/`.txt` SMILES lists, `.sdf`. Files
  are held client-side and passed into chat context only when checked.
- **Centre — ChatThread:** assistant/user turns, **inline rich cards** (job panel, pipeline
  stepper, escrow, results table, proof), and the input bar with **Files / Tools / Web** toggles
  (the toggles from the reference screenshot). Tools = the callable-tool menu; Web = web-search mode.
- **Right — StructurePane:** the upgraded `ReceptorViewer` (clickable residues, orange highlight,
  linked sequence strip, selection summary) — persistent; this is always the structure.

`★ Why lifecycle-as-chat-cards:` replacing the status page means the conversation *is* the
timeline. `PipelineStepper`, `EscrowPanel`, `ResultsTable`, `ProofPanel` are rewrapped as
chat-embedded cards updated by the existing SWR hooks — minimal logic discarded.

---

## 7. Assistant architecture — server-side tool-calling loop

`app/api/chat/route.ts` runs an agent loop: Claude (via AI Gateway) emits `tool_use` → we execute →
feed `tool_result` back → repeat until a final text turn. Responses stream to the client.

### Tool catalogue (split by execution location)

| Tool | Runs | Implementation |
|---|---|---|
| `fetch_structure(pdb_id)` | server | download from RCSB; return summary (chains, residue count) |
| `clean_structure(file_ref)` | **server (JS)** | strip `HETATM`/`HOH`/alt-locs/ligand records, renumber; return a removed-items report. **No Python.** |
| `submit_job(spec)` | server | validate against `JobSpec`, call existing `POST /jobs`, return `job_id` |
| `get_job_status / get_result / get_proof(id)` | server | existing proxy endpoints |
| `web_search(query)` | server | Exa API (`EXA_API_KEY`); returns titled snippets + links |
| `lookup_pdb / lookup_uniprot(query)` | server | free structured lookups (RCSB/UniProt) — work with no key |
| `highlight_residues(sel, color?)` | **client** | model directive applied to the 3Dmol viewer (default orange) |
| `set_pocket(sel)` | **client** | compute box centre/size from a residue selection; write into JobPanel |

### Client-executed tools (the one non-obvious pattern)

`highlight_residues` and `set_pocket` touch the live WebGL viewer, so they can't run in the server
loop. Pattern: when the loop emits one of these, the route **returns the `tool_use` to the client**;
the client executes it against 3Dmol/JobPanel and **posts the `tool_result` back** to continue the
loop. The reverse direction needs no tool: a **user** selection in the viewer is injected into chat
context as state (`current_selection: "A:140-145"`), which the model reads for `set_pocket`.

### Hybrid submit (from the approved decision)

`submit_job` does **not** fire silently. The model fills a visible, editable **JobPanel** card
(receptor, ligands, pocket, params, payment); the user reviews/tweaks and clicks **Run** to confirm,
which is what actually calls `POST /jobs`. The model can pre-validate but never auto-submits without
the explicit Run. This is the demo-safety guarantee.

---

## 8. The differentiator: residue selection ↔ docking pocket

- **Viewer → science:** click/drag residues in 3D **or** the sequence strip → they highlight
  **orange** (Amina-exact) → the selection auto-populates the JobPanel `pocket` field → becomes
  `box.center`/`box.size` in the submitted `JobSpec`. Selecting *where the drug should bind*,
  visually, then docking there.
- **Chat → viewer:** "highlight residues 140–145" / "show the active site" → `highlight_residues`
  → orange in both 3D and sequence.
- 3Dmol natively supports clickable atoms (`setClickable`) and per-selection styling; the
  sequence↔structure link is a standard linked-selection pattern. Selection state lives in a shared
  store (`useSelection`) consumed by viewer, sequence strip, and JobPanel.

### Box derivation

`set_pocket` computes an axis-aligned box from selected residue atom coordinates: centre = centroid,
size = bounding box + padding (default 8 Å). If the backend `box` shape only supports
`autobox_ligand`, fall back to sending the selection as a residue list and note the box mode in the
JobPanel; otherwise send explicit `center`/`size`. (Confirm `box` shape against `API_CONTRACT.md` at
build time; do not block the UI on it.)

---

## 9. Data layer (unchanged + additions)

- Keep `lib/types.ts`, `lib/api.ts`, `lib/hooks.ts` (SWR polling: `useJob`, `useEscrow`,
  `useResult`, `useProof`, `useHealth`) exactly as built — they drive the inline lifecycle cards.
- **Add** `lib/chat.ts` (client transport for `/api/chat`, streaming + client-tool round-trip),
  `lib/tools.ts` (tool schemas/JSON-schema definitions shared client/server), `lib/structure.ts`
  (PDB parse, clean, residue/sequence extraction, box math), `lib/selection.ts` (`useSelection`
  store).

---

## 10. Components

**Keep (rewrap as chat cards):** `PipelineStepper`, `EscrowPanel`, `ResultsTable`, `ProofPanel`,
`SponsorBadge`, `ConnectionIndicator`, `SuggestionCard`.

**Upgrade:** `ReceptorViewer` → clickable residues + orange highlight + linked **SequenceStrip** +
selection summary + (existing) zoom clamp/spin/reset.

**New:**
- `ConsoleShell` — 3-pane responsive layout (collapsible side panes, like the reference).
- `ChatThread` + `ChatMessage` + `ChatInput` (Files/Tools/Web toggles).
- `ToolCallCard` — renders a tool invocation + result inline (e.g. "cleaned structure: −154 H₂O").
- `JobPanel` — the hybrid editable JobSpec card with **Run**.
- `FilesPanel` + `FileRow` (access checkbox).
- `SequenceStrip` — monospace residue letters, orange on selection, scroll-synced to viewer.
- `MessageCards` — wrappers that mount the kept lifecycle components inside chat turns.

---

## 11. Sponsor surfacing (carried forward — judge-visibility)

- **DeepBook (Sui):** EscrowPanel card — `held → released/refunded`, amount, supplier.
- **Walrus (Sui):** ProofPanel card — `manifest_sha256` hero, hash list, `storage_blob_id`, Verify.
- **gnina:** ResultsTable card — real `cnn_affinity`/`cnn_score`/`vina_affinity`.
- **Solvimon:** "marketplace take-rate (15%)" line on the escrow card.
- **Vercel:** Route Handler proxy + **AI Gateway** for the assistant + SWR + clean deploy.

---

## 12. Build phases (implementation order)

1. **Console shell + viewer upgrade** — 3-pane `ConsoleShell`; `ReceptorViewer` gains clickable
   residues, orange highlight, `SequenceStrip`, `useSelection`. *(Visible win, no AI yet.)*
2. **Chat + agent loop** — `app/api/chat/route.ts`, AI Gateway tool-calling, streaming,
   `ChatThread`/`ChatInput`.
3. **Server tools + hybrid submit** — `fetch_structure`, `clean_structure`, `submit_job`,
   status/result/proof; `JobPanel`; lifecycle cards mounted inline via existing SWR hooks.
4. **Client tools + pocket** — `highlight_residues`, `set_pocket`, selection→box, client round-trip.
5. **Files panel + search** — upload/drag + access checkboxes; `web_search` (Exa) + RCSB/UniProt
   lookups; Tools/Web toggles wired.

Each phase is independently demoable; if time runs out, phases 1–3 alone are a complete story.

---

## 13. Decisions locked

- **Clean PDB = JS-level** stripping for v1 (waters/HETATM/alt-loc/ligand records + removed report).
  pdbfixer-grade (missing atoms/H, Python backend endpoint) is a **deferred** upgrade, not built now.
- **Web search = Exa** (`EXA_API_KEY`) for general queries, **plus** no-key RCSB/UniProt structured
  lookups so the assistant is useful before any key is set.
- **Assistant brain = Claude via Vercel AI Gateway** (API, not a local model): native tool-calling,
  zero infra, no GPU contention with gnina; molecules stay local for docking, so the privacy/proof
  story is unaffected.
- **Submit is hybrid** (chat fills an editable JobPanel; explicit Run confirms) — never auto-submit.

---

## 14. Out of scope (YAGNI for v1)

- Local LLM hosting; pdbfixer-grade cleaning; docked-pose 3D overlay (needs unbuilt backend pose
  endpoint — receptor-only viewer is in scope); auth / real wallet connect; multi-conversation
  history / persistence beyond the current `?job=<id>` rehydration.

---

## 15. Env / deployment (additions to prior spec §11)

- `BACKEND_BASE_URL` — server-only (proxy + tools target).
- `AI_GATEWAY_API_KEY` — server-only (assistant brain).
- `EXA_API_KEY` — server-only (web_search; optional — lookups degrade gracefully without it).
- Never expose any of these as `NEXT_PUBLIC_*`. Local dev: `.env.local`; Vercel: project env vars.
