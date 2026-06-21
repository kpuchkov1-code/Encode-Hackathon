// TypeScript mirror of API_CONTRACT.md (v1). snake_case keys preserved verbatim.
// The frontend codes to THESE shapes; the mock + real backend honor them.

export type JobState =
  | "pending_payment" // created, awaiting the on-chain escrow lock (wallet step)
  | "queued"
  | "running"
  | "docked"
  | "proven"
  | "settled"
  | "failed";

/** Order of the happy-path lifecycle, used to gate progressive reveals. */
export const LIFECYCLE = [
  "queued",
  "running",
  "docked",
  "proven",
  "settled",
] as const satisfies readonly JobState[];

/** The five non-terminal-error states, in order. */
export type HappyState = (typeof LIFECYCLE)[number];

/** True once `state` has reached at least `target` on the happy path. */
export function stateReached(state: JobState, target: JobState): boolean {
  if (state === "failed") return false;
  const arr = LIFECYCLE as readonly JobState[];
  return arr.indexOf(state) >= arr.indexOf(target);
}

export const TERMINAL_STATES: JobState[] = ["settled", "failed"];
export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

// ---- JobSpec (POST /jobs body) ----

export interface Receptor {
  pdb_id?: string;
  file?: string;
}

export interface Ligand {
  id: string;
  smiles?: string;
  sdf?: string;
}

export type Box =
  | { autobox_ligand: string }
  | { center: [number, number, number]; size: [number, number, number] };

export interface JobParams {
  exhaustiveness: number;
  num_modes: number;
  cnn: string;
  seed: number;
}

export interface Payment {
  /** Optional and ignored by the backend — price is always server-computed (see estimate). */
  amount?: number;
  supplier_id: string;
}

export interface JobSpec {
  receptor: Receptor;
  ligands: Ligand[];
  box: Box;
  params: JobParams;
  payment: Payment;
  /** Connected wallet address — the researcher identity the backend groups jobs under. */
  researcher?: string;
}

// ---- Responses ----

export interface CreateJobResponse {
  job_id: string;
  state: JobState;
}

export interface JobStatus {
  job_id: string;
  state: JobState;
  reason: string; // empty unless failed
}

/** Response of POST /jobs/<id>/run — a provider claimed + started the job. */
export interface RunJobResponse {
  job_id: string;
  state: JobState;
  worker_id: string;
}

export type EscrowState = "held" | "released" | "refunded";

/** On-chain escrow detail (present when the backend runs real Sui escrow). */
export interface EscrowChain {
  network?: string;
  amount_mist?: number;
  escrow_object_id?: string;
  payer?: string;
  arbiter?: string;
  lock_digest?: string;
  release_digest?: string;
  refund_digest?: string;
  paid_to?: string;
}

export interface Escrow {
  state: EscrowState;
  amount: number;
  supplier_id: string;
  chain?: EscrowChain;
}

export interface LigandResult {
  ligand_id: string;
  cnn_score: number;
  cnn_affinity: number;
  vina_affinity: number;
  pose_path: string;
}

export interface DockResult {
  job_id: string;
  ligands: LigandResult[];
}

export interface Proof {
  manifest_sha256: string;
  receptor_sha256: string;
  ligand_sha256s: Record<string, string>;
  pose_sha256s: Record<string, string>;
  params: JobParams;
  gnina_version: string;
  timestamp: string;
  worker_id: string;
  storage_blob_id: string;
}

export interface JobListItem {
  job_id: string;
  state: JobState;
  created_at: string;
  price?: number | null;
  supplier_id?: string;
}

export interface JobsListResponse {
  jobs: JobListItem[];
}

export interface ApiError {
  error: string;
}
