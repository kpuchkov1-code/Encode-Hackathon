// Vercel serverless form of the escrow signing bridge. Each request is one stateless Move
// call signed with the platform (arbiter) key, so it runs fine as a function — no always-on
// box, no laptop, no tunnel. The Python control plane calls this over HTTP via SUI_BRIDGE_URL
// (set to ".../api"); the op arrives as a query param via the rewrite in vercel.json
// (/api/release -> /api/bridge?op=release). Every request must carry the shared secret in
// the `x-bridge-secret` header.
import { release, refund, inspect, info, platformAddress } from "../escrow.mjs";

const SECRET = process.env.SUI_BRIDGE_SECRET;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (SECRET && req.headers["x-bridge-secret"] !== SECRET)
      return res.status(401).json({ error: "bad secret" });

    const op = req.query.op;
    const body = req.body || {};
    if (op === "address") return res.status(200).json({ address: platformAddress() });
    if (op === "info") return res.status(200).json(info());
    if (op === "inspect") return res.status(200).json(await inspect(body.escrowObjectId));
    if (op === "release")
      return res.status(200).json(await release(body.escrowObjectId, body.providerAddress));
    if (op === "refund") return res.status(200).json(await refund(body.escrowObjectId));
    return res.status(404).json({ error: `unknown op ${op}` });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
