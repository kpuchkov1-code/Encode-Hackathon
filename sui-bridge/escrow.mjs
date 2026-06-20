// Trustless-escrow signing bridge over the official @mysten/sui SDK.
//
// In the trustless model the RESEARCHER locks their own funds from their own browser
// wallet (see the /jobs/{id}/pay page) -- the platform never holds the researcher's key
// and there is no `lock`/`pay`/`fund` op here anymore. This bridge does only two kinds of
// thing:
//   * read-only `inspect` -- read a shared Escrow object's fields so the Python control
//     plane can trustlessly verify a researcher-signed lock (right job id, right arbiter,
//     enough money) before it queues the job. Needs no key.
//   * arbiter-signed `release`/`refund` -- the platform is recorded on-chain as the
//     escrow's `arbiter`; it may TRIGGER a payout but the Move contract fixes the
//     destinations (provider on release, the original payer on refund), so the platform
//     can never divert funds to itself. These are signed by SUI_PLATFORM_KEY.
//
// Config (env):
//   SUI_PLATFORM_KEY   bech32 `suiprivkey1...` of the platform/arbiter key (required for release/refund)
//   ESCROW_PACKAGE_ID  package id from `sui client publish` (required)
//   SUI_RPC_URL        full node url (defaults to testnet)
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const RPC = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');
const PACKAGE_ID = process.env.ESCROW_PACKAGE_ID;
const MODULE = 'escrow';
const NETWORK = process.env.SUI_NETWORK || 'testnet';

function client() {
  return new SuiClient({ url: RPC });
}

function keypair() {
  const pk = process.env.SUI_PLATFORM_KEY;
  if (!pk) throw new Error('SUI_PLATFORM_KEY not set');
  const { secretKey } = decodeSuiPrivateKey(pk);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

function requirePackage() {
  if (!PACKAGE_ID) throw new Error('ESCROW_PACKAGE_ID not set');
}

export function platformAddress() {
  return keypair().getPublicKey().toSuiAddress();
}

// Static config the frontend needs to build the researcher's own lock transaction:
// which Move package to call and which address must be named as the arbiter.
export function info() {
  requirePackage();
  return { packageId: PACKAGE_ID, module: MODULE, arbiter: platformAddress(), network: NETWORK };
}

// Decode the on-chain `job_id: vector<u8>` -- the SDK returns it as a number[] of bytes.
function decodeJobId(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return Buffer.from(raw).toString('utf8');
  return null;
}

// Read a shared Escrow object so the control plane can trustlessly verify a
// researcher-signed lock. Returns the fields the backend checks: jobId, payer, arbiter,
// and the locked amount (mist). No key required -- this is a public read.
export async function inspect(escrowObjectId) {
  requirePackage();
  const c = client();
  const obj = await c.getObject({ id: escrowObjectId, options: { showContent: true, showType: true } });
  if (!obj || obj.error || !obj.data) {
    throw new Error(`escrow object not found: ${escrowObjectId}`);
  }
  const content = obj.data.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`not a move object: ${escrowObjectId}`);
  }
  const type = content.type || obj.data.type || '';
  const expectedType = `${PACKAGE_ID}::${MODULE}::Escrow`;
  if (!type.startsWith(expectedType)) {
    throw new Error(`wrong object type: ${type} (expected ${expectedType})`);
  }
  const f = content.fields || {};
  // funds is a Balance<SUI>; the SDK surfaces its inner u64 as { fields: { value } } or a
  // bare string depending on version -- handle both.
  let amountMist = null;
  if (f.funds != null) {
    if (typeof f.funds === 'object' && f.funds.fields) amountMist = String(f.funds.fields.value);
    else amountMist = String(f.funds);
  }
  return {
    escrowObjectId,
    jobId: decodeJobId(f.job_id),
    payer: f.payer || null,
    arbiter: f.arbiter || null,
    amountMist,
    type,
  };
}

// Pay the locked funds out to `providerAddress`. Signed by the platform (arbiter); the
// Move contract enforces that only the recorded arbiter may call it. Consumes the Escrow.
export async function release(escrowObjectId, providerAddress) {
  requirePackage();
  const c = client();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::release`,
    arguments: [tx.object(escrowObjectId), tx.pure.address(providerAddress)],
  });
  const res = await c.signAndExecuteTransaction({
    signer: keypair(),
    transaction: tx,
    options: { showEffects: true },
  });
  await c.waitForTransaction({ digest: res.digest });
  return { digest: res.digest };
}

// Refund the locked funds. The Move contract hardcodes the destination to the recorded
// payer (the researcher) -- the arbiter only triggers it. Consumes the Escrow object.
export async function refund(escrowObjectId) {
  requirePackage();
  const c = client();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::refund`,
    arguments: [tx.object(escrowObjectId)],
  });
  const res = await c.signAndExecuteTransaction({
    signer: keypair(),
    transaction: tx,
    options: { showEffects: true },
  });
  await c.waitForTransaction({ digest: res.digest });
  return { digest: res.digest };
}
