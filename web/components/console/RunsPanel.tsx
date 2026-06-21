"use client";

/*
  Job history. Backs onto the contract's GET /jobs (list) — previously only the seller
  dashboard consumed it; the buyer console had no way to see past/active runs once you
  navigated away from a ?job=<id> URL. Clicking a run rehydrates the console onto it.
*/

import { useJobsList } from "@/lib/hooks";
import { useJobDraft } from "@/lib/jobStore";
import type { JobState } from "@/lib/types";

const STATE_DOT: Record<JobState, string> = {
  pending_payment: "bg-amber-300",
  queued: "bg-amber-400",
  running: "bg-accent",
  docked: "bg-sky-400",
  proven: "bg-violet-400",
  settled: "bg-green-500",
  failed: "bg-red-500",
};

export function RunsPanel() {
  const { jobs } = useJobsList();
  const job = useJobDraft();

  const sorted = [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at));

  function open(id: string) {
    job.setJobId(id);
    window.history.replaceState({}, "", `?job=${id}`);
  }

  function startNew() {
    job.setJobId(null);
    window.history.replaceState({}, "", window.location.pathname);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          Runs
        </span>
        {job.jobId && (
          <button
            type="button"
            onClick={startNew}
            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-foreground"
          >
            + new
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sorted.length === 0 ? (
          <p className="px-1 py-1 font-mono text-[10px] text-muted">no runs yet</p>
        ) : (
          <ul className="space-y-1">
            {sorted.map((j) => {
              const active = j.job_id === job.jobId;
              return (
                <li key={j.job_id}>
                  <button
                    type="button"
                    onClick={() => open(j.job_id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "border-accent/50 bg-accent/10"
                        : "border-border bg-surface hover:border-accent/40"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[j.state]}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                      {j.job_id.slice(0, 8)}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-muted">
                      {j.state}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
