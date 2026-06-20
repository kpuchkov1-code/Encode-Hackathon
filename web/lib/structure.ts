/*
  PDB structure utilities — pure functions, no DOM, usable on client and server.

  - parsePdb: chains + per-residue one-letter sequence (for the sequence strip)
  - cleanPdb: JS-level docking prep (drop waters, non-protein HETATMs, alt-locs)
  - boxFromSelection: derive a docking box (center+size) from selected residues

  "Cleaning" a PDB for docking does NOT mean an LLM rewrites it — it means deterministic
  record filtering. The assistant calls this; it never invents atoms.
*/

const THREE_TO_ONE: Record<string, string> = {
  ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
  GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
  PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  MSE: "M", SEC: "U", PYL: "O",
};

const STANDARD_RESIDUES = new Set(Object.keys(THREE_TO_ONE));

export interface ResidueInfo {
  resi: number;
  resn: string;
  oneLetter: string;
}

export interface ChainInfo {
  id: string;
  residues: ResidueInfo[];
  sequence: string;
}

export interface ParsedStructure {
  chains: ChainInfo[];
  residueCount: number;
}

/** Parse ATOM records into chains with one-letter sequences (one entry per residue, via CA). */
export function parsePdb(text: string): ParsedStructure {
  const chains = new Map<string, Map<number, ResidueInfo>>();

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("ATOM")) continue;
    const atomName = line.slice(12, 16).trim();
    // One residue entry per CA keeps the sequence 1:1 with residues.
    if (atomName !== "CA") continue;
    const altLoc = line.slice(16, 17).trim();
    if (altLoc && altLoc !== "A") continue;
    const resn = line.slice(17, 20).trim();
    const chainId = line.slice(21, 22).trim() || "A";
    const resi = Number(line.slice(22, 26).trim());
    if (Number.isNaN(resi)) continue;

    let chain = chains.get(chainId);
    if (!chain) {
      chain = new Map();
      chains.set(chainId, chain);
    }
    if (!chain.has(resi)) {
      chain.set(resi, {
        resi,
        resn,
        oneLetter: THREE_TO_ONE[resn] ?? "X",
      });
    }
  }

  const out: ChainInfo[] = [];
  let total = 0;
  for (const [id, residues] of chains) {
    const sorted = [...residues.values()].sort((a, b) => a.resi - b.resi);
    total += sorted.length;
    out.push({
      id,
      residues: sorted,
      sequence: sorted.map((r) => r.oneLetter).join(""),
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return { chains: out, residueCount: total };
}

export interface CleanReport {
  waters: number;
  hetatms: number;
  altlocs: number;
}

export interface CleanResult {
  cleaned: string;
  removed: CleanReport;
}

/** Docking-prep clean: drop waters, non-protein HETATMs, and non-primary alt-locs. */
export function cleanPdb(text: string): CleanResult {
  const kept: string[] = [];
  const removed: CleanReport = { waters: 0, hetatms: 0, altlocs: 0 };

  for (const line of text.split(/\r?\n/)) {
    const isAtom = line.startsWith("ATOM");
    const isHet = line.startsWith("HETATM");

    if (isHet) {
      const resn = line.slice(17, 20).trim();
      if (resn === "HOH" || resn === "WAT") {
        removed.waters++;
        continue;
      }
      // Keep modified residues we can map (e.g. MSE); drop everything else hetero.
      if (!STANDARD_RESIDUES.has(resn)) {
        removed.hetatms++;
        continue;
      }
    }

    if (isAtom || isHet) {
      const altLoc = line.slice(16, 17).trim();
      if (altLoc && altLoc !== "A") {
        removed.altlocs++;
        continue;
      }
      kept.push(line);
      continue;
    }

    // Pass through non-coordinate records (HEADER, CRYST1, TER, END, etc.).
    kept.push(line);
  }

  return { cleaned: kept.join("\n"), removed };
}

export type BoxSpec = {
  center: [number, number, number];
  size: [number, number, number];
};

/**
 * Derive an axis-aligned docking box from selected residues' atoms.
 * center = centroid of selected atoms; size = bounding box + 2*padding (min 12 A per axis).
 * selected = set of "<chain>:<resi>" keys. Returns null if no atoms matched.
 */
export function boxFromSelection(
  text: string,
  selected: Set<string>,
  padding = 8,
): BoxSpec | null {
  if (selected.size === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let n = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
    const chainId = line.slice(21, 22).trim() || "A";
    const resi = Number(line.slice(22, 26).trim());
    if (Number.isNaN(resi)) continue;
    if (!selected.has(`${chainId}:${resi}`)) continue;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    n++;
  }

  if (n === 0) return null;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    center: [round((minX + maxX) / 2), round((minY + maxY) / 2), round((minZ + maxZ) / 2)],
    size: [
      round(Math.max(maxX - minX + 2 * padding, 12)),
      round(Math.max(maxY - minY + 2 * padding, 12)),
      round(Math.max(maxZ - minZ + 2 * padding, 12)),
    ],
  };
}
