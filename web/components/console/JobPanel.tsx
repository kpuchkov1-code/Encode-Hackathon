"use client";

/*
  Docking job panel — the buyer-side submit surface, now living in the console's LEFT pane.
  The chat fills the draft (ligands + pocket via client tools); the user reviews, edits, and
  clicks "Run job" — the ONLY action that calls POST /jobs. Once a job exists, the lifecycle
  cards (stepper / escrow / results / proof) render inline below, driven by the same SWR
  polling hooks the status page uses.

  Backend alignment (see api/index.py):
   - Ligands are SDF only. The control plane is dependency-light (no RDKit), so it cannot
     embed 3D coordinates from a SMILES string — `_ligands_to_sdf` 400s on a SMILES-only
     ligand. The editor therefore accepts uploaded .sdf/.mol files exclusively.
   - There is no payment input. Price is ALWAYS server-computed (POST /jobs/estimate, then
     locked at the pay step); the panel shows that quote read-only.
   - There is no provider picker. `payment.supplier_id` is "any"; the control plane assigns
     each job FIFO to whichever registered worker daemon claims it.
*/

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useJobDraft } from "@/lib/jobStore";
import { useStructure } from "@/lib/structureStore";
import { createJob, estimateJob, ApiError, type JobEstimate } from "@/lib/api";
import { useJob, useEscrow, useResult, useProof } from "@/lib/hooks";
import { stateReached } from "@/lib/types";
import { ligandPreview, parseSdf } from "@/lib/ligands";
import { PipelineStepper } from "../PipelineStepper";
import { EscrowPanel } from "../EscrowPanel";
import { ResultsTable } from "../ResultsTable";
import { ProofPanel } from "../ProofPanel";

