# Buyer Copilot Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. This is a visual Next.js build; verification is `next build` + screenshots, not unit-TDD for WebGL/chat UI.

**Goal:** Replace the buyer-side wizard/status flow with an Amina-style 3-pane AI copilot console (files · chat · interactive structure viewer) over the existing marketplace backend.

**Architecture:** New `/console` route hosting a 3-pane shell. The chat is a tool-calling layer (Claude via Vercel AI Gateway in `app/api/chat/route.ts`) over the existing `/api/*` proxy. Lifecycle UI is rendered as inline chat cards reusing existing components + SWR hooks. The 3Dmol viewer gains clickable residues that highlight orange and feed the docking pocket.

**Tech Stack:** Next 16, React 19, Tailwind v4, SWR, framer-motion, 3dmol ^2.5.5, Vercel AI Gateway (REST, OpenAI-compatible), Exa (web search).

## Global Constraints

- Next 16.2.9 / React 19.2.4 — route handlers use async `ctx.params` with `RouteContext<...>`; `"use client"` for any browser/3Dmol/state code.
- Tailwind v4 theme tokens only (`bg-background`, `bg-surface`, `bg-surface-2`, `border-border`, `text-foreground`, `text-muted`, `text-accent`, `accent-bright`). Add `--color-select: #f59e0b` for residue selection — orange is selection-only, never status.
- Monospace (`font-mono`) for all machine values (job_id, sha256, SMILES, scores, residue ids).
- All backend calls go through same-origin `/api/*`. Secrets server-only — never `NEXT_PUBLIC_*`. New env: `AI_GATEWAY_API_KEY`, `EXA_API_KEY` (optional), existing `BACKEND_BASE_URL`.
- AI Gateway model id: resolve at runtime from `AI_GATEWAY_MODEL` env (default `anthropic/claude-sonnet-4.6`); never hardcode elsewhere. Endpoint base `https://ai-gateway.vercel.sh/v1`.
- Reuse, don't rebuild: keep `lib/api.ts`, `lib/hooks.ts`, `lib/types.ts`, `PipelineStepper`, `EscrowPanel`, `ResultsTable`, `ProofPanel`, `SponsorBadge`, `ConnectionIndicator`.
- No em dashes in user-facing copy.

---

## File Structure

**New:**
- `app/console/page.tsx` — server wrapper, renders `<ConsoleShell>`.
- `components/console/ConsoleShell.tsx` — 3-pane responsive layout + collapse state.
- `components/console/FilesPanel.tsx` + `FileRow.tsx` — upload/drag, access checkboxes.
- `components/console/ChatThread.tsx`, `ChatMessage.tsx`, `ChatInput.tsx`, `ToolCallCard.tsx`.
- `components/console/JobPanel.tsx` — hybrid editable JobSpec card + Run.
- `components/console/StructurePane.tsx` — wraps the upgraded viewer + sequence strip + selection summary.
- `components/console/SequenceStrip.tsx` — monospace residue letters, orange on selection.
- `components/console/cards/*` — thin wrappers mounting existing lifecycle components inside chat turns.
- `lib/structure.ts` — PDB parse (chains/residues/sequence), JS clean, box math from selection.
- `lib/selection.ts` — `useSelection` shared store (Zustand-free, React context).
- `lib/files.ts` — `useFiles` store (uploaded files + access flags).
- `lib/chat.ts` — client transport for `/api/chat` (stream + client-tool round-trip), message types.
- `lib/tools.ts` — shared tool JSON-schemas + types (client+server).
- `app/api/chat/route.ts` — server agent loop (AI Gateway tool-calling).
- `lib/server/tools.server.ts` — server tool executors (fetch/clean/submit/status/result/proof/search/lookup).

**Modify:**
- `app/globals.css` — add `--color-select`, an orange selection token + pulse if needed.
- `components/ReceptorViewer.tsx` — add clickable residues, orange highlight, selection wiring (or fold into StructurePane).
- `components/Nav.tsx` — point "Buy" at `/console`.
- `app/page.tsx` — role card "Pay for compute" href `/buy` → `/console`.
- `.env.local` — add `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`, `EXA_API_KEY` placeholders.

**Kept untouched:** `app/api/[...path]/route.ts`, `lib/api.ts`, `lib/hooks.ts`, `lib/types.ts`, lifecycle components, `/sell`.

---

## Phase 1 — Console shell + interactive viewer (visible win, no AI)

### Task 1.1: Selection token + selection store
- [ ] Add `--color-select: #f59e0b;` to `@theme inline` in `globals.css`.
- [ ] Create `lib/selection.ts`: React context store `{ selected: Set<string>, toggle, set, clear }` keyed by `"<chain>:<resi>"`; helper `summarize(selected): string` → e.g. `"A:140-145, A:150"` (collapse runs). Provider `SelectionProvider`, hook `useSelection`.
- [ ] Verify: `npx tsc --noEmit` clean.
- [ ] Commit: `feat(console): selection store + orange token`.

