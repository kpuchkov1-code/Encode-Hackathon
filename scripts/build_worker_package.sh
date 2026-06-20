#!/usr/bin/env bash
# Regenerate public/worker-package.zip from the actual worker-side source files.
# Run this after editing any of the files below, before deploying -- Vercel serves
# public/** as static assets via its CDN, completely separate from the Python function,
# so there's no risk of the build silently failing to bundle a non-Python file.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p public
rm -f public/worker-package.zip
zip -q public/worker-package.zip \
  install_worker.sh \
  worker_daemon.py \
  docking_worker.py \
  docking_worker_vina.py \
  worker_setup.py \
  engine_entrypoint_vina.py \
  requirements-worker.txt \
  vina-test/Dockerfile

echo "wrote public/worker-package.zip:"
unzip -l public/worker-package.zip
