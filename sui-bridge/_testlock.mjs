// TEST-ONLY: simulate the researcher's browser wallet locking the escrow, so the
// end-to-end driver can exercise POST /jobs/{id}/escrow-locked without a real browser.
// Builds the SAME transaction the /jobs/{id}/pay page builds in the browser
// (splitCoins(gas,[mist]) + moveCall escrow::lock(coin, job_id_bytes, arbiter)), but
// signs it with a throwaway key passed on argv instead of a connected wallet.
// NOT used in production — the real lock is signed in the researcher's browser.
//
// usage: node _testlock.mjs <jobId> <amountMist> <arbiter> <researcherSecretKey>
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const [jobId, amountMist, arbiter, secretKey] = process.argv.slice(2);
const PACKAGE_ID = process.env.ESCROW_PACKAGE_ID;
const RPC = process.env.SUI_RPC_URL || getFullnodeUrl(process.env.SUI_NETWORK || 'testnet');

if (!jobId || !amountMist || !arbiter || !secretKey) {
  console.error('usage: node _testlock.mjs <jobId> <amountMist> <arbiter> <secretKey>');
  process.exit(2);
}
if (!PACKAGE_ID) { console.error('ESCROW_PACKAGE_ID not set'); process.exit(2); }

const client = new SuiClient({ url: RPC });
const kp = Ed25519Keypair.fromSecretKey(secretKey);

const tx = new Transaction();
tx.setSender(kp.getPublicKey().toSuiAddress());
const [coin] = tx.splitCoins(tx.gas, [BigInt(amountMist)]);
tx.moveCall({
  target: `${PACKAGE_ID}::escrow::lock`,
  arguments: [
    coin,
    tx.pure.vector('u8', Array.from(new TextEncoder().encode(jobId))),
    tx.pure.address(arbiter),
  ],
});

const res = await client.signAndExecuteTransaction({
  signer: kp,
  transaction: tx,
  options: { showObjectChanges: true },
});
const full = await client.waitForTransaction({
  digest: res.digest,
  options: { showObjectChanges: true },
});
const created = (full.objectChanges || []).find(
  (o) => o.type === 'created' && o.objectType && o.objectType.endsWith('::escrow::Escrow'));
if (!created) { console.error('no Escrow object created in', res.digest); process.exit(1); }

console.log(JSON.stringify({ escrowObjectId: created.objectId, digest: res.digest }));
