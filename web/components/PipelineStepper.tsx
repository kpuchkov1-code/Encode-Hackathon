"use client";

import { motion } from "framer-motion";
import { LIFECYCLE, type JobState } from "@/lib/types";

const STEP_META: Record<
  Exclude<JobState, "failed" | "pending_payment">,
  { label: string; hint: string }
> = {
  queued: { label: "Queued", hint: "escrow locked · DeepBook (Sui)" },
  running: { label: "Running", hint: "docking on GPU" },
  docked: { label: "Docked", hint: "results ready" },
  proven: { label: "Proven", hint: "proof on Walrus (Sui)" },
  settled: { label: "Settled", hint: "paid out · DeepBook (Sui)" },
};

type NodeStatus = "done" | "active" | "pending" | "failed";

export function PipelineStepper({ state }: { state: JobState }) {
  const failed = state === "failed";
  const currentIdx = failed
    ? -1
    : (LIFECYCLE as readonly JobState[]).indexOf(state);

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Pipeline</h2>
        <span className="font-mono text-xs text-muted">
          {failed ? "failed" : `${currentIdx + 1} / ${LIFECYCLE.length}`}
        </span>
      </div>

      {failed ? (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-sm text-red-300">
            Job failed — escrow refunded.
          </span>
        </div>
      ) : (
        <ol className="flex items-start justify-between gap-1">
          {LIFECYCLE.map((step, i) => {
            const status: NodeStatus =
              i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
            return (
              <li
                key={step}
                className="flex flex-1 flex-col items-center text-center"
              >
                <div className="flex w-full items-center">
                  <span
                    className={`h-px flex-1 ${i === 0 ? "opacity-0" : status === "pending" ? "bg-border" : "bg-accent/60"}`}
                  />
                  <Node status={status} index={i} />
                  <span
                    className={`h-px flex-1 ${i === LIFECYCLE.length - 1 ? "opacity-0" : status === "done" ? "bg-accent/60" : "bg-border"}`}
                  />
                </div>
                <span
                  className={`mt-2 text-xs font-medium ${status === "pending" ? "text-muted" : "text-foreground"}`}
                >
                  {STEP_META[step].label}
                </span>
                <span className="mt-0.5 text-[10px] text-muted">
                  {STEP_META[step].hint}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Node({ status, index }: { status: NodeStatus; index: number }) {
  const base =
    "relative grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-mono";
  if (status === "done") {
    return (
      <span className={`${base} bg-accent text-white`}>
        <CheckIcon />
      </span>
    );
  }
  if (status === "active") {
    return (
      <motion.span
        className={`${base} animate-node-pulse bg-accent text-white`}
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
      >
        {index + 1}
      </motion.span>
    );
  }
  return (
    <span className={`${base} border border-border bg-surface-2 text-muted`}>
      {index + 1}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
