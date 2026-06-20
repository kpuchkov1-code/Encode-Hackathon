"use client";

/*
  Monospace sequence strip, linked to the same selection store as the 3D viewer. Each
  residue is a clickable cell; selected residues glow orange in both places. Rows are
  numbered by the first residue in the row (Amina-style sequence panel).
*/

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
    <div className="max-h-[34vh] overflow-y-auto px-3 py-2">
      {parsed.chains.map((chain) => (
        <ChainRows key={chain.id} chain={chain} />
      ))}
    </div>
  );
}

function ChainRows({ chain }: { chain: ChainInfo }) {
  const { selected } = useSelection();
  const selectedCount = chain.residues.filter((r) =>
    selected.has(`${chain.id}:${r.resi}`),
  ).length;

  const rows: ResidueInfo[][] = [];
  for (let i = 0; i < chain.residues.length; i += ROW) {
    rows.push(chain.residues.slice(i, i + ROW));
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
          <SeqRow key={i} chainId={chain.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function SeqRow({ chainId, row }: { chainId: string; row: ResidueInfo[] }) {
  const { isSelected, toggle } = useSelection();
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted">
        {row[0]?.resi}
      </span>
      <div className="flex flex-wrap">
        {row.map((res) => {
          const key = `${chainId}:${res.resi}`;
          const on = isSelected(key);
          return (
            <button
              key={res.resi}
              type="button"
              onClick={() => toggle(key)}
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