### Task 1.2: PDB parsing + structure utils
- [ ] Create `lib/structure.ts`:
  - `parsePdb(text): { chains: {id, residues: {resi, resn, oneLetter}[]}[] }` (ATOM records, CA per residue, 3→1 letter map).
  - `cleanPdb(text): { cleaned: string, removed: {waters:number, hetatms:number, altlocs:number} }` (drop `HOH`, non-protein `HETATM`, keep altloc A).
  - `boxFromSelection(text, selected: Set<string>, padding=8): { center:[n,n,n], size:[n,n,n] } | null` (centroid + bbox of selected residues' atoms).
- [ ] Verify: small Node script asserts `parsePdb` on `fixtures/receptor.pdb` returns ≥1 chain and a sequence; active-site box is non-null for a known selection. `npx tsc --noEmit` clean.
- [ ] Commit: `feat(console): pdb parse/clean/box utilities`.

### Task 1.3: Upgrade viewer — clickable residues + orange highlight
- [ ] In `ReceptorViewer.tsx` (consumed by StructurePane): after model load, `setClickable({}, true, cb)` mapping picked atom → `chain:resi`; on click `toggle()` in selection store. Re-style selected residues with `{cartoon:{color:'#f59e0b'}}` + stick, base cartoon stays blue. Re-apply styles on selection change via an effect reading `useSelection`.
- [ ] Keep zoom clamp/spin/reset. Add a "Clear" control when selection non-empty.
- [ ] Verify: screenshot — clicking residues turns them orange in 3D.
- [ ] Commit: `feat(console): clickable residues highlight orange`.

### Task 1.4: SequenceStrip (linked selection)
- [ ] Create `SequenceStrip.tsx`: render per-chain monospace one-letter sequence in residue-numbered rows; each letter is a button; selected → orange bg (`bg-select/90 text-black`); click toggles selection store (same keys as viewer). Selection summary line `A:140-145` below.
- [ ] Verify: selecting in sequence highlights viewer and vice-versa (shared store).
- [ ] Commit: `feat(console): sequence strip linked to 3D selection`.

### Task 1.5: ConsoleShell + StructurePane + /console route
- [ ] `StructurePane.tsx`: PDB-ID input (default 6LU7) + `ReceptorViewer` + `SequenceStrip` + selection summary, fetches/parses PDB once, shares text with box math.
- [ ] `ConsoleShell.tsx`: 3-column grid (FilesPanel placeholder | center placeholder | StructurePane), collapsible side panes (chevron toggles), responsive (stack on < lg). Wrap in `SelectionProvider` + `FilesProvider`.
- [ ] `app/console/page.tsx` renders shell. Repoint Nav "Buy" + landing card to `/console`.
- [ ] Verify: `next build` clean; screenshot the 3-pane at `/console`.
- [ ] Commit: `feat(console): 3-pane shell + structure pane + /console route`.

---

## Phase 2 — Chat + agent loop

### Task 2.1: Tool schemas + message types
- [ ] `lib/tools.ts`: export `TOOL_DEFS` (OpenAI-format `tools` array) for `fetch_structure`, `clean_structure`, `submit_job`, `get_job_status`, `get_result`, `get_proof`, `web_search`, `lookup_pdb`, `highlight_residues`, `set_pocket`. Tag each with `runsOn: 'server'|'client'`. Export `ChatMessage`, `ToolCall`, `ToolResult` types.
- [ ] Commit: `feat(console): tool schemas + chat message types`.

### Task 2.2: Server agent loop
- [ ] `lib/server/tools.server.ts`: executor map for server tools. `fetch_structure` (RCSB), `clean_structure` (via `lib/structure`), `submit_job`/status/result/proof (fetch `${BACKEND_BASE_URL}/...`), `web_search` (Exa REST; if no `EXA_API_KEY` return `{note:"search disabled"}`), `lookup_pdb` (RCSB REST search).
- [ ] `app/api/chat/route.ts`: POST receives `{messages}`. Loop: call gateway `/chat/completions` with `TOOL_DEFS`; if response has server `tool_calls`, execute, append tool results, re-call; if a **client** tool call appears, stop and return `{type:'client_tool', tool_call, messages}` for the browser to execute; else return `{type:'message', content, messages}`. Cap 6 iterations.
- [ ] Verify: with a dummy key absent, route returns a clear 500 JSON (`ai gateway key missing`); shape compiles. `next build` clean.
- [ ] Commit: `feat(console): server-side agent loop over AI gateway`.

### Task 2.3: Chat UI + transport
- [ ] `lib/chat.ts`: `sendChat(messages)` → POST `/api/chat`; on `client_tool` response, dispatch to a registered client-tool handler (`highlight_residues`→selection store, `set_pocket`→job panel), append the tool result, re-POST to continue. Returns final assistant message.
- [ ] `ChatThread.tsx` + `ChatMessage.tsx` + `ChatInput.tsx` (with Files/Tools/Web toggle buttons matching the reference). `ToolCallCard.tsx` renders tool name + compact result.
- [ ] Mount in `ConsoleShell` center pane. Seed greeting + suggestion cards (reuse `SuggestionCard`).
- [ ] Verify: screenshot chat pane; typing echoes a turn (live model optional, gated on key).
- [ ] Commit: `feat(console): chat thread + client transport + tool cards`.

---

## Phase 3 — Hybrid submit + lifecycle cards

### Task 3.1: JobPanel (hybrid)
- [ ] `JobPanel.tsx`: editable fields receptor (from StructurePane PDB ID), ligands (rows id+smiles, "load sample"), pocket (from selection summary; `boxFromSelection` or `autobox_ligand` fallback), params (advanced), payment (amount + supplier select). `Run` builds a `JobSpec` and calls `createJob` (existing `lib/api`), then sets `?job=<id>`.
- [ ] The chat `submit_job`/`set_pocket` client handlers patch this panel's state rather than auto-submitting.
- [ ] Verify: manual Run against mock creates a job, URL gets `?job=`.
- [ ] Commit: `feat(console): hybrid editable job panel + run`.

### Task 3.2: Lifecycle cards inline
- [ ] `components/console/cards/`: `StepperCard`, `EscrowCard`, `ResultsCard`, `ProofCard` mounting existing `PipelineStepper`/`EscrowPanel`/`ResultsTable`/`ProofPanel`, driven by `useJob/useEscrow/useResult/useProof` from the `?job=` id. They render in the chat thread once a job exists, revealing per state (existing `stateReached`).
- [ ] Rehydrate console from `?job=<id>` on load.
- [ ] Verify (against mock, `MOCK_SPEED=0.3`): submit → cards stream queued→…→settled; results show active>decoy; proof hash shows.
- [ ] Commit: `feat(console): inline lifecycle/escrow/results/proof cards`.

---

## Phase 4 — Client tools wiring (pocket + highlight)

### Task 4.1: Client tool handlers
- [ ] Register `highlight_residues(sel,color?)` → parse selection expr (`A:140-145`) into keys → set selection store (orange). `set_pocket(sel)` → `boxFromSelection` → patch JobPanel pocket.
- [ ] Selection state injected into each `/api/chat` request as a system note (`current_selection: "A:140-145"`) so the model can call `set_pocket` without args.
- [ ] Verify: "highlight residues 140 to 145" turns them orange; "dock here" fills pocket from current selection.
- [ ] Commit: `feat(console): client-executed viewer tools (highlight, set_pocket)`.

---

## Phase 5 — Files panel + web search

### Task 5.1: Files store + panel
- [ ] `lib/files.ts`: `useFiles` store (name, kind, text, accessGranted). `FilesPanel.tsx` + `FileRow.tsx`: drag/drop + picker, accept `.pdb/.smi/.txt/.sdf`, per-file access checkbox (Amina pattern). A `.pdb` upload loads into StructurePane; a `.smi/.txt` loads ligand rows into JobPanel.
- [ ] Checked files' text is appended to chat context server-side.
- [ ] Verify: drop a PDB → renders in viewer; checkbox toggles access.
- [ ] Commit: `feat(console): files panel with upload + access checkboxes`.

### Task 5.2: Web/Tools toggles live
- [ ] Wire ChatInput "Web" toggle → adds `web_search` preference to the request; "Tools" → opens a small menu listing available tools (informational). Exa executor returns titled snippets; `lookup_pdb` always available.
- [ ] Verify: with `EXA_API_KEY`, "search recent Mpro inhibitors" returns links; without it, graceful note.
- [ ] Commit: `feat(console): web search + tools toggle wired`.

---

## Self-Review

- **Spec coverage:** files panel (5.1), residue-select-orange (1.3/1.4), tools+web (5.2/2.x), clean-PDB-as-tool (2.2 + `lib/structure`), hybrid submit (3.1), residue→pocket (4.1), lifecycle-as-chat-cards (3.2), AI-Gateway brain (2.2). All spec sections map to a task.
- **Placeholder scan:** none; each task names exact files + the function signatures it must produce.
- **Type consistency:** selection keys are `"<chain>:<resi>"` everywhere (1.1/1.3/1.4/4.1); `JobSpec`/`Box` reuse `lib/types.ts`; box shape `{center,size}` matches the `Box` union.

## Execution

Inline execution this session (per user request to build now + direct-execution preference for visual frontend). Build phase-by-phase, `next build` + screenshot per phase, commit each task.
