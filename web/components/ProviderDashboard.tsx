"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { useEscrows, useJobsList } from "@/lib/hooks";
import { ApiError, runJob } from "@/lib/api";
import {
  cumulative,
  deriveReliability,
  deriveStats,
  deriveUtilization,
  earningsBreakdown,
} from "@/lib/provider";
import type { EscrowState, JobListItem, JobState } from "@/lib/types";
import { SponsorBadge } from "./SponsorBadge";
import { JobProgress } from "./JobProgress";
import { EarningsBreakdown } from "./EarningsBreakdown";

// Mocked node identity. Uses node-1 so it owns the sample jobs' escrow → earnings show.
const NODE = {
  id: "node-1",
  gpu: "NVIDIA RTX 4090",
  vram: "24 GB",
  cuda: "CUDA 12.4",
  region: "eu-west-1",
  dlperf: "21.3", // vast.ai-style deep-learning perf score (simulated)
  uptime: "99.9%", // simulated
  capacity: 4, // concurrent jobs this node will take — drives utilization
};

type EscrowMap = Record<
  string,
  { amount: number; state: EscrowState; supplier_id: string }
>;

export function ProviderDashboard() {
  const { jobs, loading } = useJobsList();
  const escrows = useEscrows(jobs.map((j) => j.job_id));
  const { mutate } = useSWRConfig();

  const [online, setOnline] = useState(false);
  const [rate, setRate] = useState(100);
  // Jobs this provider has claimed this session.
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  // Immediate state overlay so a claimed job shows "running" before polling catches up.
  const [optimistic, setOptimistic] = useState<Record<string, JobState>>({});
  // Run requests currently in flight (disable the button, show "starting…").
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // Per-job run errors (409 already-taken / 404 / network).
  const [errors, setErrors] = useState<Record<string, string>>({});

  const stats = useMemo(
    () => deriveStats(jobs, escrows, NODE.id),
    [jobs, escrows],
  );
  const reliability = deriveReliability(stats.completed, stats.refunded);
  const utilization = online ? deriveUtilization(stats.inFlight, NODE.capacity) : 0;
  const breakdown = earningsBreakdown(stats.earned);

  // Cumulative earnings series (chronological) for the sparkline.
  const series = useMemo(() => {
    const settled = [...jobs]
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
      .map((j) => escrows[j.job_id])
      .filter((e) => e && e.supplier_id === NODE.id && e.state === "released")
      .map((e) => e!.amount);
    return cumulative(settled);
  }, [jobs, escrows]);

  const market = useMemo(() => {
    const queued = jobs.filter((j) => j.state === "queued").length;
    const active = jobs.filter((j) =>
      ["running", "docked", "proven"].includes(j.state),
    ).length;
    const amounts = Object.values(escrows).map((e) => e.amount);
    const avg = amounts.length
      ? Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length)
      : 100;
    const open = queued + active;
    const demand = open >= 5 ? "High" : open >= 2 ? "Medium" : "Low";
    return { queued, active, avg, demand };
  }, [jobs, escrows]);

  const isYours = (id: string) =>
    claimed.has(id) || escrows[id]?.supplier_id === NODE.id;

  const displayState = (j: JobListItem): JobState =>
    optimistic[j.job_id] && j.state === "queued" ? optimistic[j.job_id] : j.state;

  async function onRun(id: string) {
    setErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    setBusy((b) => new Set(b).add(id));
    try {
      const res = await runJob(id, NODE.id);
      setClaimed((c) => new Set(c).add(id));
      setOptimistic((o) => ({ ...o, [id]: res.state }));
      // Pull the job list (and let escrow polling re-attribute) ASAP.
      mutate("/api/jobs");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 409
            ? "already taken"
            : err.status === 404
              ? "no longer available"
              : err.message
          : "couldn’t start job";
      setErrors((e) => ({ ...e, [id]: msg }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(id);
        return next;
      });
    }
  }

  const sorted = [...jobs].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="text-xs text-muted hover:text-foreground">
          ← marketplace
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Provider dashboard</h1>
        <p className="mt-0.5 text-sm text-muted">
          Run queued jobs on your idle GPUs and earn on-chain payouts.
        </p>
      </div>

      {/* Top metric row — vast.ai-style */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Net earnings" value={breakdown.net.toLocaleString()} unit="credits" accent />
        <Metric label="Utilization" value={`${utilization}%`}>
          <Bar pct={utilization} />
        </Metric>
        <Metric label="Reliability" value={reliability === null ? "—" : `${reliability}%`}>
          <Bar pct={reliability ?? 0} good />
        </Metric>
        <Metric label="Jobs completed" value={`${stats.completed}`} unit={`${stats.pending.toLocaleString()} pending`} />
      </div>

      <div className="mt-5">
        <EarningsBreakdown
          gross={breakdown.gross}
          fee={breakdown.fee}
          net={breakdown.net}
          series={series}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <MachineCard
          online={online}
          rate={rate}
          onRate={setRate}
          marketAvg={market.avg}
          onToggle={() => setOnline((v) => !v)}
        />
        <MarketPanel {...market} />
      </div>

      <JobFeed
        jobs={sorted}
        escrows={escrows}
        online={online}
        loading={loading}
        busy={busy}
        errors={errors}
        isYours={isYours}
        displayState={displayState}
        onRun={onRun}
      />

      <p className="mt-4 text-[11px] text-muted">
        GPU model, DLPerf and uptime are simulated for the demo. Earnings, reliability,
        utilization, the job feed and market demand are derived from real{" "}
        <SponsorBadge name="DeepBook" /> escrow + job data. The “Run” action calls the real{" "}
        <code className="font-mono">POST /jobs/&lt;id&gt;/run</code> endpoint (mocked today,
        same shape the backend will ship).
      </p>
    </main>
  );
}

