"use client";

/*
  Buyer "My jobs" — every job submitted under the signed-in researcher, newest first, with
  the right next action per job (pay if still pending_payment, otherwise view). Keyed off the
  researcher identity used at submit: the signed-in email, or the wallet address as fallback.
*/

import Link from "next/link";
import useSWR from "swr";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { getMyJobs, type MyJob } from "@/lib/api";
import { useResearcher } from "@/lib/researcher-identity";
import { isTerminal } from "@/lib/types";
import { JobProgress } from "@/components/JobProgress";

export default function MyJobsPage() {
  const account = useCurrentAccount();
  const { identity } = useResearcher();
  const key = identity?.email ?? account?.address;

  const { data, isLoading } = useSWR(
    key ? ["my-jobs", key] : null,
    () => getMyJobs(key as string),
    { refreshInterval: 4000 },
  );

  if (!key) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">My jobs</h1>
        <p className="mt-3 text-sm text-muted">
          Sign in with your email (Account, top right) to see the jobs you’ve submitted. Your
          email is your identity — jobs are grouped under it.
        </p>
      </main>
    );
  }

  const jobs = data?.jobs ?? [];
  const spent = jobs
    .filter((j) => !["pending_payment", "failed"].includes(j.state))
    .reduce((s, j) => s + (j.price ?? 0), 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">My jobs</h1>
        <Link href="/submit" className="text-sm text-accent hover:underline">
          + Submit another
        </Link>
      </div>
      <p className="mt-1 font-mono text-xs text-muted">{key}</p>

      <div className="mt-6 flex gap-6 text-sm">
        <Stat n={jobs.length} label="total" />
        <Stat n={jobs.filter((j) => !isTerminal(j.state)).length} label="in progress" />
        <Stat n={jobs.filter((j) => j.state === "settled").length} label="settled" />
        <Stat n={`$${spent.toFixed(4)}`} label="committed" />
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/60 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-4 py-2.5 font-medium">Ligands</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Price</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {jobs.map((j) => (
              <Row key={j.job_id} job={j} />
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  {isLoading ? "Loading…" : "No jobs yet — "}
                  {!isLoading && (
                    <Link href="/submit" className="text-accent hover:underline">
                      submit one
                    </Link>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Row({ job }: { job: MyJob }) {
  const href =
    job.state === "pending_payment" ? `/jobs/${job.job_id}/pay` : `/jobs/${job.job_id}`;
  const action = job.state === "pending_payment" ? "Pay & submit" : "View";
  return (
    <tr className="hover:bg-neutral-900/40">
      <td className="px-4 py-2.5">
        <Link href={`/jobs/${job.job_id}`} className="font-mono text-xs text-accent-bright hover:underline">
          {job.job_id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-4 py-2.5 text-neutral-400">{job.num_ligands}</td>
      <td className="px-4 py-2.5">
        <JobProgress state={job.state} />
      </td>
      <td className="px-4 py-2.5 text-neutral-400">
        {job.price != null ? `$${job.price}` : "—"}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link href={href} className="text-xs text-accent hover:underline">
          {action}
        </Link>
      </td>
    </tr>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-neutral-100">{n}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
