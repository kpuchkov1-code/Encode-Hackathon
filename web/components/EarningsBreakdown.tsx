"use client";

import { SponsorBadge } from "./SponsorBadge";
import { TAKE_RATE_PCT, sparklinePath } from "@/lib/provider";

// Provider earnings panel: the real take-rate math (gross -> Solvimon fee -> net) plus
// a dependency-free cumulative-earnings sparkline. All values are derived from settled
// escrow data upstream; this component only renders.

export function EarningsBreakdown({
  gross,
  fee,
  net,
  series,
}: {
  gross: number;
  fee: number;
  net: number;
  series: number[];
}) {
  const W = 260;
  const H = 56;
  const path = sparklinePath(series, W, H);
  const hasData = gross > 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Earnings</h2>
        <span className="text-[11px] text-muted">
          metered by <SponsorBadge name="Solvimon" />
        </span>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
        <dl className="space-y-2 text-sm">
          <Row label="Gross rewards" value={gross} mono />
          <Row
            label={`Marketplace take-rate (${TAKE_RATE_PCT}%)`}
            value={hasData ? -fee : 0}
            tone="muted"
            mono
          />
          <div className="border-t border-border pt-2">
            <Row label="Net payout" value={net} accent mono big />
          </div>
        </dl>

        <div className="flex flex-col justify-end">
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full max-w-[260px]"
            role="img"
            aria-label="Cumulative earnings over settled jobs"
          >
            {hasData && series.length > 0 ? (
              <>
                <path
                  d={`${path} L${W},${H} L0,${H} Z`}
                  fill="rgba(59,130,246,0.10)"
                />
                <path
                  d={path}
                  fill="none"
                  stroke="var(--color-accent-bright)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              <line
                x1="0"
                y1={H - 1}
                x2={W}
                y2={H - 1}
                stroke="var(--color-border)"
                strokeWidth="1"
              />
            )}
          </svg>
          <span className="mt-1 text-right text-[10px] uppercase tracking-wider text-muted">
            cumulative · {series.length} settled
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  tone,
  mono,
  big,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "muted";
  mono?: boolean;
  big?: boolean;
}) {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value).toLocaleString();
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={tone === "muted" ? "text-muted" : "text-foreground/90"}>
        {label}
      </dt>
      <dd
        className={`${mono ? "font-mono" : ""} ${big ? "text-xl" : "text-sm"} ${
          accent ? "text-accent-bright" : tone === "muted" ? "text-muted" : "text-foreground"
        }`}
      >
        {sign}
        {abs}
        <span className="ml-1 text-[11px] text-muted">credits</span>
      </dd>
    </div>
  );
}