function Metric({
  label,
  value,
  unit,
  accent,
  children,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-mono text-2xl ${accent ? "text-accent-bright" : "text-foreground"}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct, good }: { pct: number; good?: boolean }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full ${good ? "bg-green-500" : "bg-accent"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MachineCard({
  online,
  rate,
  onRate,
  marketAvg,
  onToggle,
}: {
  online: boolean;
  rate: number;
  onRate: (n: number) => void;
  marketAvg: number;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Your machine</h2>
        <span className={`flex items-center gap-2 text-xs ${online ? "text-green-300" : "text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${online ? "bg-green-500" : "bg-zinc-600"}`} />
          {online ? "online · idle" : "offline"}
        </span>
      </div>

      {online ? (
        <div className="space-y-2.5">
          <Spec label="node_id" value={NODE.id} />
          <Spec label="gpu" value={`${NODE.gpu} · ${NODE.vram}`} />
          <Spec label="runtime" value={NODE.cuda} />
          <Spec label="region" value={NODE.region} />
          <Spec label="dlperf" value={NODE.dlperf} />
          <Spec label="uptime" value={NODE.uptime} />

          <div className="border-t border-border pt-3">
            <label className="mb-1 block text-xs text-muted">
              On-demand rate (credits / job)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={rate}
                onChange={(e) => onRate(Number(e.target.value))}
                className="input font-mono"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Market avg <span className="font-mono text-foreground/80">{marketAvg}</span> ·{" "}
              {rate <= marketAvg ? "competitive" : "above market"}
            </p>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Take node offline
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Connect your hardware to start accepting jobs. We detect your GPU, benchmark it
            (DLPerf) and register the node on the network.
          </p>
          <button
            type="button"
            onClick={onToggle}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Connect hardware
          </button>
        </div>
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function MarketPanel({
  demand,
  queued,
  active,
  avg,
}: {
  demand: string;
  queued: number;
  active: number;
  avg: number;
}) {
  const tone =
    demand === "High"
      ? "text-green-300 bg-green-500/10 border-green-500/30"
      : demand === "Medium"
        ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
        : "text-muted bg-surface-2 border-border";
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Network demand</h2>
        <span className={`rounded-md border px-2 py-0.5 text-xs ${tone}`}>{demand}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Queued" value={`${queued}`} />
        <MiniStat label="In flight" value={`${active}`} />
        <MiniStat label="Avg reward" value={`${avg}`} />
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        {queued > 0
          ? `${queued} job${queued > 1 ? "s" : ""} waiting for a provider. Price at or below the market average to win them.`
          : "No jobs queued right now. Stay online to catch new work as it arrives."}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-center">
      <div className="font-mono text-lg text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function JobFeed({
  jobs,
  escrows,
  online,
  loading,
  busy,
  errors,
  isYours,
  displayState,
  onRun,
}: {
  jobs: JobListItem[];
  escrows: EscrowMap;
  online: boolean;
  loading: boolean;
  busy: Set<string>;
  errors: Record<string, string>;
  isYours: (id: string) => boolean;
  displayState: (j: JobListItem) => JobState;
  onRun: (id: string) => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Job feed</h2>
        <span className="font-mono text-xs text-muted">{jobs.length} jobs</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading network jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-muted">
          No jobs on the network yet. Submit one from the buy side to see it appear here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-3 font-medium">Job</th>
                <th className="py-2 pr-3 font-medium">State</th>
                <th className="py-2 pr-3 text-right font-medium">Reward</th>
                <th className="py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {jobs.map((j) => {
                const e = escrows[j.job_id];
                const yours = isYours(j.job_id);
                const state = displayState(j);
                const err = errors[j.job_id];
                return (
                  <tr key={j.job_id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-3 align-top text-foreground/90">
                      <div className="flex items-center gap-2">
                        {j.job_id.slice(0, 8)}…
                        {yours && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-bright">
                            you
                          </span>
                        )}
                      </div>
                      {yours && state === "settled" && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
                          released via <SponsorBadge name="DeepBook" /> · proof on{" "}
                          <SponsorBadge name="Walrus" />
                        </div>
                      )}
                      {err && (
                        <div className="mt-1 text-[10px] text-red-300">{err}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      {yours ? (
                        <JobProgress state={state} />
                      ) : (
                        <StateBadge state={state} />
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right align-top text-foreground">
                      {e ? `${e.amount.toLocaleString()}` : "—"}
                    </td>
                    <td className="py-2.5 text-right align-top">
                      <Action
                        state={state}
                        yours={yours}
                        online={online}
                        busy={busy.has(j.job_id)}
                        onRun={() => onRun(j.job_id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    queued: "text-amber-300",
    running: "text-accent-bright",
    docked: "text-accent-bright",
    proven: "text-accent-bright",
    settled: "text-green-300",
    failed: "text-red-300",
  };
  return <span className={map[state] ?? "text-muted"}>{state}</span>;
}

function Action({
  state,
  yours,
  online,
  busy,
  onRun,
}: {
  state: string;
  yours: boolean;
  online: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  if (state === "settled") return <span className="text-green-300">+ paid</span>;
  if (state === "failed") return <span className="text-muted">refunded</span>;
  if (state === "queued") {
    return (
      <button
        type="button"
        onClick={onRun}
        disabled={!online || busy}
        title={online ? "Claim and run this job" : "Connect your node first"}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-40"
      >
        {busy ? "starting…" : "Run"}
      </button>
    );
  }
  // running / docked / proven
  return (
    <span className="text-xs text-muted">{yours ? "you · running" : "running…"}</span>
  );
}
