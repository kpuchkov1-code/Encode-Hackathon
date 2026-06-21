"use client";

import type { DockResult, JobStatus, Proof } from "@/lib/types";
import { Copyable } from "./Copyable";

// Monospace metadata panel beneath the viewer — echoes AminoAnalytica's sequence/data
// block. Surfaces the machine values as they become available.
export function JobInfoBlock({
  job,
  result,
  proof,
}: {
  job: JobStatus | undefined;
  result: DockResult | undefined;
  proof: Proof | undefined;
}) {
  // Rank by CNN affinity when present (higher = better), else by Vina affinity (lower =
  // better). Jobs run without CNN rescoring (`cnn: "none"`) have no cnn_affinity, so this
  // must never assume it exists.
  const ligands = result?.ligands ?? [];
  const hasCnn = ligands.some((l) => typeof l.cnn_affinity === "number");
  const best = ligands.length
    ? [...ligands].sort((a, b) =>
        hasCnn
          ? (b.cnn_affinity ?? -Infinity) - (a.cnn_affinity ?? -Infinity)
          : (a.vina_affinity ?? Infinity) - (b.vina_affinity ?? Infinity),
      )[0]
    : undefined;
  const bestScore =
    best && typeof (best.cnn_affinity ?? best.vina_affinity) === "number"
      ? (best.cnn_affinity ?? best.vina_affinity)
      : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 text-[11px] uppercase tracking-wider text-muted">
        Job metadata
      </div>
      <dl className="space-y-2 text-xs">
        <Row label="job_id">
          {job ? <Copyable value={job.job_id} truncate /> : <Dash />}
        </Row>
        <Row label="state">
          {job ? (
            <span className="font-mono text-accent-bright">{job.state}</span>
          ) : (
            <Dash />
          )}
        </Row>
        <Row label="top_binder">
          {best ? (
            <span className="font-mono text-foreground/90">
              {best.ligand_id}
              {bestScore !== undefined ? ` (${bestScore.toFixed(2)})` : ""}
            </span>
          ) : (
            <Dash />
          )}
        </Row>
        <Row label="manifest">
          {proof ? <Copyable value={proof.manifest_sha256} truncate /> : <Dash />}
        </Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function Dash() {
  return <span className="font-mono text-muted">—</span>;
}
