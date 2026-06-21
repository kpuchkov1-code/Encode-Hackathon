"use client";

import type { Escrow } from "@/lib/types";
import { SponsorBadge } from "./SponsorBadge";

const STATE_STYLES: Record<Escrow["state"], { dot: string; text: string; label: string }> = {
  held: { dot: "bg-amber-500", text: "text-amber-300", label: "Held in escrow" },
  released: { dot: "bg-green-500", text: "text-green-300", label: "Released to supplier" },
  refunded: { dot: "bg-red-500", text: "text-red-300", label: "Refunded to buyer" },
};

const TAKE_RATE = 0.15;

export function EscrowPanel({ escrow }: { escrow: Escrow | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Payment</h2>
          <SponsorBadge name="DeepBook" />
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
              <span className="text-xs text-muted">credits</span>
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
          <p className="text-[11px] text-muted">
            Settled on-chain via DeepBook order-book escrow.
          </p>
        </div>
      )}
    </div>
  );
}
