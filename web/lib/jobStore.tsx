"use client";

/*
  Editable job-draft store — the hybrid submit panel's backing state. The chat fills it
  (via the submit_job / set_pocket client tools); the user reviews and clicks Run, which
  is the only thing that actually calls POST /jobs. The model never submits silently.
*/

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Box, JobParams, JobSpec, Ligand } from "./types";
import type { BoxSpec } from "./structure";

export interface PocketState {
  box: Box;
  label: string; // "A:140-145" or "autobox: ref_ligand"
}

export interface JobDraft {
  ligands: Ligand[];
  pocket: PocketState | null;
  amount: number;
  supplierId: string;
  params: JobParams;
}

const DEFAULT_PARAMS: JobParams = {
  exhaustiveness: 8,
  num_modes: 5,
  cnn: "rescore",
  seed: 42,
};

const SAMPLE_LIGANDS: Ligand[] = [
  { id: "lig_active", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { id: "lig_decoy", smiles: "CC" },
];

export interface JobStore {
  draft: JobDraft;
  setLigands: (ligands: Ligand[]) => void;
  loadSampleLigands: () => void;
  setPocketFromBox: (box: BoxSpec, label: string) => void;
  setAutobox: (refLigand: string) => void;
  setAmount: (amount: number) => void;
  setSupplier: (id: string) => void;
  /** Active job id once Run has been clicked. */
  jobId: string | null;
  setJobId: (id: string | null) => void;
  buildSpec: (receptorPdbId: string) => JobSpec;
}

const JobContext = createContext<JobStore | null>(null);

export function JobProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<JobDraft>({
    ligands: [],
    pocket: null,
    amount: 100,
    supplierId: "node-1",
    params: DEFAULT_PARAMS,
  });
  const [jobId, setJobId] = useState<string | null>(null);

  const setLigands = useCallback(
    (ligands: Ligand[]) => setDraft((d) => ({ ...d, ligands })),
    [],
  );
  const loadSampleLigands = useCallback(
    () => setDraft((d) => ({ ...d, ligands: SAMPLE_LIGANDS })),
    [],
  );
  const setPocketFromBox = useCallback(
    (box: BoxSpec, label: string) =>
      setDraft((d) => ({ ...d, pocket: { box, label } })),
    [],
  );
  const setAutobox = useCallback(
    (refLigand: string) =>
      setDraft((d) => ({
        ...d,
        pocket: { box: { autobox_ligand: refLigand }, label: `autobox: ${refLigand}` },
      })),
    [],
  );
  const setAmount = useCallback(
    (amount: number) => setDraft((d) => ({ ...d, amount })),
    [],
  );
  const setSupplier = useCallback(
    (id: string) => setDraft((d) => ({ ...d, supplierId: id })),
    [],
  );

  const buildSpec = useCallback(
    (receptorPdbId: string): JobSpec => ({
      receptor: { pdb_id: receptorPdbId },
      ligands: draft.ligands,
      box: draft.pocket?.box ?? { autobox_ligand: "ref_ligand" },
      params: draft.params,
      payment: { amount: draft.amount, supplier_id: draft.supplierId },
    }),
    [draft],
  );

  const value = useMemo<JobStore>(
    () => ({
      draft,
      setLigands,
      loadSampleLigands,
      setPocketFromBox,
      setAutobox,
      setAmount,
      setSupplier,
      jobId,
      setJobId,
      buildSpec,
    }),
    [
      draft,
      setLigands,
      loadSampleLigands,
      setPocketFromBox,
      setAutobox,
      setAmount,
      setSupplier,
      jobId,
      buildSpec,
    ],
  );

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

export function useJobDraft(): JobStore {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error("useJobDraft must be used within JobProvider");
  return ctx;
}
