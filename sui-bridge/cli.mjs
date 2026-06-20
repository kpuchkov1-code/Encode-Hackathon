// Thin CLI wrapper around escrow.mjs so non-JS callers (the Python control plane, or a
// shell) can drive the bridge. Prints a single JSON object to stdout; non-zero exit +
// JSON {error} on failure. Usage:
//   node cli.mjs address
//   node cli.mjs info
//   node cli.mjs inspect <escrowObjectId>
//   node cli.mjs release <escrowObjectId> <providerAddress>
//   node cli.mjs refund  <escrowObjectId>
import { release, refund, inspect, info, platformAddress } from './escrow.mjs';

const [op, ...rest] = process.argv.slice(2);

try {
  let out;
  if (op === 'address') out = { address: platformAddress() };
  else if (op === 'info') out = info();
  else if (op === 'inspect') out = await inspect(rest[0]);
  else if (op === 'release') out = await release(rest[0], rest[1]);
  else if (op === 'refund') out = await refund(rest[0]);
  else throw new Error(`unknown op: ${op}`);
  process.stdout.write(JSON.stringify(out) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String(e && e.message ? e.message : e) }) + '\n');
  process.exit(1);
}
