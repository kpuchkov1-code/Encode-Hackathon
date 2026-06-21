"use client";

// SWR hooks driving the live job page. The polling discipline lives here:
//  - poll job + escrow every ~1.5s, STOP once the job reaches a terminal state
//  - fetch result only once docked, proof only once proven (avoids 409 spam)

import useSWR from "swr";
import { fetcher, getEscrow } from "./api";
import {
  type DockResult,
  type Escrow,
  type JobsListResponse,
  type JobStatus,
  type Proof,
  isTerminal,
  stateReached,
} from "./types";

const POLL_MS = 1500;

export function useHealth() {
  const { data, error } = useSWR<{ status: string }>("/api/health", fetcher, {
    refreshInterval: 5000,
    shouldRetryOnError: true,
  });
  return { ok: data?.status === "ok", offline: !!error };
}

export function useJob(id: string | null) {
  const { data, error } = useSWR<JobStatus>(
    id ? `/api/jobs/${id}` : null,
    fetcher,
    {
      // Stop polling on terminal state; otherwise poll.
      refreshInterval: (latest) =>
        latest && isTerminal(latest.state) ? 0 : POLL_MS,
    },
  );
  return { job: data, error };
}

export function useEscrow(id: string | null, state: JobStatus["state"] | undefined) {
  const { data } = useSWR<Escrow>(id ? `/api/jobs/${id}/escrow` : null, fetcher, {
    refreshInterval: state && isTerminal(state) ? 0 : POLL_MS,
  });
  return data;
}

export function useResult(id: string | null, state: JobStatus["state"] | undefined) {
  const ready = !!state && stateReached(state, "docked");
  const { data } = useSWR<DockResult>(
    id && ready ? `/api/jobs/${id}/result` : null,
    fetcher,
  );
  return data;
}

export function useProof(id: string | null, state: JobStatus["state"] | undefined) {
  const ready = !!state && stateReached(state, "proven");
  const { data } = useSWR<Proof>(
    id && ready ? `/api/jobs/${id}/proof` : null,
    fetcher,
  );
  return data;
}

// ---- Provider (sell) side ----

/** Poll the full jobs list for the provider dashboard feed. */
export function useJobsList() {
  const { data, error } = useSWR<JobsListResponse>("/api/jobs", fetcher, {
    refreshInterval: 2000,
  });
  return { jobs: data?.jobs ?? [], error, loading: !data && !error };
}

export type EscrowWithId = Escrow & { job_id: string };

/**
 * Fetch escrow for a set of jobs in one SWR key (Promise.all). Used to derive
 * provider earnings and per-job rewards. Capped to keep the demo light.
 */
export function useEscrows(ids: string[]) {
  const capped = ids.slice(0, 30);
  const key = capped.length ? `escrows:${capped.join(",")}` : null;
  const { data } = useSWR<EscrowWithId[]>(
    key,
    async () => {
      const results = await Promise.all(
        capped.map((id) =>
          getEscrow(id)
            .then((e) => ({ ...e, job_id: id }))
            .catch(() => null),
        ),
      );
      return results.filter((r): r is EscrowWithId => r !== null);
    },
    { refreshInterval: 2000 },
  );
  // Index by job_id for easy lookup.
  const byId: Record<string, EscrowWithId> = {};
  for (const e of data ?? []) byId[e.job_id] = e;
  return byId;
}
