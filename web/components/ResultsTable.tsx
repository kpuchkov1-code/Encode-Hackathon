"use client";

import type { DockResult, LigandResult } from "@/lib/types";
import { SponsorBadge } from "./SponsorBadge";

function toCsv(rows: LigandResult[]): string {
  const header = "rank,ligand_id,cnn_affinity,cnn_score,vina_affinity,pose_path";
  const lines = rows.map((l, i) =>
    [i + 1, l.ligand_id, l.cnn_affinity, l.cnn_score, l.vina_affinity, l.pose_path].join(","),
  );
  return [header, ...lines].join("\n");
}

function downloadCsv(result: DockResult, rows: LigandResult[]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `docking_${result.job_id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResultsTable({ result }: { result: DockResult | undefined }) {
  // Defensive: rank by cnn_affinity desc (best binder first).
  const rows = result
    ? [...result.ligands].sort((a, b) => b.cnn_affinity - a.cnn_affinity)
    : [];

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Docking results</h2>
        <SponsorBadge name="gnina" />
        {result && rows.length > 0 && (
          <button
            type="button"
            onClick={() => downloadCsv(result, rows)}
            className="ml-auto rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            ⤓ export CSV
          </button>
        )}
        {(!result || rows.length === 0) && (
          <span className="ml-auto text-[11px] text-muted">ranked by CNN affinity</span>
        )}
      </div>

      {!result ? (
        <p className="text-sm text-muted">Results appear once the job is docked…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Ligand</th>
                <th className="py-2 pr-3 text-right font-medium">CNN aff.</th>
                <th className="py-2 pr-3 text-right font-medium">CNN score</th>
                <th className="py-2 text-right font-medium">Vina aff.</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((lig, i) => {
                const best = i === 0;
                return (
                  <tr
                    key={lig.ligand_id}
                    className={`border-b border-border/50 last:border-0 ${best ? "bg-accent/5" : ""}`}
                  >
                    <td className="py-2.5 pr-3 text-muted">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <span className={best ? "text-accent-bright" : "text-foreground"}>
                        {lig.ligand_id}
                      </span>
                      {best && (
                        <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-bright">
                          best
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-foreground">
                      {lig.cnn_affinity.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-muted">
                      {lig.cnn_score.toFixed(3)}
                    </td>
                    <td className="py-2.5 text-right text-muted">
                      {lig.vina_affinity.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted">
            Higher CNN affinity = stronger predicted binder. Real gnina CNN rescoring.
          </p>
        </div>
      )}
    </div>
  );
}
