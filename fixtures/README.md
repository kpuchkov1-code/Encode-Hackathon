# Fixtures

These are **toolchain test fixtures only** (used to verify gnina + the docking
worker). They are NOT the demo workload — the demo target/ligands are chosen
later and the worker accepts any target + ligand set as parameters.

## Provenance / how to regenerate

Everything here is produced by `scripts/fixtures_and_smoke.sh`:

- `receptor_raw.pdb` — SARS-CoV-2 main protease, RCSB PDB **6LU7**
  (`wget https://files.rcsb.org/download/6LU7.pdb`).
- `receptor.pdb` — protein-only (ATOM records) split from the raw file.
- `ref_ligand.pdb` / `ref_ligand.sdf` — the co-crystal inhibitor (HETATM minus
  water), used as the gnina `--autobox_ligand` reference to define the pocket.
- `ligand_active.sdf` — aspirin (`CC(=O)Oc1ccccc1C(=O)O`), an arbitrary real
  small molecule used as a positive-control-style ligand, embedded to 3D via
  `obabel --gen3d`.
- `ligand_decoy.sdf` — ethane (`CC`), an obvious non-binder used to validate
  score ranking.

## Recorded smoke result (2026-06-20, GPU mode, RTX 3070 Laptop)

Best-pose scores from gnina v1.3.2 (`--seed 42 --num_modes 5 --exhaustiveness 8`):

| ligand | CNNscore | CNNaffinity | minimizedAffinity (kcal/mol) |
|---|---|---|---|
| active (aspirin) | 0.682 | 3.820 | -5.428 |
| decoy (ethane)   | —     | 2.616 | —     |

`active_wins = True` (CNNaffinity 3.820 > 2.616). Score property tags emitted by
gnina and parsed by RDKit: **`CNNscore`, `CNNaffinity`, `minimizedAffinity`**.
