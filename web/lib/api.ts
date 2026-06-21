// Typed fetchers hitting the same-origin /api/* proxy. No backend URL here — that lives
// server-side in the Route Handler. These run in the browser.

import type {
  CreateJobResponse,
  DockResult,
  Escrow,
  JobParams,
  JobSpec,
  JobsListResponse,
  JobState,
  JobStatus,
  Ligand,
  Proof,
  RunJobResponse,
} from "./types";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `request failed (${res.status})`);
  }
  return body as T;
}

/** SWR-friendly GET fetcher. Throws ApiError carrying the upstream status. */
export const fetcher = <T>(url: string): Promise<T> =>
  fetch(url, { cache: "no-store" }).then((r) => json<T>(r));

export async function getHealth(): Promise<{ status: string }> {
  return fetcher("/api/health");
}

export async function createJob(spec: JobSpec): Promise<CreateJobResponse> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  return json<CreateJobResponse>(res);
}

/**
 * Advance a job through the proof-then-pay layer by one bounded step (docked -> proof on
 * Walrus -> proven -> settled). Idempotent and retriable; safe to call repeatedly while a
 * job is `docked`/`proven`. See POST /jobs/{id}/finalize on the backend.
 */
export async function finalizeJob(
  id: string,
): Promise<{ state: string; proof_pending?: boolean }> {
  const res = await fetch(`/api/jobs/${id}/finalize`, { method: "POST" });
  return json(res);
}

/** The backend's server-computed price quote (POST /jobs/estimate). */
export interface JobEstimate {
  price: number;
  num_ligands: number;
  pricing: { source: string; rate_per_ligand: number };
}

/**
 * Ask the backend to price a run before submitting — the price is ALWAYS computed
 * server-side (the UI never sets it). The estimate endpoint expects the backend's
 * internal JobSpec shape (a single multi-molecule `ligands_sdf`, not the FE ligand
 * array), and only the ligand count actually affects the price, so receptor/box/
 * researcher are sent as valid-but-nominal placeholders.
 */
export async function estimateJob(
  ligands: Ligand[],
  params: JobParams,
): Promise<JobEstimate> {
  const ligands_sdf = ligands
    .map((l) => l.sdf ?? "")
    .filter(Boolean)
    .map((s) => (s.trimEnd().endsWith("$$$$") ? s : `${s.trimEnd()}\n$$$$\n`))
    .join("");
  const res = await fetch("/api/jobs/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      receptor: { pdb_id: "0000" },
      ligands_sdf: ligands_sdf || "$$$$\n",
      box: { autobox_ligand: "ref_ligand" },
      params: {
        exhaustiveness: params.exhaustiveness,
        num_modes: params.num_modes,
        seed: params.seed,
      },
      payment: { supplier_id: "any" },
      researcher_id: "estimate",
    }),
  });
  return json<JobEstimate>(res);
}

/** On-chain config for the wallet lock flow (which Move package + arbiter + network). */
export interface ChainInfo {
  onchain: boolean;
  packageId?: string;
  module?: string;
  arbiter?: string;
  network?: string;
}

export const getChainInfo = (): Promise<ChainInfo> => fetcher("/api/chain/info");

/** What the wallet needs to lock the right amount for this job. `onchain:false` => no wallet step. */
export interface PaymentIntent {
  job_id: string;
  price: number;
  amount_mist: number;
  onchain: boolean;
  package_id?: string;
  module?: string;
  arbiter?: string;
  network?: string;
}

/** Researcher accepts the price. On-chain: returns a payment intent to lock. Off-chain: queues. */
export async function confirmJob(
  id: string,
): Promise<{ job_id: string; state: JobState; payment?: PaymentIntent }> {
  const res = await fetch(`/api/jobs/${id}/confirm`, { method: "POST" });
  return json(res);
}

/** Tell the backend the wallet locked the escrow; it verifies on-chain, then queues the job. */
export async function recordEscrowLock(
  id: string,
  escrowObjectId: string,
): Promise<{ job_id: string; state: JobState }> {
  const res = await fetch(`/api/jobs/${id}/escrow-locked`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ escrow_object_id: escrowObjectId }),
  });
  return json(res);
}

export const getJobsList = (): Promise<JobsListResponse> => fetcher("/api/jobs");

export const getJob = (id: string): Promise<JobStatus> =>
  fetcher(`/api/jobs/${id}`);

export const getEscrow = (id: string): Promise<Escrow> =>
  fetcher(`/api/jobs/${id}/escrow`);

export const getResult = (id: string): Promise<DockResult> =>
  fetcher(`/api/jobs/${id}/result`);

export const getProof = (id: string): Promise<Proof> =>
  fetcher(`/api/jobs/${id}/proof`);

/** Provider claims + starts a queued job (the seller "Run" action). */
export async function runJob(
  id: string,
  supplierId: string,
): Promise<RunJobResponse> {
  const res = await fetch(`/api/jobs/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplier_id: supplierId }),
  });
  return json<RunJobResponse>(res);
}

// ---- Provider registration + dashboard ----

export interface ResearcherIdentity {
  researcher_id: string;
  email: string;
}

/** Researcher sign-up/sign-in by email (idempotent). The email is the account identity. */
export async function createResearcher(email: string): Promise<ResearcherIdentity> {
  const res = await fetch("/api/researchers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return json<ResearcherIdentity>(res);
}

export interface ProviderIdentity {
  worker_id: string;
  token: string;
  email: string;
  sui_address: string;
  control_plane_url: string;
  package_url: string;
  run_command: string;
}

/** Register as a compute provider — issues a worker_id + token + the daemon run command. */
export async function createProvider(
  email: string,
  suiAddress: string,
): Promise<ProviderIdentity> {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, sui_address: suiAddress }),
  });
  return json<ProviderIdentity>(res);
}

export interface ProviderRecord {
  worker_id: string;
  status: "online" | "offline";
  email?: string;
  sui_address?: string;
  hardware_info?: string;
  registered_at?: string;
  jobs_completed?: number;
  total_earned?: number;
  jobs: { job_id: string; state: JobState; price: number | null; kind: string; created_at: string }[];
}

export const getProvider = (workerId: string): Promise<ProviderRecord> =>
  fetcher(`/api/providers/${workerId}/json`);

// ---- Researcher "my jobs" (keyed by wallet address) ----

export interface MyJob {
  job_id: string;
  state: JobState;
  price: number | null;
  num_ligands: number;
  created_at: string;
}

export const getMyJobs = (researcher: string): Promise<{ researcher: string; jobs: MyJob[] }> =>
  fetcher(`/api/researchers/${encodeURIComponent(researcher)}/jobs`);

export { ApiError };
