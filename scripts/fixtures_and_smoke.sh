#!/usr/bin/env bash
# Fetches a public protein+ligand fixture and runs a real gnina dock to confirm
# GPU execution and capture the output score property tags.
set -euo pipefail

REPO="/mnt/c/Users/Kirill/Encode-Hackathon"
VENV="$HOME/dockenv"
cd "$REPO"
mkdir -p fixtures
. "$VENV/bin/activate"

echo "=== fetch 6LU7 (SARS-CoV-2 Mpro, toolchain fixture only) ==="
if [ ! -f fixtures/receptor_raw.pdb ]; then
  wget -q https://files.rcsb.org/download/6LU7.pdb -O fixtures/receptor_raw.pdb
fi
grep '^ATOM'  fixtures/receptor_raw.pdb > fixtures/receptor.pdb
grep '^HETATM' fixtures/receptor_raw.pdb | grep -v ' HOH ' > fixtures/ref_ligand.pdb
obabel fixtures/ref_ligand.pdb -O fixtures/ref_ligand.sdf 2>/dev/null
echo "receptor atoms: $(wc -l < fixtures/receptor.pdb), ref ligand atoms: $(wc -l < fixtures/ref_ligand.pdb)"

echo "=== prep test ligands (active=aspirin stand-in, decoy=ethane) ==="
obabel -:"CC(=O)Oc1ccccc1C(=O)O" -O fixtures/ligand_active.sdf --gen3d 2>/dev/null
obabel -:"CC" -O fixtures/ligand_decoy.sdf --gen3d 2>/dev/null
echo "active + decoy prepped"

echo "=== GPU dock attempt ==="
set +e
"$VENV/bin/gninaw" \
  -r fixtures/receptor.pdb \
  -l fixtures/ligand_active.sdf \
  --autobox_ligand fixtures/ref_ligand.sdf \
  --seed 42 --num_modes 5 --exhaustiveness 8 \
  -o fixtures/out_active.sdf > fixtures/gnina_gpu.log 2>&1
GPU_RC=$?
set -e
if [ $GPU_RC -eq 0 ] && [ -f fixtures/out_active.sdf ]; then
  echo "GPU DOCK OK"
  MODE="gpu"
else
  echo "GPU dock failed (rc=$GPU_RC); tail of log:"
  tail -15 fixtures/gnina_gpu.log
  echo "=== retry with --cpu ==="
  "$VENV/bin/gninaw" \
    -r fixtures/receptor.pdb \
    -l fixtures/ligand_active.sdf \
    --autobox_ligand fixtures/ref_ligand.sdf \
    --seed 42 --num_modes 5 --exhaustiveness 8 --cpu \
    -o fixtures/out_active.sdf > fixtures/gnina_cpu.log 2>&1
  echo "CPU DOCK OK"
  MODE="cpu"
fi

echo "=== output score property tags (RECORD THESE) ==="
grep -E "CNNscore|CNNaffinity|minimizedAffinity" fixtures/out_active.sdf | head -10
echo "=== best-pose values ==="
python - <<'PY'
from rdkit import Chem
supp = Chem.SDMolSupplier('fixtures/out_active.sdf', sanitize=False)
mols = [m for m in supp if m is not None]
print(f"poses parsed: {len(mols)}")
if mols:
    m = mols[0]
    for k in ('CNNscore','CNNaffinity','minimizedAffinity'):
        print(f"  {k} = {m.GetProp(k) if m.HasProp(k) else 'ABSENT'}")
PY
echo "MODE=$MODE"
