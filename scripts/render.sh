#!/usr/bin/env bash
# Reusable Codeplain render helper.
# Usage: bash scripts/render.sh <plain-file> [extra plain2code/codeplain args...]
#
# Portable across both dev setups used on this project:
#   - WSL (Kirill): ~/dockenv venv + python ~/plain2code_client/plain2code.py
#   - native Linux (Ali): `codeplain` CLI on PATH (installed via `uv tool`),
#     CODEPLAIN_API_KEY exported from ~/.bashrc -- no .env / venv activation
#     needed for the client itself, just for the generated app's deps.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PLAIN="${1:?usage: render.sh <plain-file> [extra args]}"
shift || true

if command -v codeplain >/dev/null 2>&1; then
  RENDERER=(codeplain)
  : "${CODEPLAIN_API_KEY:?CODEPLAIN_API_KEY not set (expected from ~/.bashrc)}"
  echo "Using global codeplain CLI ($(codeplain --version))"
  if [ -f .venv/bin/activate ]; then
    . .venv/bin/activate
    echo "Activated .venv ($(python --version))"
  fi
elif [ -f .env ]; then
  set -a; . <(sed 's/\r$//' .env); set +a
  if [ "${#CODEPLAIN_API_KEY}" -lt 10 ]; then echo "FATAL: API key not loaded from .env"; exit 1; fi
  echo "API key loaded from .env (${#CODEPLAIN_API_KEY} chars)"
  if [ -f ~/dockenv/bin/activate ]; then
    . ~/dockenv/bin/activate
  elif [ -f .venv/bin/activate ]; then
    . .venv/bin/activate
  fi
  RENDERER=(python ~/plain2code_client/plain2code.py)
else
  echo "FATAL: no 'codeplain' CLI on PATH and no .env with CODEPLAIN_API_KEY found."
  exit 1
fi

# Ensure runner scripts are LF + executable (WSL/Windows checkouts can pick up CRLF).
sed -i 's/\r$//' run_unittests_python.sh run_conformance_tests_python.sh
chmod +x run_unittests_python.sh run_conformance_tests_python.sh

"${RENDERER[@]}" \
  --headless \
  --verbose \
  --unittests-script "$REPO/run_unittests_python.sh" \
  --conformance-tests-script "$REPO/run_conformance_tests_python.sh" \
  "$PLAIN" "$@"
