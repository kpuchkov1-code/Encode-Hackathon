"use client";

/*
  Hybrid submit panel. The chat fills it (ligands, pocket, payment); the user reviews,
  edits, and clicks Run — the ONLY action that calls POST /jobs. Once a job exists, the
  lifecycle cards (stepper / escrow / results / proof) render inline below, driven by the
  same SWR polling hooks the old status page used.

  Buyer-side functionality wired here:
   - editable ligand library (add / edit / remove, plus uploaded SMILES/SDF via FilesPanel)
   - compute-provider selection with a live credit quote (the two-sided marketplace)
   - docking-parameter controls (exhaustiveness, modes) the backend already accepts
*/

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useJobDraft } from "@/lib/jobStore";
import { useStructure } from "@/lib/structureStore";
import { createJob, ApiError } from "@/lib/api";
import { useJob, useEscrow, useResult, useProof } from "@/lib/hooks";
import { stateReached } from "@/lib/types";
import { PROVIDERS, providerById, quoteCredits, etaSeconds } from "@/lib/providers";
import { ligandPreview } from "@/lib/ligands";
import { PipelineStepper } from "../PipelineStepper";
import { EscrowPanel } from "../EscrowPanel";
import { ResultsTable } from "../ResultsTable";
import { ProofPanel } from "../ProofPanel";

export function JobPanel() {
  const job = useJobDraft();
  const router = useRouter();
  const account = useCurrentAccount();
  const { pdbId, uploaded, source, receptor } = useStructure();
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

  const provider = providerById(draft.supplierId) ?? PROVIDERS[0];
  const ligandCount = Math.max(1, draft.ligands.length);
  const quote = quoteCredits(provider, ligandCount, draft.params.exhaustiveness);
  const eta = etaSeconds(provider, ligandCount);

  function selectProvider(id: string) {
    const p = providerById(id) ?? PROVIDERS[0];
    job.setSupplier(p.id);
    // Re-price to the new provider's quote (user can still override the amount).
    job.setAmount(quoteCredits(p, Math.max(1, draft.ligands.length), draft.params.exhaustiveness));
  }

  async function run() {
    setErr(null);
    if (draft.ligands.length === 0) {
      setErr("add at least one ligand before running");
      return;
    }
    if (draft.ligands.some((l) => !l.smiles && !l.sdf)) {
      setErr("every ligand needs a SMILES string (or an SDF)");
      return;
    }
    setRunning(true);
    try {
      const spec = { ...job.buildSpec(receptor), researcher: account?.address };
      const res = await createJob(spec);
      // On-chain, the job starts in `pending_payment` and needs the wallet lock step before
      // it can queue -- hand off to the pay page (carrying the receptor PDB for rendering).
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
            <span className="font-mono text-sm text-foreground">
              {uploaded ? (
                <>
                  <span className="text-select-bright">uploaded</span>
                  <span className="ml-1.5 text-muted">{source}</span>
                </>
              ) : (
                pdbId || "—"
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

          <Field label="Provider">
            <div className="flex-1 space-y-1.5">
              <select
                value={provider.id}
                onChange={(e) => selectProvider(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-accent"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.gpu} · {p.region}
                  </option>
                ))}
              </select>
              <p className="font-mono text-[10px] text-muted">
                ~{eta}s · quote{" "}
                <span className="text-foreground">{quote}</span> credits
              </p>
            </div>
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

          <Field label="Payment">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={draft.amount}
                onChange={(e) => job.setAmount(Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-sm text-foreground outline-none focus:border-accent"
              />
              <span className="font-mono text-xs text-muted">credits</span>
              {draft.amount !== quote && (
                <button
                  type="button"
                  onClick={() => job.setAmount(quote)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-muted hover:text-foreground"
                  title="Use the provider quote"
                >
                  use quote {quote}
                </button>
              )}
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

/** Editable ligand list: id + SMILES per row, add/remove, plus the sample shortcut. */
function LigandEditor() {
  const job = useJobDraft();
  const { ligands } = job.draft;

  return (
    <div className="flex-1 space-y-1.5">
      {ligands.length === 0 && (
        <button
          type="button"
          onClick={job.loadSampleLigands}
          className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-foreground"
        >
          load sample (aspirin + decoy)
        </button>
      )}

      {ligands.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={l.id}
            onChange={(e) => job.updateLigand(i, { id: e.target.value })}
            placeholder="id"
            className="w-20 shrink-0 rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-accent-bright outline-none focus:border-accent"
          />
          {l.sdf && !l.smiles ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
              {ligandPreview(l)}
            </span>
          ) : (
            <input
              value={l.smiles ?? ""}
              onChange={(e) => job.updateLigand(i, { smiles: e.target.value })}
              placeholder="SMILES"
              spellCheck={false}
              className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-1.5 py-1 font-mono text-[11px] text-foreground outline-none focus:border-accent"
            />
          )}
          <button
            type="button"
            onClick={() => job.removeLigand(i)}
            title="Remove ligand"
            className="shrink-0 px-1 text-muted hover:text-amber-400"
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => job.addLigands([{ id: `lig_${ligands.length + 1}`, smiles: "" }])}
        className="rounded-md border border-dashed border-border px-2.5 py-1 font-mono text-[10px] text-muted hover:border-accent/50 hover:text-foreground"
      >
        + add ligand
      </button>
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
