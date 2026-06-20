#!/usr/bin/env node
/*
 * Zero-dependency mock backend for the Docking Marketplace.
 * Implements API_CONTRACT.md exactly, with CORS, so the frontend can be built
 * without the real (Codeplain/Flask) backend running.
 *
 * Run:   node mock/mock-server.js
 * Env:   PORT (default 8000), MOCK_SPEED (default 1; 0.5 = 2x faster lifecycle)
 *        MOCK_AUTORUN_MS (default 1500): how long a job sits `queued` before the mock
 *          auto-advances it. Set 0 to disable -> jobs wait for POST /jobs/<id>/run
 *          (the two-sided demo where the seller's Run button is causal).
 *
 * A job is created `queued`. It begins advancing (running -> docked -> proven -> settled,
 * ~8s) when a provider calls POST /jobs/<id>/run, OR when the auto-run fallback fires.
 * Submit with receptor.pdb_id === "FAIL" to drive a job to the failed/refunded path.
 */
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const SPEED = parseFloat(process.env.MOCK_SPEED || '1');
const AUTORUN_MS =
  process.env.MOCK_AUTORUN_MS !== undefined
    ? parseInt(process.env.MOCK_AUTORUN_MS, 10)
    : 1500;
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

// Start the docking lifecycle for a queued job. Idempotent: a job advances once,
// whether triggered by POST /jobs/<id>/run or the auto-run fallback.
function startAdvance(job, workerId) {
  if (job._started || job.state !== 'queued') return false;
  job._started = true;
  if (job._autorun) { clearTimeout(job._autorun); job._autorun = null; }
  if (workerId) { job.worker_id = workerId; job.escrow.supplier_id = workerId; }
  else if (!job.worker_id) job.worker_id = job.escrow.supplier_id || 'node-1';

  const t = (sec) => sec * 1000 * SPEED;
  const live = () => jobs.has(job.job_id);
  const fail = job.spec.receptor && job.spec.receptor.pdb_id === 'FAIL';
  job.state = 'running';
  if (fail) {
    setTimeout(() => {
      if (!live()) return;
      job.state = 'failed';
      job.reason = 'docking failed: gnina returned no poses (mock)';
      job.escrow.state = 'refunded';
    }, t(3));
    return true;
  }
  setTimeout(() => { if (live()) { job.state = 'docked'; job.result = buildResult(job); } }, t(4));
  setTimeout(() => { if (live()) { job.state = 'proven'; job.proof = buildProof(job); } }, t(6));
  setTimeout(() => { if (live()) { job.state = 'settled'; job.escrow.state = 'released'; } }, t(8));
  return true;
}

// Buyer-side convenience: unless disabled (MOCK_AUTORUN_MS=0), a submitted job
// auto-advances after a short queued dwell so the buyer-only demo still animates.
function scheduleAutoRun(job) {
  if (AUTORUN_MS <= 0) return;
  job._autorun = setTimeout(() => startAdvance(job), AUTORUN_MS * SPEED);
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
        worker_id: null,
        escrow: {
          state: 'held',
          amount: (body.payment && body.payment.amount) || 0,
          supplier_id: (body.payment && body.payment.supplier_id) || '',
        },
        result: null, proof: null,
      };
      jobs.set(job_id, job);
      scheduleAutoRun(job);
      return send(res, 202, { job_id, state: 'queued' });
    });
    return;
  }

  // Supply side: a provider claims + starts a queued job.
  if (parts[0] === 'jobs' && parts[1] && parts[2] === 'run' && req.method === 'POST') {
    const job = jobs.get(parts[1]);
    if (!job) return send(res, 404, { error: 'job not found' });
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(data || '{}'); } catch { /* empty body is fine */ }
      if (job.state !== 'queued')
        return send(res, 409, { error: `job not claimable (state=${job.state})` });
      const workerId = body.supplier_id || 'node-1';
      startAdvance(job, workerId);
      return send(res, 202, { job_id: job.job_id, state: job.state, worker_id: job.worker_id });
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
