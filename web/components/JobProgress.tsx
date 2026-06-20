"use client";

import { LIFECYCLE, type JobState } from "@/lib/types";

// Compact inline 5-dot lifecycle stepper for a single job row on the provider feed.
// Mirrors the buyer-side PipelineStepper so the two sides read as one marketplace.

const SHORT: Record<Exclude<JobState, "failed">, string> = {
  queued: "Queued",
  running: "Running",
  docked: "Docked",
  proven: "Proven",
  settled: "Settled",
};

export function JobProgress({ state }: { state: JobState }) {
  if (state === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-300">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        failed · refunded
      </span>
    );
  }

  const lifecycle = LIFECYCLE as readonly JobState[];
  const currentIdx = lifecycle.indexOf(state);

  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex items-center gap-1" aria-hidden>
        {lifecycle.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <span
              key={step}
              className={`h-1.5 w-1.5 rounded-full ${
                done
                  ? "bg-accent/60"
                  : active
                    ? "animate-node-pulse bg-accent"
                    : "bg-surface-2"
              }`}
            />
          );
        })}
      </span>
      <span className="font-mono text-[11px] text-accent-bright">
        {SHORT[state as Exclude<JobState, "failed">]}
      </span>
    </span>
  );
}
