#!/usr/bin/env bash
# Independently start the generated Flask app and hit /health.
set -uo pipefail
. ~/dockenv/bin/activate
cd /mnt/c/Users/Kirill/Encode-Hackathon/dist
pkill -9 -f "python app.py" >/dev/null 2>&1 || true
python app.py > /tmp/smoke_server.log 2>&1 &
SP=$!
for i in $(seq 1 15); do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "body:        $(curl -s http://localhost:8000/health)"
echo "http_status: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health)"
echo "ctype:       $(curl -s -o /dev/null -w '%{content_type}' http://localhost:8000/health)"
kill -9 "$SP" >/dev/null 2>&1 || true
pkill -9 -f "python app.py" >/dev/null 2>&1 || true
