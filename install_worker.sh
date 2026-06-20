#!/usr/bin/env bash
# Run this to make your idle hardware available on the docking marketplace.
#
# Only the orchestrator (worker_daemon.py) runs directly on your machine, and its only
# dependency is the `requests` package -- everything else (the docking engine, RDKit,
# etc.) is sealed inside a Docker container spun up fresh per job, never touching your
# system Python or packages. Uses AutoDock Vina for now (see SESSION_HANDOFF.md) -- the
# heavier gnina engine is a planned future option, not available out of the box yet.
#
# Usage (worker_id and token come from signing up at {control plane}/providers/signup --
# the server issues them, you don't make them up, so two providers can never collide on
# or impersonate the same identity):
#   CONTROL_PLANE_URL=https://your-deployment.vercel.app WORKER_ID=worker-xxxx \
#       WORKER_TOKEN=... ./install_worker.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker &>/dev/null; then
  echo "Docker is required but not found. Install it from https://docs.docker.com/get-docker/ and re-run this script." >&2
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  echo "Python 3 is required but not found." >&2
  exit 1
fi

: "${CONTROL_PLANE_URL:?Set CONTROL_PLANE_URL to the deployed control plane URL, e.g. https://your-deployment.vercel.app}"
: "${WORKER_ID:?Sign up at \$CONTROL_PLANE_URL/providers/signup to get a WORKER_ID}"
: "${WORKER_TOKEN:?Sign up at \$CONTROL_PLANE_URL/providers/signup to get a WORKER_TOKEN}"

if ! python3 -c "import requests" 2>/dev/null; then
  echo "Installing the orchestrator's one dependency (requests)..."
  python3 -m pip install --quiet requests || python3 -m pip install --quiet --break-system-packages requests
fi

echo "Starting worker orchestrator (id=$WORKER_ID, control_plane=$CONTROL_PLANE_URL)..."
echo "(first run also builds the Vina engine image, ~300MB, one-time)"
exec python3 "$REPO_ROOT/worker_daemon.py"
