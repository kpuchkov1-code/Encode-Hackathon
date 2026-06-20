#!/bin/bash
# Codeplain conformance runner for a Flask SERVER app.
# Args: $1 = build folder, $2 = conformance tests folder (both produced by Codeplain).
# Starts the built app (python app.py on :8000), waits for /health, runs the
# conformance tests (which make HTTP calls to localhost:8000), then kills the server.
# Runs in the active (dockenv) venv.
set -uo pipefail
UNRECOVERABLE_ERROR_EXIT_CODE=69
PORT=8000

if [ -z "${1:-}" ]; then echo "Error: no build folder. Usage: $0 <build> <conformance>"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi
if [ -z "${2:-}" ]; then echo "Error: no conformance folder. Usage: $0 <build> <conformance>"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi

current_dir="$(pwd)"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    pkill -9 -P "$SERVER_PID" >/dev/null 2>&1 || true
    kill -9 "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  pkill -9 -f "python app.py" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Kill anything already on the port (best effort, no lsof dependency required).
pkill -9 -f "python app.py" >/dev/null 2>&1 || true

PYTHON_BUILD_SUBFOLDER="python_$1"
rm -rf "$PYTHON_BUILD_SUBFOLDER"
mkdir -p "$PYTHON_BUILD_SUBFOLDER"
cp -R "$1"/* "$PYTHON_BUILD_SUBFOLDER"

cd "$PYTHON_BUILD_SUBFOLDER" || { echo "Error: build folder missing"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }

if [ -f requirements.txt ]; then
  pip install -q -r requirements.txt || { echo "Error: pip install failed"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }
fi

echo "Starting server (python app.py) on port $PORT..."
python app.py > server.log 2>&1 &
SERVER_PID=$!

# Wait up to 40s for /health to respond.
UP=0
for i in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then UP=1; echo "Server is up."; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "Server process died. Log:"; cat server.log; exit 1; fi
  sleep 1
done
if [ "$UP" -ne 1 ]; then echo "Server did not become ready. Log:"; cat server.log; exit 1; fi

cd "$current_dir"
echo "Running conformance tests from $2..."
output="$(python -m unittest discover -b -s "$current_dir/$2" 2>&1)"
rc=$?
echo "$output"
if echo "$output" | grep -q "Ran 0 tests in"; then
  echo "Error: No conformance tests discovered."
  exit 1
fi
exit $rc
