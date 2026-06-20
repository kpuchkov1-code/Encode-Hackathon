#!/usr/bin/env bash
# Finalizes the gnina runtime: ensures legacy nvtx is present, rebuilds the
# LD_LIBRARY_PATH across all nvidia lib dirs, rewrites the wrapper, verifies.
set -euo pipefail

VENV="$HOME/dockenv"
. "$VENV/bin/activate"

echo "=== ensure legacy nvtx (libnvToolsExt.so.1) present ==="
pip install -q nvidia-nvtx-cu11
find "$VENV" -name 'libnvToolsExt.so*' -printf '  %p\n'

echo "=== recompute all nvidia .so dirs ==="
LIBDIRS=$(find "$VENV" -name 'lib*.so*' -path '*nvidia*' -printf '%h\n' | sort -u | paste -sd: -)
echo "LIBDIRS=$LIBDIRS"

echo "=== rewrite wrapper $VENV/bin/gninaw ==="
cat > "$VENV/bin/gninaw" <<EOF
#!/usr/bin/env bash
export LD_LIBRARY_PATH="$LIBDIRS:\${LD_LIBRARY_PATH:-}"
exec /usr/local/bin/gnina "\$@"
EOF
chmod +x "$VENV/bin/gninaw"

echo "=== missing-lib check (want: ALL RESOLVED) ==="
export LD_LIBRARY_PATH="$LIBDIRS:${LD_LIBRARY_PATH:-}"
if ldd /usr/local/bin/gnina 2>&1 | grep -qi 'not found'; then
  echo "STILL MISSING:"
  ldd /usr/local/bin/gnina 2>&1 | grep -i 'not found' | sort -u
else
  echo "ALL RESOLVED"
fi

echo "=== gnina --version ==="
"$VENV/bin/gninaw" --version 2>&1 | head -5

# Persist the resolved path for later scripts
echo "$LIBDIRS" > "$VENV/gnina_libdirs.txt"
echo "DONE. libdirs saved to $VENV/gnina_libdirs.txt"
