// Standalone HTTP form of the escrow bridge, for deploying the Sui-signing piece as its
// own small service (Render/Railway/Fly/a separate Vercel project) so the existing
// Python control plane on Vercel stays untouched -- it just calls this over HTTP via
// SUI_BRIDGE_URL. Every request must carry the shared secret (SUI_BRIDGE_SECRET) in the
// `x-bridge-secret` header, since whoever can reach the release/refund endpoints can
// trigger the arbiter-signed payouts.
//
// Endpoints (all POST, JSON body):
//   /address                          -> { address }
//   /info                             -> { packageId, module, arbiter, network }
//   /inspect { escrowObjectId }       -> { escrowObjectId, jobId, payer, arbiter, amountMist, type }
//   /release { escrowObjectId, providerAddress } -> { digest }
//   /refund  { escrowObjectId }       -> { digest }
import { createServer } from 'node:http';
import { release, refund, inspect, info, platformAddress } from './escrow.mjs';

const SECRET = process.env.SUI_BRIDGE_SECRET;
const PORT = process.env.PORT || 8787;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    if (SECRET && req.headers['x-bridge-secret'] !== SECRET) return send(401, { error: 'bad secret' });
    const body = await readBody(req);
    const path = (req.url || '').split('?')[0];
    if (path === '/address') return send(200, { address: platformAddress() });
    if (path === '/info') return send(200, info());
    if (path === '/inspect') return send(200, await inspect(body.escrowObjectId));
    if (path === '/release') return send(200, await release(body.escrowObjectId, body.providerAddress));
    if (path === '/refund') return send(200, await refund(body.escrowObjectId));
    return send(404, { error: `unknown path ${path}` });
  } catch (e) {
    send(500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, () => console.log(`sui-bridge listening on :${PORT}`));
