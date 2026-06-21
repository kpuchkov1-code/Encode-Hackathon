"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEscrow, useJob, useProof, useResult } from "@/lib/hooks";
import { stateReached } from "@/lib/types";
import { PipelineStepper } from "./PipelineStepper";
import { EscrowPanel } from "./EscrowPanel";
import { ResultsTable } from "./ResultsTable";
import { ProofPanel } from "./ProofPanel";
import { ReceptorViewer } from "./ReceptorViewer";
import { JobInfoBlock } from "./JobInfoBlock";

const reveal = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

export function JobView({ id, pdb }: { id: string; pdb: string }) {
  const { job, error } = useJob(id);
  const escrow = useEscrow(id, job?.state);
  const result = useResult(id, job?.state);
  const proof = useProof(id, job?.state);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="text-xl font-semibold">Job not found</h1>
        <p className="mt-2 text-sm text-muted">
          No job with id <span className="font-mono">{id}</span>.
        </p>
        <Link
          href="/submit"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-bright"
        >
          Submit a new job
        </Link>
      </div>
    );
  }

  const state = job?.state;
  const showResults = !!state && stateReached(state, "docked");
  const showProof = !!state && stateReached(state, "proven");

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1fr_420px]">
      {/* LEFT — progressive reveal */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Job status</h1>
            <p className="mt-0.5 font-mono text-xs text-muted">{id}</p>
          </div>
          <Link href="/submit" className="text-sm text-muted hover:text-foreground">
            + new job
          </Link>
        </div>

        <PipelineStepper state={state ?? "queued"} />

        {state === "failed" && job?.reason && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
            <span className="font-medium">Reason:</span> {job.reason}
          </div>
        )}

        <EscrowPanel escrow={escrow} />

        {showResults && (
          <motion.div {...reveal} className="space-y-3">
            <ResultsTable result={result} />
            <a
              href={`/api/jobs/${id}/download`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors hover:border-accent/50"
            >
              ↓ Download results (.zip)
            </a>
          </motion.div>
        )}

        {showProof && (
          <motion.div {...reveal}>
            <ProofPanel proof={proof} />
          </motion.div>
        )}
      </div>

      {/* RIGHT — persistent viewer + metadata */}
      <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="h-[380px]">
          <ReceptorViewer pdbId={pdb} />
        </div>
        <JobInfoBlock job={job} result={result} proof={proof} />
      </div>
    </div>
  );
}
