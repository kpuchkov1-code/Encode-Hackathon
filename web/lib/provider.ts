// Pure derivation helpers for the provider (seller) dashboard.
//
// Everything the dashboard shows about a node — earnings, reputation, utilization,
// the take-rate breakdown, the earnings sparkline — is derived HERE from real job +
// escrow data, so the UI has no hidden invented telemetry. These functions are pure
// (no React, no I/O) and are the unit-test targets for the seller view.

import type { Escrow, JobListItem, JobState } from "./types";

/** Marketplace take-rate (Solvimon). The provider nets `1 - rate` of the reward. */
export const TAKE_RATE_PCT = 15;

/** Job states where a held escrow means the provider is actively working. */
const IN_FLIGHT: ReadonlySet<JobState> = new Set<JobState>([
  "running",
  "docked",
  "proven",
]);

export interface ProviderStats {
  /** Sum of released escrow amounts for this node (gross, before take-rate). */
  earned: number;
  /** Sum of held escrow amounts for this node (work in progress / awaiting settle). */
  pending: number;
  /** Count of jobs released to this node. */
  completed: number;
  /** Count of jobs refunded (failed) while assigned to this node. */
  refunded: number;
  /** Count of this node's jobs currently mid-pipeline. */
  inFlight: number;
}

type EscrowMap = Record<string, Pick<Escrow, "amount" | "state" | "supplier_id">>;

/** Aggregate a node's earnings and job counts from the live job + escrow data. */
export function deriveStats(
  jobs: JobListItem[],
  escrows: EscrowMap,
  nodeId: string,
): ProviderStats {
  let earned = 0;
  let pending = 0;
  let completed = 0;
  let refunded = 0;
  let inFlight = 0;

  for (const job of jobs) {
    const e = escrows[job.job_id];
    if (!e || e.supplier_id !== nodeId) continue;
    if (e.state === "released") {
      earned += e.amount;
      completed += 1;
    } else if (e.state === "refunded") {
      refunded += 1;
    } else if (e.state === "held") {
      pending += e.amount;
      if (IN_FLIGHT.has(job.state)) inFlight += 1;
    }
  }

  return { earned, pending, completed, refunded, inFlight };
}

/**
 * Reputation as a real success rate: released / (released + refunded), as a percentage.
 * Returns null when the node has no settled track record yet (show a baseline / "—").
 */
export function deriveReliability(
  completed: number,
  refunded: number,
): number | null {
  const total = completed + refunded;
  if (total === 0) return null;
  return Math.round((completed / total) * 1000) / 10; // one decimal place
}

/** Utilization = in-flight jobs vs the node's concurrent capacity, bounded to 0–100%. */
export function deriveUtilization(inFlight: number, capacity = 4): number {
  if (capacity <= 0) return 0;
  return Math.min(100, Math.round((inFlight / capacity) * 100));
}

export interface EarningsBreakdown {
  gross: number;
  fee: number;
  net: number;
}

/** Split gross earnings into the marketplace fee (Solvimon) and the provider's net. */
export function earningsBreakdown(
  gross: number,
  takeRatePct: number = TAKE_RATE_PCT,
): EarningsBreakdown {
  const fee = Math.round((gross * takeRatePct) / 100);
  return { gross, fee, net: gross - fee };
}

/** Running cumulative totals — input to the earnings sparkline. */
export function cumulative(amounts: number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const a of amounts) {
    sum += a;
    out.push(sum);
  }
  return out;
}

/**
 * Build an SVG polyline path for `values` scaled into a `w`×`h` box (y inverted so
 * larger values sit higher). Returns "" for an empty series. No charting dependency.
 */
export function sparklinePath(values: number[], w: number, h: number): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `M0,${h} L${w},0`;
  const max = Math.max(...values, 1);
  const stepX = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (h - (v / max) * h).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}
