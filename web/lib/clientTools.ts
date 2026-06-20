"use client";

/*
  Bridges the chat's client-executed tools to the live UI stores. Returns a stable
  applyClientTool(name, args) the chat transport calls, plus getContext() so each request
  carries the latest PDB + residue selection. Uses refs so the callback never goes stale.
*/

import { useCallbackRef } from "./useCallbackRef";
import { useStructure } from "./structureStore";
import { useSelection, parseSelectionExpr, summarizeSelection } from "./selection";
import { useJobDraft } from "./jobStore";
import { useFiles } from "./files";
import { parsePdb, cleanPdb, boxFromSelection } from "./structure";
import type { ChatContext } from "./chat";

export function useClientTools() {
  const structure = useStructure();
  const selection = useSelection();
  const job = useJobDraft();
  const files = useFiles();

  const getContext = useCallbackRef((): ChatContext => ({
    pdb_id: structure.pdbId,
    selection: selection.summary,
    has_structure: structure.status === "ready" && !!structure.text,
    granted_files: files.granted.map((f) => ({ name: f.name, kind: f.kind })),
  }));

  const applyClientTool = useCallbackRef(
    async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      switch (name) {
        case "fetch_structure": {
          const id = String(args.pdb_id ?? "").trim().toUpperCase();
          if (id.length < 4) return { error: "invalid pdb id" };
          const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
          if (!res.ok) return { error: `PDB ${id} not found on RCSB` };
          const text = await res.text();
          const parsed = parsePdb(text);
          structure.loadStructure(id, text);
          return {
            pdb_id: id,
            chains: parsed.chains.map((c) => c.id),
            residues: parsed.residueCount,
          };
        }
        case "clean_structure": {
          const text = structure.text;
          if (!text) return { error: "no structure loaded" };
          const { cleaned, removed } = cleanPdb(text);
          structure.loadStructure(structure.pdbId, cleaned, "cleaned");
          return { removed, note: "viewer now shows the cleaned structure" };
        }
        case "highlight_residues": {
          const expr = String(args.selection ?? "");
          const keys = parseSelectionExpr(expr);
          if (keys.length === 0) return { error: "could not parse selection" };
          selection.set(keys);
          return { highlighted: keys.length, selection: summarizeSelection(new Set(keys)) };
        }
        case "set_pocket": {
          const expr = args.selection ? String(args.selection) : "";
          const keys = expr ? parseSelectionExpr(expr) : [...selection.selected];
          if (keys.length === 0) return { error: "no residues selected" };
          if (expr) selection.set(keys);
          const text = structure.text;
          if (!text) return { error: "no structure loaded" };
          const box = boxFromSelection(text, new Set(keys));
          if (!box) return { error: "selected residues not found in structure" };
          const label = summarizeSelection(new Set(keys));
          job.setPocketFromBox(box, label);
          return { pocket: label, center: box.center, size: box.size };
        }
        case "submit_job": {
          const ligands = Array.isArray(args.ligands)
            ? (args.ligands as { id: string; smiles: string }[]).map((l) => ({
                id: String(l.id),
                smiles: String(l.smiles),
              }))
            : [];
          if (ligands.length > 0) job.setLigands(ligands);
          if (typeof args.amount === "number") job.setAmount(args.amount);
          // Pull the current selection into the pocket if one isn't set yet.
          if (!job.draft.pocket && selection.selected.size > 0 && structure.text) {
            const box = boxFromSelection(structure.text, selection.selected);
            if (box) job.setPocketFromBox(box, selection.summary);
          }
          return {
            filled: true,
            ligands: ligands.length || job.draft.ligands.length,
            pocket: job.draft.pocket?.label ?? "not set",
            note: "job panel filled; the user must review and click Run to start it",
          };
        }
        default:
          return { error: `unknown client tool ${name}` };
      }
    },
  );

  return { applyClientTool, getContext };
}

export type { ChatContext };
