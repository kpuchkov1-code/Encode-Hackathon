#!/usr/bin/env bash
echo "distro=$WSL_DISTRO_NAME"
lsb_release -d 2>/dev/null || true
python3 --version
printf "pip: "; python3 -m pip --version 2>/dev/null || echo "no pip"
printf "gnina: "; command -v gnina || echo none
printf "obabel: "; command -v obabel || echo none
printf "rdkit: "; python3 -c "import rdkit; print(rdkit.__version__)" 2>/dev/null || echo none
printf "gpu: "
if command -v nvidia-smi >/dev/null; then
  nvidia-smi --query-gpu=name --format=csv,noheader
else
  echo "no nvidia-smi"
fi
