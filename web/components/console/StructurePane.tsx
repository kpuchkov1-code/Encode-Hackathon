"use client";

/*
  Right pane of the console: PDB-ID input, the selection-aware 3D viewer, and the linked
  sequence strip. This is the persistent "structure" surface (Amina's right pane).
*/

import { useState } from "react";
import { useStructure } from "@/lib/structureStore";
import { StructureViewer } from "./StructureViewer";
import { SequenceStrip } from "./SequenceStrip";

export function StructurePane() {
  const { pdbId, setPdbId, parsed, status } = useStructure();
  const [draft, setDraft] = useState(pdbId);

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
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
      </form>

      <div className="min-h-[280px] flex-1">
        <StructureViewer />
      </div>

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
    </div>
  );
}
