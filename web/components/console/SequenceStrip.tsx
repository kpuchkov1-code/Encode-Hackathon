"use client";

/*
  Monospace sequence strip, linked to the same selection store as the 3D viewer. Each
  residue is a cell; selected residues glow orange in both places (and in the Mol* viewer).

  Drag to select chunks: press on a residue and drag across the sequence to select a run.
  The drag mode is set by the first cell — start on an unselected residue to ADD a chunk,
  start on a selected one to REMOVE a chunk. A plain click toggles a single residue.
*/

import { useCallbackRef } from "@/lib/useCallbackRef";
import { useEffect, useRef } from "react";
import { useStructure } from "@/lib/structureStore";
import { useSelection } from "@/lib/selection";
import type { ChainInfo, ResidueInfo } from "@/lib/structure";

const ROW = 30; // residues per row

export function SequenceStrip() {
  const { parsed, status } = useStructure();

  if (status !== "ready" || !parsed) {
    return (
      <div className="px-3 py-3 font-mono text-[11px] text-muted">
        sequence appears once a structure is loaded
      </div>
    );
  }

  return (
    <div className="max-h-[34vh] select-none overflow-y-auto px-3 py-2">
      {parsed.chains.map((chain) => (
        <ChainRows key={chain.id} chain={chain} />
      ))}
    </div>
  );
}

function ChainRows({ chain }: { chain: ChainInfo }) {
  const { selected, isSelected, add, remove } = useSelection();
  const selectedCount = chain.residues.filter((r) =>
    selected.has(`${chain.id}:${r.resi}`),
  ).length;

  // Drag state lives in refs so the per-cell handlers stay stable across renders.
  const dragging = useRef(false);
  const anchor = useRef<number | null>(null);
  const mode = useRef<"add" | "remove">("add");

  const keyAt = (idx: number) => `${chain.id}:${chain.residues[idx].resi}`;

  // End any drag on a global pointerup (even if released off a cell).
  useEffect(() => {
    const end = () => {
      dragging.current = false;
      anchor.current = null;
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  const applyRange = useCallbackRef((a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const keys: string[] = [];
    for (let i = lo; i <= hi; i++) keys.push(keyAt(i));
    if (mode.current === "add") add(keys);
    else remove(keys);
  });

  const onCellDown = useCallbackRef((idx: number) => {
    dragging.current = true;
    anchor.current = idx;
    mode.current = isSelected(keyAt(idx)) ? "remove" : "add";
    applyRange(idx, idx);
  });

  const onCellEnter = useCallbackRef((idx: number) => {
    if (!dragging.current || anchor.current == null) return;
    applyRange(anchor.current, idx);
  });

  const rows: { residue: ResidueInfo; index: number }[][] = [];
  for (let i = 0; i < chain.residues.length; i += ROW) {
    rows.push(
      chain.residues.slice(i, i + ROW).map((residue, j) => ({ residue, index: i + j })),
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent-bright">
          Chain {chain.id}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {chain.residues.length} residues
        </span>
        {selectedCount > 0 && (
          <span className="font-mono text-[10px] text-select-bright">
            {selectedCount} selected
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {rows.map((row, i) => (
          <SeqRow
            key={i}
            chainId={chain.id}
            row={row}
            onCellDown={onCellDown}
            onCellEnter={onCellEnter}
          />
        ))}
      </div>
    </div>
  );
}

function SeqRow({
  chainId,
  row,
  onCellDown,
  onCellEnter,
}: {
  chainId: string;
  row: { residue: ResidueInfo; index: number }[];
  onCellDown: (idx: number) => void;
  onCellEnter: (idx: number) => void;
}) {
  const { isSelected } = useSelection();
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted">
        {row[0]?.residue.resi}
      </span>
      <div className="flex flex-wrap">
        {row.map(({ residue: res, index }) => {
          const key = `${chainId}:${res.resi}`;
          const on = isSelected(key);
          return (
            <button
              key={res.resi}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                onCellDown(index);
              }}
              onPointerEnter={() => onCellEnter(index)}
              title={`${res.resn} ${res.resi}`}
              className={`h-[18px] w-[13px] text-center font-mono text-[11px] leading-[18px] transition-colors ${
                on
                  ? "bg-select font-semibold text-black"
                  : "text-foreground/80 hover:bg-surface-2"
              }`}
            >
              {res.oneLetter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
