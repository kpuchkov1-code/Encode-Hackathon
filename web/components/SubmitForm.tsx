"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createJob } from "@/lib/api";
import type { JobSpec, Ligand } from "@/lib/types";
import { PRESETS, SAMPLE_JOB, SUPPLIERS } from "@/lib/presets";
import { ReceptorViewer } from "./ReceptorViewer";
import { SuggestionCard } from "./SuggestionCard";

function initialSpec(presetKey: string | null): JobSpec {
  if (presetKey && PRESETS[presetKey]) return structuredClone(PRESETS[presetKey]);
  return structuredClone(SAMPLE_JOB);
}

export function SubmitForm() {
  const router = useRouter();
  const search = useSearchParams();
  const seed = initialSpec(search.get("preset"));

  const [pdbId, setPdbId] = useState(seed.receptor.pdb_id ?? "6LU7");
  const [ligands, setLigands] = useState<Ligand[]>(seed.ligands);
  const [amount, setAmount] = useState(seed.payment.amount);
  const [supplierId, setSupplierId] = useState(seed.payment.supplier_id);
  const [advanced, setAdvanced] = useState(false);
  const [params, setParams] = useState(seed.params);
  const [autobox, setAutobox] = useState(
    "autobox_ligand" in seed.box ? seed.box.autobox_ligand : "ref_ligand",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadPreset(key: string) {
    const p = initialSpec(key);
    setPdbId(p.receptor.pdb_id ?? "6LU7");
    setLigands(p.ligands);
    setAmount(p.payment.amount);
    setSupplierId(p.payment.supplier_id);
    setParams(p.params);
    setError(null);
  }

  function updateLigand(i: number, patch: Partial<Ligand>) {
    setLigands((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLigand() {
    setLigands((prev) => [...prev, { id: `lig_${prev.length + 1}`, smiles: "" }]);
  }
  function removeLigand(i: number) {
    setLigands((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit() {
    setError(null);
    const validLigands = ligands.filter((l) => l.id.trim() && (l.smiles ?? "").trim());
    if (!pdbId.trim()) return setError("Receptor PDB ID is required.");
    if (validLigands.length === 0) return setError("Add at least one ligand with a SMILES string.");

    const spec: JobSpec = {
      receptor: { pdb_id: pdbId.trim() },
      ligands: validLigands,
      box: { autobox_ligand: autobox },
      params,
      payment: { amount: Number(amount), supplier_id: supplierId },
    };

    setSubmitting(true);
    try {
      const { job_id } = await createJob(spec);
      // Carry the PDB ID forward so the job page can render the receptor (the status
      // endpoint doesn't echo the spec).
      router.push(`/jobs/${job_id}?pdb=${encodeURIComponent(pdbId.trim())}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[1fr_460px]">
      {/* LEFT — form */}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Submit a docking job</h1>
          <p className="mt-1 text-sm text-muted">
            Define the receptor, ligands and payment. The receptor renders live on the right.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SuggestionCard
            title="Load sample"
            subtitle="Aspirin vs decoy on 6LU7"
            onClick={() => loadPreset("sample")}
          />
          <SuggestionCard
            title="Load failure case"
            subtitle="FAIL receptor → refund demo"
            onClick={() => loadPreset("fail")}
          />
        </div>

        {/* Receptor */}
        <Field label="Receptor PDB ID">
          <input
            value={pdbId}
            onChange={(e) => setPdbId(e.target.value)}
            placeholder="6LU7"
            className="input font-mono uppercase"
          />
        </Field>

        {/* Ligands */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">Ligands</label>
            <button
              type="button"
              onClick={addLigand}
              className="text-xs text-accent hover:text-accent-bright"
            >
              + add ligand
            </button>
          </div>
          <div className="space-y-2">
            {ligands.map((lig, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={lig.id}
                  onChange={(e) => updateLigand(i, { id: e.target.value })}
                  placeholder="id"
                  className="input w-32 font-mono"
                />
                <input
                  value={lig.smiles ?? ""}
                  onChange={(e) => updateLigand(i, { smiles: e.target.value })}
                  placeholder="SMILES"
                  className="input flex-1 font-mono"
                />
                {ligands.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLigand(i)}
                    className="px-2 text-muted hover:text-red-400"
                    aria-label="remove ligand"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Payment */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment (credits)">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="input font-mono"
            />
          </Field>
          <Field label="GPU supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="input font-mono"
            >
              {SUPPLIERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* Advanced */}
        <div>
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted hover:text-foreground"
          >
            {advanced ? "▾" : "▸"} Advanced (box & docking params)
          </button>
          {advanced && (
            <div className="mt-3 grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
              <Field label="autobox_ligand">
                <input
                  value={autobox}
                  onChange={(e) => setAutobox(e.target.value)}
                  className="input font-mono"
                />
              </Field>
              <Field label="exhaustiveness">
                <input
                  type="number"
                  value={params.exhaustiveness}
                  onChange={(e) =>
                    setParams({ ...params, exhaustiveness: Number(e.target.value) })
                  }
                  className="input font-mono"
                />
              </Field>
              <Field label="num_modes">
                <input
                  type="number"
                  value={params.num_modes}
                  onChange={(e) => setParams({ ...params, num_modes: Number(e.target.value) })}
                  className="input font-mono"
                />
              </Field>
              <Field label="seed">
                <input
                  type="number"
                  value={params.seed}
                  onChange={(e) => setParams({ ...params, seed: Number(e.target.value) })}
                  className="input font-mono"
                />
              </Field>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="w-full rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit docking job →"}
        </button>
      </div>

      {/* RIGHT — live receptor preview */}
      <div className="lg:sticky lg:top-20">
        <div className="h-[440px] lg:h-[calc(100vh-10rem)]">
          <ReceptorViewer pdbId={pdbId} />
        </div>
        <p className="mt-2 text-center font-mono text-[11px] text-muted">
          receptor loaded client-side from RCSB
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
