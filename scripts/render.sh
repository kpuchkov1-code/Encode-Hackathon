#!/usr/bin/env bash
# Reusable Codeplain render helper.
# Usage: bash scripts/render.sh <plain-file> [extra plain2code args...]
# Loads the API key from .env (CR-stripped), verifies it, activates the venv,
# normalizes runner-script line endings, and renders with our server-aware runners.
set -euo pipefail

REPO="/mnt/c/Users/Kirill/Encode-Hackathon"
cd "$REPO"

set -a; . <(sed 's/\r$//' .env); set +a
if [ "${#CODEPLAIN_API_KEY}" -lt 10 ]; then echo "FATAL: API key not loaded from .env"; exit 1; fi
echo "API key loaded (${#CODEPLAIN_API_KEY} chars)"

. ~/dockenv/bin/activate

# Ensure runner scripts are LF + executable.
sed -i 's/\r$//' run_unittests_python.sh run_conformance_tests_python.sh
chmod +x run_unittests_python.sh run_conformance_tests_python.sh

PLAIN="${1:?usage: render.sh <plain-file> [extra args]}"
shift || true

python ~/plain2code_client/plain2code.py \
  --headless \
  --verbose \
  --unittests-script "$REPO/run_unittests_python.sh" \
  --conformance-tests-script "$REPO/run_conformance_tests_python.sh" \
  "$PLAIN" "$@"
