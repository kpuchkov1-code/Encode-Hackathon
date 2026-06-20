#!/usr/bin/env bash
# Smoke the Task 2 job endpoints end-to-end against the generated server.
set -uo pipefail
REPO=/mnt/c/Users/Kirill/Encode-Hackathon
. ~/dockenv/bin/activate
cd "$REPO/dist"
pkill -9 -f "python app.py" >/dev/null 2>&1 || true
rm -f jobs.db
python app.py > /tmp/jobs_server.log 2>&1 &
SP=$!
for i in $(seq 1 15); do curl -sf http://localhost:8000/health >/dev/null 2>&1 && break; sleep 1; done

echo "== POST valid job =="
RESP=$(curl -s -w "\n%{http_code}" -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' --data @"$REPO/fixtures/sample_job.json")
echo "$RESP"
JOB_ID=$(echo "$RESP" | head -1 | python -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)
echo "job_id=$JOB_ID"

echo "== GET that job =="
curl -s -w "  [%{http_code}]\n" http://localhost:8000/jobs/$JOB_ID

echo "== GET unknown job (expect 404) =="
curl -s -o /dev/null -w "  status=%{http_code}\n" http://localhost:8000/jobs/does-not-exist

echo "== POST empty ligands (expect 400) =="
curl -s -o /dev/null -w "  status=%{http_code}\n" -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"receptor":{"pdb_id":"6LU7"},"ligands":[],"box":{"autobox_ligand":"r"},"params":{"exhaustiveness":8,"num_modes":5,"cnn":"rescore","seed":42},"payment":{"amount":100,"supplier_id":"n"}}'

echo "== POST no receptor (expect 400) =="
curl -s -o /dev/null -w "  status=%{http_code}\n" -X POST http://localhost:8000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"ligands":[{"id":"l","smiles":"CC"}],"box":{"autobox_ligand":"r"},"params":{"exhaustiveness":8,"num_modes":5,"cnn":"rescore","seed":42},"payment":{"amount":100,"supplier_id":"n"}}'

kill -9 "$SP" >/dev/null 2>&1 || true
pkill -9 -f "python app.py" >/dev/null 2>&1 || true
