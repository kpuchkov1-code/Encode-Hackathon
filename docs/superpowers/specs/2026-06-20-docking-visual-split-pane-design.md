# Docking visual — split structure pane (buyer console)

**Date:** 2026-06-20
**Status:** built

## Goal

Show the docking "as it happens": split the buyer console's structure pane vertically. The top
half keeps the existing PDB receptor viewer; the bottom half shows the docking candidate in the
binding pocket, driven by live job state.

## Constraint that shaped the design

The mock backend returns docking **scores** but no pose **geometry** (`LigandResult.pose_path` is
just a string). So a literal gnina pose can't be rendered yet. Decision (user-approved): render a
**real Mol\* 3D view** with a *representative* candidate placed at the **real pocket location**,
clearly captioned, and leave a zero-friction seam for the real backend to supply actual pose SDFs.

## Components

- **`lib/docking.ts`** (pure, no Mol\*):
  - `pocketCenterFromPdb(text)` — averages bound-ligand atoms (`HETATM`, non-water) to find the
    pocket; falls back to all-atom centroid. For 6LU7 this is the N3 inhibitor site.
  - `buildPoseSdf(center, seed)` — emits a valid V2000 SDF of a small drug-like fragment, rotated
    + jittered by `seed` (seed 0 = centred "best" pose; non-zero = scattered search candidates).
- **`lib/molstar.ts`** additions:
  - `addLigandSdf(plugin, sdf, focus)` — adds/replaces a cyan ball-and-stick candidate; one tracked
    `rawData` ref per plugin so a single delete clears the whole pose subtree (receptor untouched).
  - `clearLigand(plugin)`.
- **`components/console/DockingViewer.tsx`** — second headless Mol\* instance. Loads the receptor,
  then: `running` → spin + re-place candidate every 1.1 s (the search) + HUD pose counter;
  `docked`/`proven`/`settled` → settle on best pose, stop, focus, HUD shows real CNN affinity.
  Optional `poseSdf` prop overrides the synthetic generator.
- **`components/console/StructurePane.tsx`** — reads the active job (`useJobDraft` → `useJob` →
  `useResult`); when state ∈ {running, docked, proven, settled} it splits the viewer area into two
  equal flex rows (top `StructureViewer`, bottom `DockingViewer`). Idle = top viewer fills, as before.

## Data flow

`jobStore.jobId` → `useJob` (state) + `useResult` (best ligand) → `StructurePane` → `DockingViewer`.
Receptor coordinates come from `structureStore.text` (shared with the top viewer).

## Backend integration seam

Documented in `API_CONTRACT.md` (result section): return the top pose's SDF text as an optional
`pose_sdf` on `LigandResult`, or serve `GET /jobs/<id>/pose/<ligand_id>`. Pass it to `DockingViewer`
via `poseSdf` and the synthetic stand-in is bypassed — no other UI change.

## Out of scope (YAGNI)

Per-ligand pose switching, surface/pocket cavity rendering, RDKit SMILES→3D embedding, and live
coordinate streaming during the gnina run.
