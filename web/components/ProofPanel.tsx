"use client";

import type { Proof } from "@/lib/types";
import { Copyable } from "./Copyable";
import { SponsorBadge } from "./SponsorBadge";
import { walrusBlob } from "@/lib/explorer";

// The trust differentiator. The manifest hash is THE proof token; everything else
// is the audit trail of what was hashed into it.
export function ProofPanel({ proof }: { proof: Proof | undefined }) {
  return (
    <div className="rounded-xl border border-accent/30 bg-surface p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Proof of execution</h2>
        <SponsorBadge name="Walrus" />
        <SponsorBadge name="Sui" />
      </div>
      <p className="mb-4 text-[11px] text-muted">
        The result manifest is anchored on <span className="text-foreground">Walrus</span>{" "}
        decentralized storage (Sui) — a public, tamper-evident record that your molecule was
        processed unaltered.
      </p>

      {!proof ? (
        <p className="text-sm text-muted">
          Cryptographic proof appears once the job is proven…
        </p>
      ) : (
        <div className="space-y-4">
          {/* The hero token */}
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-accent-bright">
              manifest_sha256 — verify your molecule was processed unaltered
            </div>
            <Copyable value={proof.manifest_sha256} className="text-sm" />
          </div>

          <dl className="space-y-2 text-xs">
            <Row label="receptor_sha256">
              <Copyable value={proof.receptor_sha256} truncate />
            </Row>
            {Object.entries(proof.ligand_sha256s).map(([id, hash]) => (
              <Row key={`l-${id}`} label={`ligand · ${id}`}>
                <Copyable value={hash} truncate />
              </Row>
            ))}
            {Object.entries(proof.pose_sha256s).map(([id, hash]) => (
              <Row key={`p-${id}`} label={`pose · ${id}`}>
                <Copyable value={hash} truncate />
              </Row>
            ))}
            <Row label="storage_blob_id">
              <span className="flex items-center gap-2">
                <Copyable value={proof.storage_blob_id} truncate />
                {proof.storage_blob_id && (
                  <a
                    href={walrusBlob(proof.storage_blob_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-accent-bright hover:underline"
                  >
                    on Walrus ↗
                  </a>
                )}
              </span>
            </Row>
            <Row label="docking_engine">
              <span className="font-mono text-foreground/90">{proof.gnina_version}</span>
            </Row>
            <Row label="worker_id">
              <span className="font-mono text-foreground/90">{proof.worker_id}</span>
            </Row>
            <Row label="timestamp">
              <span className="font-mono text-foreground/90">{proof.timestamp}</span>
            </Row>
            <Row label="params">
              <span className="font-mono text-foreground/90">
                exh={proof.params.exhaustiveness} · modes={proof.params.num_modes} ·{" "}
                {proof.params.cnn} · seed={proof.params.seed}
              </span>
            </Row>
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
