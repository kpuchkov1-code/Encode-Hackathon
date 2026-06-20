/**
 * DeepBook v3 bridge for the docking marketplace.
 *
 * Isolated from the v1 escrow bridge (sui-bridge/) because DeepBook needs @mysten/sui v2
 * while the escrow signer pins v1.45.2 -- the two SDKs cannot share a node_modules.
 *
 * Primary job: act as a *price oracle*. Providers post generic compute-unit ask orders on
 * a DeepBook COMPUTE/SUI pool; the control plane reads the live best-ask here and uses it
 * to price every docking job. DeepBook is NOT used to match or settle jobs (the pull-queue
 * + Sui escrow already do that) and orders carry only an opaque compute-unit quantity and
 * price -- never anything that identifies a job, protein, or ligand.
 *
 * The same module also exposes the one-shot setup ops (mint COMPUTE, create the pool, open
 * a balance manager, seed ask orders) used to stand the pool up; those need SUI_PLATFORM_KEY
 * and, for pool creation, ~500 DEEP of gas-token.
 */
import { DeepBookClient } from '@mysten/deepbook-v3';
import { testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const RPC_URL = process.env.SUI_RPC_URL || getJsonRpcFullnodeUrl('testnet');
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// COMPUTE coin published by us (move/compute_token). Defaults baked in so the read path
// works with zero extra env, but every value is overridable.
const COMPUTE_TYPE =
  process.env.DEEPBOOK_COMPUTE_COIN_TYPE ||
  '0x9fb8d8ec2e4e7df75fe47edbe63f20dc58b4db547d6abe9ff2b4be6d80b75d38::compute::COMPUTE';
const COMPUTE_PKG = COMPUTE_TYPE.split('::')[0];
const COMPUTE_TREASURY =
  process.env.DEEPBOOK_COMPUTE_TREASURY ||
  '0x404512e1d361fe13ce6cafeb6e728ad330f4b9f0ac8636b6aa0105e1d5d36be8';
const COMPUTE_SCALAR = 1_000_000; // 6 decimals, matches the Move create_currency decimals

// Set once the COMPUTE/SUI pool exists (funding-gated). Until then the oracle reads a live
// reference pool so the plumbing is provably real, and labels the source honestly.
const COMPUTE_POOL_ID = process.env.DEEPBOOK_COMPUTE_POOL_ID || '';
const REFERENCE_POOL_KEY = process.env.DEEPBOOK_REFERENCE_POOL || 'DEEP_SUI';
const BALANCE_MANAGER_ID = process.env.DEEPBOOK_BALANCE_MANAGER_ID || '';

const coins = {
  ...testnetCoins,
  COMPUTE: { address: COMPUTE_PKG, type: COMPUTE_TYPE, scalar: COMPUTE_SCALAR },
};
const pools = {
  ...testnetPools,
  ...(COMPUTE_POOL_ID
    ? { COMPUTE_SUI: { address: COMPUTE_POOL_ID, baseCoin: 'COMPUTE', quoteCoin: 'SUI' } }
    : {}),
};

function keypairFromEnv() {
  const key = process.env.SUI_PLATFORM_KEY;
  if (!key) throw new Error('SUI_PLATFORM_KEY required for this op');
  return Ed25519Keypair.fromSecretKey(key.trim());
}

function makeClient(withSigner = false) {
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  const opts = { client, network: NETWORK, coins, pools };
  if (withSigner) {
    opts.address = keypairFromEnv().toSuiAddress();
    if (BALANCE_MANAGER_ID) opts.balanceManagers = { MAIN: { address: BALANCE_MANAGER_ID, tradeCap: undefined } };
  } else {
    opts.address = '0x0';
  }
  return new DeepBookClient(opts);
}

/**
 * Read the live order book and derive a per-compute-unit rate in SUI.
 * Returns a stable JSON shape the control plane can consume directly.
 */
async function readPrice() {
  const db = makeClient(false);
  const usingOwnPool = Boolean(COMPUTE_POOL_ID);
  const poolKey = usingOwnPool ? 'COMPUTE_SUI' : REFERENCE_POOL_KEY;

  // isBid=false => asks (people selling base for quote), prices ascending from mid.
  const asks = await db.getLevel2Range(poolKey, 0.0000001, 1_000_000, false);
  const bids = await db.getLevel2Range(poolKey, 0.0000001, 1_000_000, true);
  const bestAsk = asks?.prices?.length ? Number(asks.prices[0]) : null;
  const bestBid = bids?.prices?.length ? Number(bids.prices[0]) : null;
  const mid =
    bestAsk != null && bestBid != null ? (bestAsk + bestBid) / 2 : bestAsk ?? bestBid;

  // The rate to *buy* compute is the best ask (cheapest provider). Fall back to mid/bid so a
  // one-sided book still yields a number.
  const suiPerComputeUnit = bestAsk ?? mid ?? bestBid;

  return {
    ok: suiPerComputeUnit != null,
    live: true,
    source: usingOwnPool ? 'COMPUTE_SUI' : `reference:${REFERENCE_POOL_KEY}`,
    poolId: usingOwnPool ? COMPUTE_POOL_ID : pools[REFERENCE_POOL_KEY]?.address ?? null,
    poolKey,
    bestAsk,
    bestBid,
    mid,
    suiPerComputeUnit,
    note: usingOwnPool
      ? 'live best-ask from the marketplace COMPUTE/SUI pool'
      : `no COMPUTE pool yet -- reading live ${REFERENCE_POOL_KEY} best-ask as a stand-in compute rate`,
  };
}

async function info() {
  return {
    rpc: RPC_URL,
    network: NETWORK,
    computeType: COMPUTE_TYPE,
    computeTreasury: COMPUTE_TREASURY,
    computePoolId: COMPUTE_POOL_ID || null,
    balanceManagerId: BALANCE_MANAGER_ID || null,
    referencePool: REFERENCE_POOL_KEY,
    referencePoolId: pools[REFERENCE_POOL_KEY]?.address ?? null,
  };
}

// ---- one-shot setup ops (write txs; need SUI_PLATFORM_KEY) -------------------------------

async function signAndRun(tx) {
  const signer = keypairFromEnv();
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  const res = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  return res;
}

/** Mint COMPUTE supply to the platform (or a given recipient). amount is whole COMPUTE. */
async function mint(amountWhole, recipient) {
  const signer = keypairFromEnv();
  const to = recipient || signer.toSuiAddress();
  const base = BigInt(Math.round(Number(amountWhole) * COMPUTE_SCALAR));
  const tx = new Transaction();
  tx.moveCall({
    target: `${COMPUTE_PKG}::compute::mint`,
    arguments: [tx.object(COMPUTE_TREASURY), tx.pure.u64(base), tx.pure.address(to)],
  });
  const res = await signAndRun(tx);
  return { digest: res.digest, minted: amountWhole, recipient: to, type: COMPUTE_TYPE };
}

/** Create a shared BalanceManager (DeepBook account abstraction) owned by the platform. */
async function createManager() {
  const db = makeClient(true);
  const tx = new Transaction();
  tx.setSenderIfNotSet(keypairFromEnv().toSuiAddress());
  db.balanceManager.createAndShareBalanceManager()(tx);
  const res = await signAndRun(tx);
  const created = (res.objectChanges || []).find(
    (c) => c.type === 'created' && /BalanceManager/.test(c.objectType || ''),
  );
  return { digest: res.digest, balanceManagerId: created?.objectId ?? null };
}

/** Create the permissionless COMPUTE/SUI pool. Costs ~500 DEEP (funding-gated). */
async function createPool() {
  const db = makeClient(true);
  const tx = new Transaction();
  // base=COMPUTE, quote=SUI; conservative tick/lot/min for a play-money demo pool. The SDK
  // pulls the 500 DEEP creation fee automatically via coinWithBalance.
  db.deepBook.createPermissionlessPool({
    baseCoinKey: 'COMPUTE',
    quoteCoinKey: 'SUI',
    tickSize: 0.0001,
    lotSize: 0.1,
    minSize: 1,
  })(tx);
  const res = await signAndRun(tx);
  const created = (res.objectChanges || []).find(
    (c) => c.type === 'created' && /::pool::Pool</.test(c.objectType || ''),
  );
  return { digest: res.digest, poolId: created?.objectId ?? null };
}

const OP = process.argv[2];
const ARGS = process.argv.slice(3);

const ops = {
  info,
  price: readPrice,
  mint: () => mint(ARGS[0], ARGS[1]),
  'create-manager': createManager,
  'create-pool': createPool,
};

const fn = ops[OP];
if (!fn) {
  console.log(JSON.stringify({ ok: false, error: `unknown op '${OP}'`, ops: Object.keys(ops) }));
  process.exit(1);
}
fn()
  .then((out) => {
    console.log(JSON.stringify(out));
  })
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    process.exit(1);
  });
