"use client";

import type { Escrow } from "@/lib/types";
import { SponsorBadge } from "./SponsorBadge";
import { suiscan, short } from "@/lib/explorer";

const STATE_STYLES: Record<Escrow["state"], { dot: string; text: string; label: string }> = {
  held: { dot: "bg-amber-500", text: "text-amber-300", label: "Held in escrow" },
  released: { dot: "bg-green-500", text: "text-green-300", label: "Released to supplier" },
  refunded: { dot: "bg-red-500", text: "text-red-300", label: "Refunded to buyer" },
};

const TAKE_RATE = 0.15;

function OnChainLink({
  label,
  href,
  value,
}: {
  label: string;
  href?: string | false;
  value?: string;
}) {
  if (!href || !value) return null;
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-accent-bright hover:underline"
      >
        {short(value)} ↗
      </a>
    </div>
  );
}

export function EscrowPanel({ escrow }: { escrow: Escrow | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Payment</h2>
          <SponsorBadge name="DeepBook" />
          <SponsorBadge name="Sui" />
        </div>
        {escrow && (
          <span className={`flex items-center gap-2 text-xs ${STATE_STYLES[escrow.state].text}`}>
            <span className={`h-2 w-2 rounded-full ${STATE_STYLES[escrow.state].dot}`} />
            {STATE_STYLES[escrow.state].label}
          </span>
        )}
      </div>

      {!escrow ? (
        <p className="text-sm text-muted">Awaiting escrow…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Amount</span>
            <span className="font-mono text-lg text-foreground">
              {escrow.amount.toLocaleString()}{" "}
              <span className="text-xs text-muted">SUI</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Supplier</span>
            <span className="font-mono text-sm text-foreground">{escrow.supplier_id}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="flex items-center gap-2 text-sm text-muted">
              Marketplace fee <SponsorBadge name="Solvimon" />
            </span>
            <span className="font-mono text-sm text-muted">
              {(escrow.amount * TAKE_RATE).toLocaleString()} (15%)
            </span>
          </div>
          {escrow.chain && (
            <div className="space-y-1 border-t border-border pt-3 text-[11px]">
              <OnChainLink label="Escrow object" href={escrow.chain.escrow_object_id && suiscan.object(escrow.chain.escrow_object_id)} value={escrow.chain.escrow_object_id} />
              <OnChainLink label="Locked by" href={escrow.chain.payer && suiscan.account(escrow.chain.payer)} value={escrow.chain.payer} />
              <OnChainLink label="Lock tx" href={escrow.chain.lock_digest && suiscan.tx(escrow.chain.lock_digest)} value={escrow.chain.lock_digest} />
              <OnChainLink label="Release tx" href={escrow.chain.release_digest && suiscan.tx(escrow.chain.release_digest)} value={escrow.chain.release_digest} />
              <OnChainLink label="Refund tx" href={escrow.chain.refund_digest && suiscan.tx(escrow.chain.refund_digest)} value={escrow.chain.refund_digest} />
              <OnChainLink label="Paid to provider" href={escrow.chain.paid_to && suiscan.account(escrow.chain.paid_to)} value={escrow.chain.paid_to} />
            </div>
          )}
          <p className="text-[11px] text-muted">
            Funds are locked and released on the <span className="text-foreground">Sui blockchain</span>{" "}
            via <span className="text-foreground">DeepBook</span> order-book escrow — held on submit,
            released to the provider only on a verified result, refunded to you if the job fails.
          </p>
        </div>
      )}
    </div>
  );
}
