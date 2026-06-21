// Typed fetchers hitting the same-origin /api/* proxy. No backend URL here — that lives
// server-side in the Route Handler. These run in the browser.

import type {
  CreateJobResponse,
  DockResult,
  Escrow,
  JobSpec,
  JobsListResponse,
  JobState,
  JobStatus,
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

export { ApiError };
