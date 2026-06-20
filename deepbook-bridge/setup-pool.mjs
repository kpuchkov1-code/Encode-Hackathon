/**
 * One-shot: stand up the marketplace's own COMPUTE/SUI DeepBook pool and seed it with
 * provider ask orders, so the price oracle reads a real compute market instead of the
 * stand-in reference pool.
 *
 * Runs the whole sequence in a single process (mint -> create pool -> create balance
 * manager -> deposit -> seed asks), so the pool/manager object ids created mid-run stay in
 * memory and thread cleanly into the later steps -- far less error-prone than chaining
 * separate CLI calls and copy-pasting ids between them. On success it writes pool.json and
 * prints the exact env vars to set on the control plane.
 *
 * FUNDING REQUIRED (testnet play-money): the platform wallet (SUI_PLATFORM_KEY) must hold
 *   - ~500 DEEP   -- the permissionless-pool creation fee (the one real blocker; the testnet
 *                    faucet rate-limits, so this is acquired via swap or a funded wallet)
 *   - a few SUI   -- gas + the SUI side of the seed ask liquidity
 * COMPUTE is minted here from our own TreasuryCap, so it costs nothing.
 *
 * Usage: SUI_PLATFORM_KEY=... node setup-pool.mjs
 */
import { DeepBookClient } from '@mysten/deepbook-v3';
import { testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { writeFileSync } from 'node:fs';

const RPC_URL = process.env.SUI_RPC_URL || getJsonRpcFullnodeUrl('testnet');
const NETWORK = 'testnet';
const COMPUTE_TYPE =
  process.env.DEEPBOOK_COMPUTE_COIN_TYPE ||
  '0x9fb8d8ec2e4e7df75fe47edbe63f20dc58b4db547d6abe9ff2b4be6d80b75d38::compute::COMPUTE';
const COMPUTE_PKG = COMPUTE_TYPE.split('::')[0];
const COMPUTE_TREASURY =
  process.env.DEEPBOOK_COMPUTE_TREASURY ||
  '0x404512e1d361fe13ce6cafeb6e728ad330f4b9f0ac8636b6aa0105e1d5d36be8';
const COMPUTE_SCALAR = 1_000_000;

// Seed-ask price (SUI per COMPUTE) chosen so the per-ligand price lands near the familiar
// $2 baseline (DEEPBOOK_RATE_ANCHOR_SUI is set to match). Providers later post their own
// asks above/below this and the live best-ask moves the marketplace price.
const SEED_ASK_PRICE = Number(process.env.SEED_ASK_PRICE || '0.002');
const SEED_ASK_QTY = Number(process.env.SEED_ASK_QTY || '1000'); // COMPUTE units offered
const MINT_COMPUTE = Number(process.env.MINT_COMPUTE || '100000'); // whole COMPUTE to mint

const signer = Ed25519Keypair.fromSecretKey((process.env.SUI_PLATFORM_KEY || '').trim());
const ADDR = signer.toSuiAddress();
const rpc = new SuiJsonRpcClient({ url: RPC_URL });

const coins = {
  ...testnetCoins,
  COMPUTE: { address: COMPUTE_PKG, type: COMPUTE_TYPE, scalar: COMPUTE_SCALAR },
};
const pools = { ...testnetPools };

async function run(label, tx) {
  console.log(`\n>> ${label}`);
  const res = await rpc.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (res.effects?.status?.status !== 'success') {
    throw new Error(`${label} FAILED: ${res.effects?.status?.error || 'unknown'} (${res.digest})`);
  }
  console.log(`   ok ${res.digest}`);
  return res;
}

const found = (res, re) =>
  (res.objectChanges || []).find((c) => c.type === 'created' && re.test(c.objectType || ''))?.objectId ?? null;

console.log(`platform address: ${ADDR}`);

// 1. Mint COMPUTE supply to ourselves (free -- our own TreasuryCap).
{
  const tx = new Transaction();
  tx.moveCall({
    target: `${COMPUTE_PKG}::compute::mint`,
    arguments: [
      tx.object(COMPUTE_TREASURY),
      tx.pure.u64(BigInt(Math.round(MINT_COMPUTE * COMPUTE_SCALAR))),
      tx.pure.address(ADDR),
    ],
  });
  await run(`mint ${MINT_COMPUTE} COMPUTE`, tx);
}

// 2. Create the permissionless COMPUTE/SUI pool (costs ~500 DEEP).
let poolId;
{
  const db = new DeepBookClient({ client: rpc, address: ADDR, network: NETWORK, coins, pools });
  const tx = new Transaction();
  db.deepBook.createPermissionlessPool({
    baseCoinKey: 'COMPUTE',
    quoteCoinKey: 'SUI',
    tickSize: 0.0001,
    lotSize: 0.1,
    minSize: 1,
  })(tx);
  const res = await run('create COMPUTE/SUI pool', tx);
  poolId = found(res, /::pool::Pool</);
  if (!poolId) throw new Error('pool object id not found in tx output');
  console.log(`   poolId = ${poolId}`);
}
pools.COMPUTE_SUI = { address: poolId, baseCoin: 'COMPUTE', quoteCoin: 'SUI' };

// 3. Create a BalanceManager (DeepBook's per-account custody object).
let managerId;
{
  const db = new DeepBookClient({ client: rpc, address: ADDR, network: NETWORK, coins, pools });
  const tx = new Transaction();
  tx.setSenderIfNotSet(ADDR);
  db.balanceManager.createAndShareBalanceManager()(tx);
  const res = await run('create balance manager', tx);
  managerId = found(res, /BalanceManager/);
  if (!managerId) throw new Error('balance manager id not found in tx output');
  console.log(`   balanceManagerId = ${managerId}`);
}

// 4+5. Deposit liquidity then place the seed ask, with the manager now registered in config.
{
  const db = new DeepBookClient({
    client: rpc,
    address: ADDR,
    network: NETWORK,
    coins,
    pools,
    balanceManagers: { MAIN: { address: managerId } },
  });
  const depTx = new Transaction();
  depTx.setSenderIfNotSet(ADDR);
  db.balanceManager.depositIntoManager('MAIN', 'COMPUTE', SEED_ASK_QTY)(depTx);
  db.balanceManager.depositIntoManager('MAIN', 'SUI', Math.max(1, SEED_ASK_PRICE * SEED_ASK_QTY))(depTx);
  await run('deposit COMPUTE + SUI into manager', depTx);

  const askTx = new Transaction();
  askTx.setSenderIfNotSet(ADDR);
  db.deepBook.placeLimitOrder({
    poolKey: 'COMPUTE_SUI',
    balanceManagerKey: 'MAIN',
    clientOrderId: '1',
    price: SEED_ASK_PRICE,
    quantity: SEED_ASK_QTY,
    isBid: false, // ask = sell COMPUTE for SUI = provider offering compute
    payWithDeep: false, // pay maker fee in the input coin, so seeding needs no extra DEEP
  })(askTx);
  await run(`place seed ask ${SEED_ASK_QTY} COMPUTE @ ${SEED_ASK_PRICE} SUI`, askTx);
}

const out = { poolId, balanceManagerId: managerId, seedAskPrice: SEED_ASK_PRICE, computeType: COMPUTE_TYPE };
writeFileSync(new URL('./pool.json', import.meta.url), JSON.stringify(out, null, 2));

console.log('\n=== DONE -- set these on the control plane ===');
console.log(`DEEPBOOK_COMPUTE_POOL_ID=${poolId}`);
console.log(`DEEPBOOK_BALANCE_MANAGER_ID=${managerId}`);
console.log(`DEEPBOOK_RATE_ANCHOR_SUI=${SEED_ASK_PRICE}`);
console.log('(wrote pool.json)');
