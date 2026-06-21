"use client";

/*
  Compact inline card showing a tool the copilot invoked + a one-line result summary.
  Keeps the transcript legible without dumping raw JSON.
*/

const LABELS: Record<string, string> = {
  fetch_structure: "Fetched structure",
  clean_structure: "Cleaned structure",
  submit_job: "Filled job panel",
  set_pocket: "Set docking pocket",
  highlight_residues: "Highlighted residues",
  get_job_status: "Checked job status",
  get_result: "Fetched results",
  web_search: "Searched the web",
  lookup_pdb: "Searched the PDB",
};

function summarize(name: string, result: Record<string, unknown>): string {
  if (result?.error) return `error: ${result.error}`;
  switch (name) {
    case "fetch_structure":
      return `${result.pdb_id} · ${(result.chains as string[])?.join(",")} · ${result.residues} residues`;
    case "clean_structure": {
      const r = result.removed as { waters: number; hetatms: number; altlocs: number } | undefined;
      return r ? `removed ${r.waters} waters, ${r.hetatms} hetero, ${r.altlocs} alt-locs` : "done";
    }
    case "set_pocket":
      return `pocket ${result.pocket}`;
    case "highlight_residues":
      return `${result.selection} (${result.highlighted})`;
    case "submit_job":
      return `${result.ligands} ligand(s), pocket ${result.pocket}`;
    case "lookup_pdb":
      return `candidates: ${(result.candidates as string[])?.slice(0, 5).join(", ") || "none"}`;
    case "web_search": {
      const n = (result.results as unknown[])?.length ?? 0;
      return n ? `${n} results` : String(result.note ?? "no results");
    }
    default:
      return "done";
  }
}

export function ToolCallCard({ name, result }: { name: string; result: unknown }) {
  const parsed = (typeof result === "object" && result ? result : {}) as Record<string, unknown>;
  const isError = !!parsed.error;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[11px] ${
        isError
          ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
          : "border-border bg-surface-2/60 text-muted"
      }`}
    >
      <span className="text-accent-bright">⚙</span>
      <span className="text-foreground/80">{LABELS[name] ?? name}</span>
      <span className="truncate">· {summarize(name, parsed)}</span>
    </div>
  );
}
