/**
 * DeepBook v3 bridge -- on-chain settlement LOG for the docking marketplace.
 *
 * DeepBook here is a public, tamper-evident ledger of marketplace activity: when a job
 * settles, we place a tiny marker order on an existing testnet pool, and that order is a
 * permanent on-chain DeepBook event anyone can inspect on Suiscan. It is NOT a price oracle
 * and NOT a matcher -- pricing is a fixed platform rate and matching/settlement is done by
 * the pull queue + Sui escrow. (A future version could turn this into a real compute market
 * with provider-quoted prices; that needs a funded pool, out of scope for now.)
 *
 * Why an existing pool (DEEP/SUI): creating our own pool costs a fixed 500-DEEP fee. By
 * logging onto the existing, zero-fee DEEP/SUI pool we avoid that fee entirely -- a marker
 * order needs only a sliver of SUI and gas, no DEEP at all.
 *
 * Privacy: the marker carries only an opaque compute-unit COUNT (the ligand count), encoded
 * as the order quantity / client order id. Nothing job-, protein-, or ligand-identifying
 * ever touches the public book -- same rule as Walrus and the escrow contract.
 *
 * Isolated from the v1 escrow bridge (sui-bridge/) because DeepBook needs @mysten/sui v2.
 */
import { DeepBookClient } from '@mysten/deepbook-v3';
import { testnetCoins, testnetPools } from '@mysten/deepbook-v3';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const RPC_URL = process.env.SUI_RPC_URL || getJsonRpcFullnodeUrl('testnet');
const NETWORK = process.env.SUI_NETWORK || 'testnet';

// The existing pool we log onto. DEEP/SUI is zero-fee (taker/maker = 0), so marker orders
// need no DEEP -- only the SUI side and gas.
const LOG_POOL = process.env.DEEPBOOK_LOG_POOL || 'DEEP_SUI';
const BALANCE_MANAGER_ID = process.env.DEEPBOOK_BALANCE_MANAGER_ID || '';

// Marker order shape, kept at the pool minimum so each log entry locks a negligible amount
// and never executes (price sits far below market). DEEP/SUI: lotSize 1, minSize 10,
// tickSize 0.00001 -- so 10 units @ 0.00001 SUI locks ~0.0001 SUI.
const MARKER_QTY = Number(process.env.DEEPBOOK_MARKER_QTY || '10');
const MARKER_PRICE = Number(process.env.DEEPBOOK_MARKER_PRICE || '0.00001');

const coins = { ...testnetCoins };
const pools = { ...testnetPools };

function keypairFromEnv() {
  const key = process.env.SUI_PLATFORM_KEY;
  if (!key) throw new Error('SUI_PLATFORM_KEY required for this op');
  return Ed25519Keypair.fromSecretKey(key.trim());
}

function makeClient(withManager = false) {
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  const opts = { client, network: NETWORK, coins, pools, address: '0x0' };
  if (process.env.SUI_PLATFORM_KEY) opts.address = keypairFromEnv().toSuiAddress();
  if (withManager && BALANCE_MANAGER_ID) {
    opts.balanceManagers = { MAIN: { address: BALANCE_MANAGER_ID } };
  }
  return new DeepBookClient(opts);
}

async function signAndRun(tx) {
  const signer = keypairFromEnv();
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  return client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
}

const createdId = (res, re) =>
  (res.objectChanges || []).find((c) => c.type === 'created' && re.test(c.objectType || ''))?.objectId ?? null;

async function info() {
  return {
    rpc: RPC_URL,
    network: NETWORK,
    logPool: LOG_POOL,
    logPoolId: pools[LOG_POOL]?.address ?? null,
    balanceManagerId: BALANCE_MANAGER_ID || null,
    markerQty: MARKER_QTY,
    markerPrice: MARKER_PRICE,
  };
}

/** One-time: create the platform's BalanceManager (DeepBook custody object). */
async function createManager() {
  const db = makeClient(false);
  const tx = new Transaction();
  tx.setSenderIfNotSet(keypairFromEnv().toSuiAddress());
  db.balanceManager.createAndShareBalanceManager()(tx);
  const res = await signAndRun(tx);
  return {
    ok: res.effects?.status?.status === 'success',
    digest: res.digest,
    balanceManagerId: createdId(res, /BalanceManager/),
  };
}

/** One-time: fund the BalanceManager so marker orders have something to lock. */
async function deposit(coinKey, amount) {
  if (!BALANCE_MANAGER_ID) throw new Error('DEEPBOOK_BALANCE_MANAGER_ID required');
  const db = makeClient(true);
  const tx = new Transaction();
  tx.setSenderIfNotSet(keypairFromEnv().toSuiAddress());
  db.balanceManager.depositIntoManager('MAIN', coinKey, Number(amount))(tx);
  const res = await signAndRun(tx);
  return { ok: res.effects?.status?.status === 'success', digest: res.digest, coin: coinKey, amount: Number(amount) };
}

/**
 * Log one settled job: place a marker order whose client-order-id carries the opaque
 * compute-unit count. The order rests far below market (never executes); the transaction
 * itself is the permanent on-chain record. Returns the tx digest for a Suiscan link.
 */
async function log(computeUnits) {
  if (!BALANCE_MANAGER_ID) throw new Error('DEEPBOOK_BALANCE_MANAGER_ID required');
  const units = Math.max(1, Math.floor(Number(computeUnits) || 1));
  const db = makeClient(true);
  const tx = new Transaction();
  tx.setSenderIfNotSet(keypairFromEnv().toSuiAddress());
  db.deepBook.placeLimitOrder({
    poolKey: LOG_POOL,
    balanceManagerKey: 'MAIN',
    clientOrderId: String(units), // opaque compute-unit count -- no job/molecule identity
    price: MARKER_PRICE,
    quantity: MARKER_QTY,
    isBid: true, // buy side: locks only the SUI quote, needs no DEEP inventory
    payWithDeep: false, // zero-fee pool, so no DEEP needed for fees either
  })(tx);
  const res = await signAndRun(tx);
  return {
    ok: res.effects?.status?.status === 'success',
    digest: res.digest,
    pool: LOG_POOL,
    poolId: pools[LOG_POOL]?.address ?? null,
    computeUnits: units,
    error: res.effects?.status?.error || null,
  };
}

const OP = process.argv[2];
const ARGS = process.argv.slice(3);
const ops = {
  info,
  'create-manager': createManager,
  deposit: () => deposit(ARGS[0], ARGS[1]),
  log: () => log(ARGS[0]),
};

const fn = ops[OP];
if (!fn) {
  console.log(JSON.stringify({ ok: false, error: `unknown op '${OP}'`, ops: Object.keys(ops) }));
  process.exit(1);
}
fn()
  .then((out) => console.log(JSON.stringify(out)))
  .catch((err) => {
    console.log(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    process.exit(1);
  });
