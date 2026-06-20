"use client";

/*
  Hybrid submit panel. The chat fills it (ligands, pocket, payment); the user reviews,
  edits, and clicks Run — the ONLY action that calls POST /jobs. Once a job exists, the
  lifecycle cards (stepper / escrow / results / proof) render inline below, driven by the
  same SWR polling hooks the old status page used.
*/

import { useEffect, useState } from "react";
import { useJobDraft } from "@/lib/jobStore";
import { useStructure } from "@/lib/structureStore";
import { createJob, ApiError } from "@/lib/api";
import { useJob, useEscrow, useResult, useProof } from "@/lib/hooks";
import { stateReached } from "@/lib/types";
import { PipelineStepper } from "../PipelineStepper";
import { EscrowPanel } from "../EscrowPanel";
import { ResultsTable } from "../ResultsTable";
import { ProofPanel } from "../ProofPanel";

export function JobPanel() {
  const job = useJobDraft();
  const { pdbId } = useStructure();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Rehydrate an in-flight job from ?job=<id> on first load.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id && !job.jobId) job.setJobId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { draft, jobId } = job;
  const hasDraft = draft.ligands.length > 0 || draft.pocket !== null;
  if (!hasDraft && !jobId) return null;

  async function run() {
    setErr(null);
    if (draft.ligands.length === 0) {
      setErr("add at least one ligand before running");
      return;
    }
    setRunning(true);
    try {
      const spec = job.buildSpec(pdbId);
      const res = await createJob(spec);
      job.setJobId(res.job_id);
      window.history.replaceState({}, "", `?job=${res.job_id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "submit failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent-bright">
          Docking job
        </span>
        {jobId && (
          <span className="font-mono text-[10px] text-muted">{jobId.slice(0, 12)}…</span>
        )}
      </div>

      {!jobId && (
        <div className="space-y-3 px-4 py-3">
          <Field label="Receptor">
            <span className="font-mono text-sm text-foreground">{pdbId || "—"}</span>
          </Field>

          <Field label="Ligands">
            <div className="flex-1 space-y-1.5">
              {draft.ligands.length === 0 && (
                <button
                  type="button"
                  onClick={job.loadSampleLigands}
                  className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-foreground"
                >
                  load sample (aspirin + decoy)
                </button>
              )}
              {draft.ligands.map((l, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-accent-bright">{l.id}</span>
                  <span className="truncate text-muted">{l.smiles}</span>
                </div>
              ))}
            </div>
          </Field>

          <Field label="Pocket">
            <span className="font-mono text-sm text-select-bright">
              {draft.pocket ? draft.pocket.label : "auto (select residues to refine)"}
            </span>
          </Field>

          <Field label="Payment">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={draft.amount}
                onChange={(e) => job.setAmount(Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm text-foreground outline-none focus:border-accent"
              />
              <span className="font-mono text-xs text-muted">· {draft.supplierId}</span>
            </div>
          </Field>

          {err && <p className="font-mono text-[11px] text-amber-300">{err}</p>}

          <button
            type="button"
            onClick={run}
            disabled={running}
            className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
          >
            {running ? "submitting…" : "Run screen ▶"}
          </button>
        </div>
      )}

      {jobId && <Lifecycle jobId={jobId} />}
    </div>
  );
}

function Lifecycle({ jobId }: { jobId: string }) {
  const { job: status } = useJob(jobId);
  const escrow = useEscrow(jobId, status?.state);
  const result = useResult(jobId, status?.state);
  const proof = useProof(jobId, status?.state);
  const state = status?.state;

  return (
    <div className="space-y-3 px-4 py-3">
      {state && <PipelineStepper state={state} />}
      {state === "failed" && status?.reason && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-300">
          failed: {status.reason}
        </p>
      )}
      <EscrowPanel escrow={escrow} />
      {state && stateReached(state, "docked") && <ResultsTable result={result} />}
      {state && stateReached(state, "proven") && <ProofPanel proof={proof} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
