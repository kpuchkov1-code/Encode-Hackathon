#!/usr/bin/env bash
# Clean-slate render of the Codeplain hello-world example to (1) confirm the API
# key works and (2) observe the generated build/ layout. Runs in a temp copy so
# no partial state from earlier runs interferes.
set -euo pipefail

REPO="/mnt/c/Users/Kirill/Encode-Hackathon"
cd "$REPO"

# Load .env, stripping Windows CR. Verify the key actually loaded BEFORE rendering.
set -a; . <(sed 's/\r$//' .env); set +a
echo "CODEPLAIN_API_KEY length: ${#CODEPLAIN_API_KEY}"
if [ "${#CODEPLAIN_API_KEY}" -lt 10 ]; then
  echo "FATAL: key not loaded from .env"; exit 1
fi

. ~/dockenv/bin/activate

WORK=/tmp/hw_render
rm -rf "$WORK"
cp -r ~/plain2code_client/examples/example_hello_world_python "$WORK"
cd "$WORK"
# drop any generated dirs that may have been copied in
rm -rf build dist conformance_tests plain_modules python_plain_modules
echo "=== input files ==="; ls

echo "=== rendering (streaming) ==="
python ~/plain2code_client/plain2code.py hello_world_python.plain
RC=$?
echo "=== render exit code: $RC ==="

echo "=== generated build tree ==="
find build -maxdepth 3 -type f 2>/dev/null | head -40
echo "=== all dirs created ==="
ls -d */ 2>/dev/null
