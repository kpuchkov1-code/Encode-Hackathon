/*
  Builds the escrow-lock transaction the researcher signs with their own wallet. This is a
  1:1 port of the backend's proven /jobs/<id>/pay logic (api/index.py), but using the
  bundled @mysten/sui SDK + dapp-kit instead of CDN imports.

  The Move call `<package>::escrow::lock(coin, job_id: vector<u8>, arbiter: address)` creates
  a shared Escrow object holding the coin. We split exactly `amount_mist` off the gas coin,
  pass the opaque job id (UTF-8 bytes) and the platform arbiter address, and after execution
  pull the created Escrow object id out of objectChanges to hand back to the backend.
*/

import { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { PaymentIntent } from "./api";

/** Construct (but don't sign) the lock transaction for a given payment intent + sender. */
export function buildLockTransaction(
  intent: PaymentIntent,
  sender: string,
): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const [coin] = tx.splitCoins(tx.gas, [BigInt(intent.amount_mist)]);
  tx.moveCall({
    target: `${intent.package_id}::${intent.module}::lock`,
    arguments: [
      coin,
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(intent.job_id))),
      tx.pure.address(intent.arbiter as string),
    ],
  });
  return tx;
}

/** After the lock tx is executed, resolve the created Escrow object id from chain. */
export async function findEscrowObjectId(
  client: SuiJsonRpcClient,
  digest: string,
): Promise<string> {
  const full = await client.waitForTransaction({
    digest,
    options: { showObjectChanges: true },
  });
  const created = (full.objectChanges || []).find(
    (o) =>
      o.type === "created" &&
      "objectType" in o &&
      typeof o.objectType === "string" &&
      o.objectType.endsWith("::escrow::Escrow"),
  );
  if (!created || !("objectId" in created)) {
    throw new Error(`escrow object not found in tx ${digest}`);
  }
  return created.objectId;
}
