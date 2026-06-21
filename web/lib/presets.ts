import type { JobSpec } from "./types";

// Canonical valid job (mirrors fixtures/sample_job.json): aspirin (active) vs ethane (decoy)
// against the SARS main protease 6LU7. The active outranks the decoy — the science payoff.
export const SAMPLE_JOB: JobSpec = {
  receptor: { pdb_id: "6LU7" },
  ligands: [
    { id: "lig_active", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
    { id: "lig_decoy", smiles: "CC" },
  ],
  box: { autobox_ligand: "ref_ligand" },
  params: { exhaustiveness: 8, num_modes: 5, cnn: "rescore", seed: 42 },
  payment: { amount: 100, supplier_id: "node-1" },
};

// Drives the mock's failure path (receptor.pdb_id === "FAIL") to exercise the
// error + refund UI.
export const FAIL_JOB: JobSpec = {
  ...SAMPLE_JOB,
  receptor: { pdb_id: "FAIL" },
};

export const SUPPLIERS = ["node-1", "node-2", "gpu-west-3"];

export const PRESETS: Record<string, JobSpec> = {
  sample: SAMPLE_JOB,
  fail: FAIL_JOB,
};
