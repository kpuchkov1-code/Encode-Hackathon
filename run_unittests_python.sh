#!/bin/bash
# Codeplain unittests runner (pure logic, no server).
# Args: $1 = build folder produced by Codeplain.
# Runs in the active (dockenv) venv, so `python`/`pip` resolve there.
set -uo pipefail
UNRECOVERABLE_ERROR_EXIT_CODE=69

if [ -z "${1:-}" ]; then
  echo "Error: No build folder provided. Usage: $0 <build_folder>"
  exit $UNRECOVERABLE_ERROR_EXIT_CODE
fi

PYTHON_BUILD_SUBFOLDER="python_$1"
rm -rf "$PYTHON_BUILD_SUBFOLDER"
mkdir -p "$PYTHON_BUILD_SUBFOLDER"
cp -R "$1"/* "$PYTHON_BUILD_SUBFOLDER"

cd "$PYTHON_BUILD_SUBFOLDER" || { echo "Error: build folder missing"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }

if [ -f requirements.txt ]; then
  pip install -q -r requirements.txt || { echo "Error: pip install failed"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }
fi

echo "Running Python unittests in $PYTHON_BUILD_SUBFOLDER..."
python -m unittest discover -b
exit $?
