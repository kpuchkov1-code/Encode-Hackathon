#!/usr/bin/env bash
# Sets up a project venv with RDKit + the CUDA runtime libs gnina needs,
# then writes a gnina wrapper that injects LD_LIBRARY_PATH so the binary loads.
set -euo pipefail

REPO="/mnt/c/Users/Kirill/Encode-Hackathon"
VENV="$HOME/dockenv"   # keep venv on the WSL fs (faster than /mnt/c) but reference repo for wrapper

echo "=== creating venv at $VENV ==="
python3 -m venv "$VENV"
. "$VENV/bin/activate"
python -m pip install -q --upgrade pip

echo "=== installing rdkit + numpy ==="
pip install -q rdkit numpy

echo "=== installing CUDA runtime libs gnina links against ==="
pip install -q \
  nvidia-cuda-runtime-cu12 \
  nvidia-cublas-cu12 \
  nvidia-cudnn-cu12 \
  nvidia-cufft-cu12 \
  nvidia-cusolver-cu12 \
  nvidia-cusparse-cu12 \
  nvidia-nvtx-cu12

echo "=== locating installed .so directories ==="
LIBDIRS=$(find "$VENV" -name 'lib*.so*' -path '*nvidia*' -printf '%h\n' | sort -u | paste -sd: -)
echo "LIBDIRS=$LIBDIRS"

echo "=== writing gnina wrapper to $VENV/bin/gninaw ==="
cat > "$VENV/bin/gninaw" <<EOF
#!/usr/bin/env bash
export LD_LIBRARY_PATH="$LIBDIRS:\${LD_LIBRARY_PATH:-}"
exec /usr/local/bin/gnina "\$@"
EOF
chmod +x "$VENV/bin/gninaw"

echo "=== checking remaining missing libs (should be empty) ==="
export LD_LIBRARY_PATH="$LIBDIRS:${LD_LIBRARY_PATH:-}"
ldd /usr/local/bin/gnina 2>&1 | grep -i 'not found' | sort -u || echo "ALL LIBS RESOLVED"

echo "=== gnina version via wrapper ==="
"$VENV/bin/gninaw" --version 2>&1 | head -5 || echo "version call failed"

echo "VENV=$VENV"
echo "LIBDIRS=$LIBDIRS"