export function JobPanel() {
  const job = useJobDraft();
  const router = useRouter();
  const account = useCurrentAccount();
  const { pdbId, uploaded, source, receptor, text: receptorText } = useStructure();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Rehydrate an in-flight job from ?job=<id> on first load.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("job");
    if (id && !job.jobId) job.setJobId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { draft, jobId } = job;

  async function run() {
    setErr(null);
    if (draft.ligands.length === 0) {
      setErr("upload at least one ligand SDF before running");
      return;
    }
    if (draft.ligands.some((l) => !l.sdf)) {
      setErr("every ligand must be an SDF — remove SMILES-only entries and upload an .sdf");
      return;
    }
    setRunning(true);
    try {
      const spec = { ...job.buildSpec(receptor), researcher: account?.address };
      const res = await createJob(spec);
      // The backend creates the job in `pending_payment`; the pay page runs confirm ->
      // (off-chain: queue) or (on-chain: wallet lock) and shows the real backend price.
      if (res.state === "pending_payment") {
        const q = pdbId ? `?pdb=${encodeURIComponent(pdbId)}` : "";
        router.push(`/jobs/${res.job_id}/pay${q}`);
        return;
      }
      job.setJobId(res.job_id);
      window.history.replaceState({}, "", `?job=${res.job_id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "submit failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {jobId ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-accent-bright">
                Active job
              </span>
              <span className="font-mono text-[10px] text-muted">{jobId.slice(0, 12)}…</span>
            </div>
            <Lifecycle jobId={jobId} />
            <button
              type="button"
              onClick={() => {
                job.setJobId(null);
                window.history.replaceState({}, "", window.location.pathname);
              }}
              className="w-full rounded-lg border border-border bg-surface-2 py-2 font-mono text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-foreground"
            >
              + new job
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Receptor">
              <span className="font-mono text-sm text-foreground">
                {uploaded ? (
                  <>
                    <span className="text-select-bright">uploaded</span>
                    <span className="ml-1.5 text-muted">{source}</span>
                  </>
                ) : receptorText ? (
                  pdbId || "—"
                ) : (
                  <span className="text-muted">load a structure on the right</span>
                )}
              </span>
            </Field>

            <Field label="Ligands">
              <LigandEditor />
            </Field>

            <Field label="Pocket">
              <span className="font-mono text-sm text-select-bright">
                {draft.pocket ? draft.pocket.label : "auto (select residues to refine)"}
              </span>
            </Field>

            <Field label="Params">
              <div className="flex flex-1 items-center gap-3">
                <NumField
                  label="exh"
                  value={draft.params.exhaustiveness}
                  min={1}
                  max={64}
                  onChange={(v) => job.setParams({ exhaustiveness: v })}
                />
                <NumField
                  label="modes"
                  value={draft.params.num_modes}
                  min={1}
                  max={20}
                  onChange={(v) => job.setParams({ num_modes: v })}
                />
              </div>
            </Field>

            <Field label="Price">
              <PriceQuote />
            </Field>

            {err && <p className="font-mono text-[11px] text-amber-300">{err}</p>}

            <button
              type="button"
              onClick={run}
              disabled={running || draft.ligands.length === 0}
              className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
            >
              {running ? "submitting…" : "Run job ▶"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only, server-computed price. Re-quotes from the backend on ligand/param changes. */
function PriceQuote() {
  const { draft } = useJobDraft();
  const [estimate, setEstimate] = useState<JobEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  useEffect(() => {
    const sdfLigands = draft.ligands.filter((l) => l.sdf);
    if (sdfLigands.length === 0) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        const e = await estimateJob(sdfLigands, draft.params);
        if (!cancelled) setEstimate(e);
      } catch {
        if (!cancelled) setEstimate(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.ligands, draft.params]);

  return (
    <div className="flex-1 space-y-0.5">
      {estimate ? (
        <p className="font-mono text-sm text-foreground">
          {estimate.price}{" "}
          <span className="text-[10px] text-muted">
            ({estimate.num_ligands} ligand{estimate.num_ligands === 1 ? "" : "s"})
          </span>
        </p>
      ) : (
        <p className="font-mono text-sm text-muted">
          {estimating ? "pricing…" : "upload ligands to price"}
        </p>
      )}
      <p className="font-mono text-[10px] text-muted">
        set by the network · locked at payment
      </p>
    </div>
  );
}

/** SDF-only ligand list: editable id + molecule preview per row, plus an .sdf uploader. */
function LigandEditor() {
  const job = useJobDraft();
  const { ligands } = job.draft;
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  async function addSdfFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const texts = await Promise.all(Array.from(list).map((f) => f.text()));
    const parsed = texts.flatMap((t) => parseSdf(t));
    if (parsed.length === 0) {
      setNote("no molecules found in that file");
      return;
    }
    job.addLigands(parsed);
    setNote(`added ${parsed.length} ligand${parsed.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="flex-1 space-y-1.5">
      {ligands.map((l, i) => {
        const invalid = !l.sdf; // SMILES-only (e.g. chat-filled) — backend rejects these
        return (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={l.id}
              onChange={(e) => job.updateLigand(i, { id: e.target.value })}
              placeholder="id"
              className="w-20 shrink-0 rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-accent-bright outline-none focus:border-accent"
            />
            <span
              className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
                invalid ? "text-amber-400" : "text-muted"
              }`}
              title={invalid ? "SMILES is not supported — upload an SDF" : undefined}
            >
              {invalid ? "SMILES — upload SDF instead" : ligandPreview(l)}
            </span>
            <button
              type="button"
              onClick={() => job.removeLigand(i)}
              title="Remove ligand"
              className="shrink-0 px-1 text-muted hover:text-amber-400"
            >
              ×
            </button>
          </div>
        );
      })}

      <input
        ref={fileRef}
        type="file"
        accept=".sdf,.mol"
        multiple
        className="hidden"
        onChange={(e) => {
          addSdfFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="rounded-md border border-dashed border-border px-2.5 py-1 font-mono text-[10px] text-muted hover:border-accent/50 hover:text-foreground"
      >
        + add ligand SDF
      </button>

      {note && (
        <p className="font-mono text-[10px] text-accent-bright">{note}</p>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-14 rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-foreground outline-none focus:border-accent"
      />
    </label>
  );
}

function Lifecycle({ jobId }: { jobId: string }) {
  const { job: status } = useJob(jobId);
  const escrow = useEscrow(jobId, status?.state);
  const result = useResult(jobId, status?.state);
  const proof = useProof(jobId, status?.state);
  const state = status?.state;

  return (
    <div className="space-y-3">
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
