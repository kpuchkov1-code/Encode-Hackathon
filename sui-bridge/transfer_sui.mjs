// One-off: transfer testnet SUI from the platform/escrow account to a recipient.
// Usage:  node transfer_sui.mjs <recipient-0x...> <amount-in-SUI>
// Loads SUI_PLATFORM_KEY / SUI_RPC_URL the same way the bridge does.
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const [recipient, amountSui] = process.argv.slice(2);
if (!recipient || !amountSui) {
  console.error('usage: node transfer_sui.mjs <recipient> <amountSui>');
  process.exit(1);
}

const RPC = process.env.SUI_RPC_URL || getFullnodeUrl('testnet');
const client = new SuiClient({ url: RPC });
const { secretKey } = decodeSuiPrivateKey(process.env.SUI_PLATFORM_KEY);
const kp = Ed25519Keypair.fromSecretKey(secretKey);
const amountMist = BigInt(Math.round(parseFloat(amountSui) * 1e9));

const tx = new Transaction();
const [coin] = tx.splitCoins(tx.gas, [amountMist]);
tx.transferObjects([coin], recipient);

const res = await client.signAndExecuteTransaction({
  signer: kp,
  transaction: tx,
  options: { showEffects: true },
});
console.log(JSON.stringify({
  from: kp.getPublicKey().toSuiAddress(),
  to: recipient,
  amountSui,
  digest: res.digest,
  status: res.effects?.status?.status,
}, null, 2));
