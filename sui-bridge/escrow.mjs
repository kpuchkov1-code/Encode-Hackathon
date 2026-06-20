// Custodial-escrow signing bridge over the official @mysten/sui SDK.
//
// The Python control plane (models.escrow_*) shells/HTTPs into these three operations to
// move real SUI on testnet against the published `escrow::escrow` Move module. The
// platform keypair (SUI_PLATFORM_KEY) is the sole custodian -- it signs every call. No
// researcher/provider key is ever needed here: providers are paid out to a plain address
// they supply at signup.
//
// Config (env):
//   SUI_PLATFORM_KEY   bech32 `suiprivkey1...` of the custodial platform key (required)
//   ESCROW_PACKAGE_ID  package id from `sui client publish` (required)
//   SUI_RPC_URL        full node url (defaults to testnet)
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const RPC = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');
const PACKAGE_ID = process.env.ESCROW_PACKAGE_ID;
const MODULE = 'escrow';

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

// Lock `amountMist` of SUI for `jobId`. Returns the on-chain Escrow object id (needed
// later to release/refund) and the transaction digest (auditable on Suiscan).
export async function lock(jobId, amountMist) {
  requirePackage();
  const c = client();
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [BigInt(amountMist)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::lock`,
    arguments: [coin, tx.pure.vector('u8', Array.from(Buffer.from(jobId, 'utf8')))],
  });
  const res = await c.signAndExecuteTransaction({
    signer: keypair(),
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  await c.waitForTransaction({ digest: res.digest });
  const created = (res.objectChanges || []).find(
    (o) => o.type === 'created' && o.objectType && o.objectType.endsWith('::escrow::Escrow'),
  );
  return { digest: res.digest, escrowObjectId: created ? created.objectId : null, amountMist: String(amountMist) };
}

// Pay the locked funds out to `providerAddress`. Consumes the Escrow object.
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

// Return the locked funds to the platform. Consumes the Escrow object.
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
