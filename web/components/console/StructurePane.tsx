"use client";

/*
  Right pane of the console: PDB-ID input, the selection-aware 3D viewer, and the linked
  sequence strip. This is the persistent "structure" surface (Amina's right pane).
*/

import { useRef, useState } from "react";
import { useStructure } from "@/lib/structureStore";
import { useJobDraft } from "@/lib/jobStore";
import { useJob, useResult } from "@/lib/hooks";
import { StructureViewer } from "./StructureViewer";
import { DockingViewer } from "./DockingViewer";
import { SequenceStrip } from "./SequenceStrip";
import type { JobState } from "@/lib/types";

const DOCK_STATES: JobState[] = ["running", "docked", "proven", "settled"];

export function StructurePane() {
  const { pdbId, setPdbId, loadText, parsed, status, text, uploaded, source } = useStructure();
  const [draft, setDraft] = useState(pdbId);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    loadText(raw, file.name); // marks it as the uploaded receptor (docked to)
    e.target.value = "";
  }

  // When a docking job is live, the bottom (sequence) slot is replaced by the docking viewer.
  const { jobId } = useJobDraft();
  const { job: jobStatus } = useJob(jobId);
  const dockState = jobStatus?.state;
  const result = useResult(jobId, dockState);
  const showDock = !!jobId && !!dockState && DOCK_STATES.includes(dockState);
  const best = result
    ? [...result.ligands].sort((a, b) => b.cnn_affinity - a.cnn_affinity)[0]
    : undefined;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="space-y-1.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPdbId(draft);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="PDB ID (e.g. 6LU7)"
            className="input font-mono uppercase"
            spellCheck={false}
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Upload a receptor .pdb file to dock against"
            className="shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors hover:border-accent/50"
          >
            Upload PDB
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdb,.ent"
            onChange={onUpload}
            className="hidden"
          />
        </form>
        {/* Show exactly what will be docked to: the uploaded file, or the RCSB id. */}
        <p className="font-mono text-[11px] text-muted">
          {status === "loading" ? (
            "loading…"
          ) : status === "error" ? (
            <span className="text-amber-300">could not load “{draft}”</span>
          ) : uploaded ? (
            <>
              docking target:{" "}
              <span className="text-select-bright">uploaded · {source}</span>
            </>
          ) : text ? (
            <>
              docking target: <span className="text-foreground">{pdbId}</span>{" "}
              <span className="text-muted">(RCSB)</span>
            </>
          ) : (
            "no receptor loaded"
          )}
        </p>
      </div>

      {/* PDB viewer keeps its full size; the bottom slot shows the sequence OR, while a
          docking job is live, a focused docking visual in the sequence's place. */}
      <div className="min-h-0 flex-1">
        <StructureViewer />
      </div>

      {showDock ? (
        <div className="h-[34vh] shrink-0">
          <DockingViewer
            pdbText={text}
            state={dockState}
            ligandId={best?.ligand_id}
            bestScore={best?.cnn_affinity}
            seedKey={`${jobId}:${best?.ligand_id ?? ""}`}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
              Sequence
            </span>
            {status === "ready" && parsed && (
              <span className="font-mono text-[10px] text-muted">
                {parsed.chains.length} chain{parsed.chains.length === 1 ? "" : "s"} ·{" "}
                {parsed.residueCount} res
              </span>
            )}
          </div>
          <SequenceStrip />
        </div>
      )}
    </div>
  );
}
