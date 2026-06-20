#!/usr/bin/env bash
set -e
. ~/dockenv/bin/activate
pip install -q flask requests
command -v curl >/dev/null 2>&1 || apt-get install -y curl
command -v lsof >/dev/null 2>&1 || apt-get install -y lsof || true
echo "flask:   $(python -c 'import flask; print(flask.__version__)')"
echo "requests:$(python -c 'import requests; print(requests.__version__)')"
echo "curl:    $(command -v curl || echo MISSING)"
