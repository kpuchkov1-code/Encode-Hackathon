/*
  Ligand-file parsers — turn an uploaded SMILES list (.smi/.txt) or SD file (.sdf/.mol)
  into the marketplace's Ligand[] shape (API_CONTRACT JobSpec.ligands). Pure functions.

  .smi/.txt : one molecule per line, "<SMILES> [optional id/name]". Blank lines and
              lines starting with '#' are skipped. Missing ids are auto-numbered.
  .sdf/.mol : records separated by "$$$$". The record's first line is its title (id);
              the whole molblock (up to and including "M  END") is kept as `sdf`.
*/

import type { Ligand } from "./types";

/** Parse a SMILES list into ligands. The first whitespace-split token is the SMILES. */
export function parseSmilesList(text: string): Ligand[] {
  const out: Ligand[] = [];
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const smiles = parts[0];
    if (!smiles) continue;
    const id = parts.slice(1).join("_") || `lig_${++n}`;
    out.push({ id, smiles });
  }
  return out;
}

/** Parse an SD file into ligands, keeping each record's molblock as `sdf`. */
export function parseSdf(text: string): Ligand[] {
  const out: Ligand[] = [];
  let n = 0;
  for (const block of text.split(/\$\$\$\$\s*\r?\n?/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const id = firstLine && !/^\s*$/.test(firstLine) ? firstLine : `lig_${++n}`;
    // Re-append the record terminator so the value is a valid single-molecule SDF.
    out.push({ id, sdf: `${trimmed}\n$$$$\n` });
  }
  return out;
}

/** Dispatch on file kind (from lib/files) to the right parser. */
export function parseLigandFile(kind: string, text: string): Ligand[] {
  if (kind === "sdf") return parseSdf(text);
  return parseSmilesList(text);
}

/** A short human label for a ligand (SMILES preview or "sdf"). */
export function ligandPreview(l: Ligand): string {
  if (l.smiles) return l.smiles;
  if (l.sdf) return "[sdf molblock]";
  return "—";
}
