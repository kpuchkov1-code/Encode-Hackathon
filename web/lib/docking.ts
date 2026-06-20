/*
  Docking-visual helpers — pure, framework-free, no Mol* import.

  The mock backend returns docking *scores* but no pose *geometry* (LigandResult.pose_path
  is just a string). To still show "the candidate in the pocket" we:
    1. infer the real binding-pocket location from the receptor's bound-ligand atoms, and
    2. synthesize a small illustrative ligand placed there.

  When the real backend returns actual pose SDF text, skip buildPoseSdf entirely and feed
  that text straight to the viewer — these helpers are only the stand-in until then.
*/

export type Vec3 = [number, number, number];

/**
 * Infer a binding-pocket centre from raw PDB text by averaging the coordinates of the
 * bound-ligand atoms (HETATM, excluding waters). Falls back to the all-atom centroid, then
 * to the origin. For 6LU7 this lands on the N3 inhibitor site — the actual pocket.
 */
export function pocketCenterFromPdb(text: string): Vec3 {
  const het: Vec3[] = [];
  const all: Vec3[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const isHet = line.startsWith("HETATM");
    const isAtom = line.startsWith("ATOM");
    if (!isHet && !isAtom) continue;
    const resName = line.slice(17, 20).trim();
    if (isHet && (resName === "HOH" || resName === "WAT")) continue;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) continue;
    all.push([x, y, z]);
    if (isHet) het.push([x, y, z]);
  }
  const pool = het.length > 0 ? het : all;
  if (pool.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const [x, y, z] of pool) {
    sx += x;
    sy += y;
    sz += z;
  }
  const n = pool.length;
  return [sx / n, sy / n, sz / n];
}

// A small phenol-like fragment (6-ring + hydroxyl): relative coordinates in the xy-plane.
// Just enough atoms to read as a drug-like molecule in ball-and-stick. Element + (x,y,z).
const TEMPLATE: { el: string; pos: Vec3 }[] = [
  { el: "C", pos: [1.39, 0.0, 0.0] },
  { el: "C", pos: [0.695, 1.204, 0.0] },
  { el: "C", pos: [-0.695, 1.204, 0.0] },
  { el: "C", pos: [-1.39, 0.0, 0.0] },
  { el: "C", pos: [-0.695, -1.204, 0.0] },
  { el: "C", pos: [0.695, -1.204, 0.0] },
  { el: "O", pos: [2.59, 0.0, 0.0] },
];

// Bond table: [atom1, atom2, order] (1-indexed). Aromatic ring drawn as alternating + the C-OH.
const BONDS: [number, number, number][] = [
  [1, 2, 2],
  [2, 3, 1],
  [3, 4, 2],
  [4, 5, 1],
  [5, 6, 2],
  [6, 1, 1],
  [1, 7, 1],
];

// Deterministic [0,1) pseudo-random from (seed, salt) — keeps poses reproducible per seed.
function rand(seed: number, salt: number): number {
  const s = Math.sin((seed + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Stable small integer seed from a string (e.g. jobId:ligandId) so each docking differs. */
export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

function f(n: number): string {
  return n.toFixed(4).padStart(10, " ");
}

function i3(n: number): string {
  return String(n).padStart(3, " ");
}

/**
 * Build a valid V2000 SDF string for one illustrative pose: the template fragment rotated
 * about z and offset around `center` by a seed-driven jitter. `spread` (Å) controls how far
 * the candidate scatters — small for the settled "best" pose, large for the search. Distinct
 * seeds give distinct orientations/positions, so every docking looks slightly different.
 */
export function buildPoseSdf(center: Vec3, seed: number, spread = 3.5): string {
  const [cx, cy, cz] = center;
  const ox = (rand(seed, 1) - 0.5) * spread;
  const oy = (rand(seed, 2) - 0.5) * spread;
  const oz = (rand(seed, 3) - 0.5) * spread;
  const angle = rand(seed, 4) * Math.PI * 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);

  const atomLines = TEMPLATE.map(({ el, pos }) => {
    const [px, py, pz] = pos;
    const rx = px * ca - py * sa;
    const ry = px * sa + py * ca;
    const x = cx + ox + rx;
    const y = cy + oy + ry;
    const z = cz + oz + pz;
    return `${f(x)}${f(y)}${f(z)} ${el.padEnd(3, " ")} 0  0  0  0  0  0  0  0  0  0  0  0`;
  });

  const bondLines = BONDS.map(([a, b, o]) => `${i3(a)}${i3(b)}${i3(o)}  0  0  0  0`);

  const counts = `${i3(TEMPLATE.length)}${i3(BONDS.length)}  0  0  0  0  0  0  0  0999 V2000`;

  return [
    "candidate",
    "  ConsensusVS demo",
    "",
    counts,
    ...atomLines,
    ...bondLines,
    "M  END",
    "$$$$",
    "",
  ].join("\n");
}
