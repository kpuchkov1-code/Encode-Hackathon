"use client";

/*
  Wallet-connect + sign-the-escrow-lock step. The React equivalent of the backend's
  /jobs/<id>/pay page, using dapp-kit. Flow:

    1. confirm the job  -> get the PaymentIntent (price in MIST, package, arbiter)
    2. connect a Sui wallet (dapp-kit ConnectButton)
    3. build + sign the lock tx with the user's own wallet (their coins, their key)
    4. resolve the created Escrow object id, POST it to /escrow-locked (backend verifies
       on-chain and queues the job), then continue to the live job view.

  If the backend is off-chain (onchain:false), confirm already queued the job and we skip
  straight to the job view — no wallet needed.
*/

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { confirmJob, recordEscrowLock, ApiError, type PaymentIntent } from "@/lib/api";
import { buildLockTransaction, findEscrowObjectId } from "@/lib/escrow";

type Phase = "loading" | "need_wallet" | "ready" | "signing" | "verifying" | "done" | "error";

export default function PayPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id;
  const search = useSearchParams();
  const pdb = search.get("pdb") ?? "";
  const router = useRouter();

  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("Confirming your job…");

  const goToJob = useCallback(() => {
    const q = pdb ? `?pdb=${encodeURIComponent(pdb)}` : "";
    router.push(`/jobs/${jobId}${q}`);
  }, [router, jobId, pdb]);

  // Step 1: confirm -> payment intent (or off-chain -> straight to job view).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmJob(jobId);
        if (cancelled) return;
        if (!res.payment || !res.payment.onchain) {
          setMessage("Job queued. Redirecting…");
          setPhase("done");
          goToJob();
          return;
        }
        setIntent(res.payment);
        setPhase("need_wallet");
        setMessage("Connect your Sui wallet to lock the escrow.");
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setMessage(e instanceof ApiError ? e.message : "Could not confirm job.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, goToJob]);

  // Reflect wallet connection in the phase (without clobbering an in-flight sign).
  useEffect(() => {
    if (!intent) return;
    setPhase((p) =>
      p === "need_wallet" || p === "ready"
        ? account
          ? "ready"
          : "need_wallet"
        : p,
    );
  }, [account, intent]);

  async function pay() {
    if (!intent || !account) return;
    try {
      setPhase("signing");
      setMessage("Approve the payment in your wallet…");
      const tx = buildLockTransaction(intent, account.address);
      const res = await signAndExecute({ transaction: tx });

      setPhase("verifying");
      setMessage(`Locked. Confirming on-chain (tx ${res.digest.slice(0, 10)}…)…`);
      const escrowObjectId = await findEscrowObjectId(client, res.digest);

      setMessage("Verifying the lock with the marketplace…");
      await recordEscrowLock(jobId, escrowObjectId);

      setPhase("done");
      setMessage("Paid and queued! Redirecting…");
      goToJob();
    } catch (e) {
      setPhase("error");
      setMessage(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Payment failed.",
      );
    }
  }

  const sui = intent ? intent.amount_mist / 1_000_000_000 : 0;
  const busy = phase === "signing" || phase === "verifying";

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Pay for job</h1>
      {intent && (
        <p className="mt-3 text-sm text-neutral-400">
          Lock <strong className="text-neutral-100">{sui} SUI</strong> (${intent.price}) into
          on-chain escrow — released to the provider only on a verified result, refunded to you
          if the job fails. You sign with your own wallet; we never hold your key.
        </p>
      )}

      <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <div className="mb-4">
          <ConnectButton />
        </div>

        <p
          className={`text-sm ${
            phase === "error" ? "text-red-400" : phase === "done" ? "text-emerald-400" : "text-neutral-300"
          }`}
        >
          {message}
        </p>

        {phase === "ready" && (
          <button
            onClick={pay}
            className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black hover:bg-emerald-400"
          >
            Pay &amp; lock {sui} SUI
          </button>
        )}
        {busy && <p className="mt-4 animate-pulse text-sm text-neutral-500">Working…</p>}
        {phase === "error" && (
          <button
            onClick={() => {
              setPhase(account ? "ready" : "need_wallet");
              setMessage(account ? "Ready." : "Connect your Sui wallet to lock the escrow.");
            }}
            className="mt-4 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800"
          >
            Try again
          </button>
        )}
      </div>

      <p className="mt-6 text-xs text-neutral-600">
        Job ID: <code className="text-neutral-500">{jobId}</code>
      </p>
    </main>
  );
}
