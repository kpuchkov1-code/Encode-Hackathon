#!/usr/bin/env node
/*
 * Zero-dependency mock backend for the Docking Marketplace.
 * Implements API_CONTRACT.md exactly, with CORS, so the frontend can be built
 * without the real (Codeplain/Flask) backend running.
 *
 * Run:   node mock/mock-server.js
 * Env:   PORT (default 8000), MOCK_SPEED (default 1; 0.5 = 2x faster lifecycle)
 *
 * A submitted job advances queued -> running -> docked -> proven -> settled over
 * ~10s so polling/stepper UIs animate. Submit with receptor.pdb_id === "FAIL"
 * to drive a job to the failed/refunded path.
 */
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const SPEED = parseFloat(process.env.MOCK_SPEED || '1');
const jobs = new Map();

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function scoreLigand(lig) {
  // Bigger molecule -> better predicted binder (mirrors real aspirin > ethane).
  const s = lig.smiles || lig.sdf || '';
  return {
    ligand_id: lig.id,
    cnn_score: +Math.min(0.99, 0.4 + s.length * 0.02).toFixed(3),
    cnn_affinity: +(2 + s.length * 0.12).toFixed(3),
    vina_affinity: +(-(3 + s.length * 0.1)).toFixed(2),
    pose_path: `poses/${lig.id}.sdf`,
  };
}

function buildResult(job) {
  const ligands = (job.spec.ligands || [])
    .map(scoreLigand)
    .sort((a, b) => b.cnn_affinity - a.cnn_affinity);
  return { job_id: job.job_id, ligands };
}

function buildProof(job) {
  const spec = job.spec;
  const ligand_sha256s = {};
  const pose_sha256s = {};
  for (const l of spec.ligands || []) {
    ligand_sha256s[l.id] = sha256(l.smiles || l.sdf || l.id);
    pose_sha256s[l.id] = sha256('pose:' + (l.smiles || l.id));
  }
  const core = {
    receptor_sha256: sha256(JSON.stringify(spec.receptor || {})),
    ligand_sha256s,
    pose_sha256s,
    params: spec.params || {},
    gnina_version: 'gnina v1.3.2 (mock)',
    timestamp: job.created_at,
    worker_id: (spec.payment && spec.payment.supplier_id) || 'node-1',
  };
  return {
    manifest_sha256: sha256(JSON.stringify(core)),
    ...core,
    storage_blob_id: sha256('blob:' + job.job_id).slice(0, 32),
  };
}

function advance(job) {
  const t = (sec) => sec * 1000 * SPEED;
  const fail = job.spec.receptor && job.spec.receptor.pdb_id === 'FAIL';
  setTimeout(() => { if (jobs.has(job.job_id) && job.state === 'queued') job.state = 'running'; }, t(2));
  if (fail) {
    setTimeout(() => {
      job.state = 'failed';
      job.reason = 'docking failed: gnina returned no poses (mock)';
      job.escrow.state = 'refunded';
    }, t(5));
    return;
  }
  setTimeout(() => { job.state = 'docked'; job.result = buildResult(job); }, t(6));
  setTimeout(() => { job.state = 'proven'; job.proof = buildProof(job); }, t(8));
  setTimeout(() => { job.state = 'settled'; job.escrow.state = 'released'; }, t(10));
}

function validateSpec(b) {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  if (!b.receptor) return 'receptor is required';
  if (!Array.isArray(b.ligands) || b.ligands.length === 0) return 'ligands must be a non-empty array';
  return null;
}

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });

  if (req.method === 'GET' && url.pathname === '/jobs') {
    return send(res, 200, {
      jobs: [...jobs.values()].map((j) => ({ job_id: j.job_id, state: j.state, created_at: j.created_at })),
    });
  }

  if (req.method === 'POST' && url.pathname === '/jobs') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      let body;
      try { body = JSON.parse(data || '{}'); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      const err = validateSpec(body);
      if (err) return send(res, 400, { error: err });
      const job_id = crypto.randomUUID();
      const job = {
        job_id, state: 'queued', reason: '', created_at: new Date().toISOString(), spec: body,
        escrow: {
          state: 'held',
          amount: (body.payment && body.payment.amount) || 0,
          supplier_id: (body.payment && body.payment.supplier_id) || '',
        },
        result: null, proof: null,
      };
      jobs.set(job_id, job);
      advance(job);
      return send(res, 202, { job_id, state: 'queued' });
    });
    return;
  }

  if (parts[0] === 'jobs' && parts[1]) {
    const job = jobs.get(parts[1]);
    if (!job) return send(res, 404, { error: 'job not found' });
    if (parts.length === 2 && req.method === 'GET')
      return send(res, 200, { job_id: job.job_id, state: job.state, reason: job.reason });
    if (parts[2] === 'escrow' && req.method === 'GET') return send(res, 200, job.escrow);
    if (parts[2] === 'result' && req.method === 'GET') {
      if (!['docked', 'proven', 'settled'].includes(job.state))
        return send(res, 409, { error: `result not ready (state=${job.state})` });
      return send(res, 200, job.result);
    }
    if (parts[2] === 'proof' && req.method === 'GET') {
      if (!['proven', 'settled'].includes(job.state))
        return send(res, 409, { error: `proof not ready (state=${job.state})` });
      return send(res, 200, job.proof);
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`mock backend on http://localhost:${PORT}  (MOCK_SPEED=${SPEED})`));
