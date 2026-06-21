"use client";

/*
  Provider side — the real two-step supply flow, replacing the simulated node demo:
   1. Register (email + Sui payout address) -> backend issues a worker_id + token + the
      one-line daemon command (the original /providers/signup, as JSON).
   2. Dashboard keyed off that real worker_id: live online/offline status, the run command,
      jobs this node has run (real), and earnings. Plus a feed of queued jobs the provider
      can claim ("Run"), making the supply side causal.
*/

import { useState } from "react";
import useSWR from "swr";
import {
  createProvider,
  getProvider,
  getJobsList,
  runJob,
  ApiError,
  type ProviderIdentity,
} from "@/lib/api";
import { useProviderIdentity } from "@/lib/provider-identity";
import { Copyable } from "@/components/Copyable";
import { JobProgress } from "@/components/JobProgress";

export default function SellPage() {
  const { identity, ready, setIdentity, clear } = useProviderIdentity();
  if (!ready) return <main className="mx-auto max-w-3xl px-6 py-16" />;
  return identity ? (
    <ProviderDashboard identity={identity} onForget={clear} />
  ) : (
    <ProviderRegister onRegistered={setIdentity} />
  );
}

function ProviderRegister({ onRegistered }: { onRegistered: (id: ProviderIdentity) => void }) {
  const [email, setEmail] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/^0x[0-9a-fA-F]{64}$/.test(addr.trim())) {
      setErr("Enter a valid Sui payout address (0x + 64 hex chars).");
      return;
    }
    setBusy(true);
    try {
      onRegistered(await createProvider(email.trim(), addr.trim()));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Registration failed.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Provide compute</h1>
      <p className="mt-3 text-sm text-neutral-400">
        Rent out your GPU/CPU to run docking jobs and get paid in SUI. Register once to get
        your node identity and a one-line command to start the daemon — your hardware is
        detected automatically when it runs.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <label className="block text-sm">
          <span className="text-neutral-300">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">Sui payout address (testnet)</span>
          <input
            type="text"
            required
            placeholder="0x…"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs outline-none focus:border-accent"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            Where you get paid when a job you run is verified.
          </span>
        </label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-bright disabled:opacity-50"
        >
          {busy ? "Registering…" : "Register node"}
        </button>
      </form>
    </main>
  );
}

function ProviderDashboard({
  identity,
  onForget,
}: {
  identity: ProviderIdentity;
  onForget: () => void;
}) {
  const { data: node } = useSWR(
    ["provider", identity.worker_id],
    () => getProvider(identity.worker_id),
    { refreshInterval: 5000 },
  );
  const { data: list } = useSWR("jobs-list", getJobsList, { refreshInterval: 4000 });
  const [claiming, setClaiming] = useState<string | null>(null);

  const jobs = node?.jobs ?? [];
  const completed = jobs.filter((j) => j.state === "settled").length;
  const earned = node?.total_earned ?? 0;
  const queued = (list?.jobs ?? []).filter((j) => j.state === "queued");
  const online = node?.status === "online";

  async function claim(id: string) {
    setClaiming(id);
    try {
      await runJob(id, identity.worker_id);
    } catch {
      /* surfaced via the job's own polling */
    } finally {
      setClaiming(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Provider dashboard</h1>
          <p className="mt-1 font-mono text-xs text-neutral-500">{identity.worker_id}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs ${
            online ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-700/40 text-neutral-400"
          }`}
        >
          {online ? "● online" : "○ offline"}
        </span>
      </div>

      <div className="mt-6 flex gap-6 text-sm">
        <Stat n={node?.jobs_completed ?? completed} label="jobs completed" />
        <Stat n={`$${(earned as number).toFixed(4)}`} label="earned" />
        <Stat n={jobs.length} label="jobs seen" />
      </div>

      {!online && (
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="text-amber-200">Your node is offline. Start the daemon to receive jobs:</p>
          <div className="mt-2">
            <Copyable value={identity.run_command} />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Run on the machine that provides compute (Docker + Python 3 required). It prints your
            detected hardware, then <code>polling for jobs…</code>. Package:{" "}
            <a href={identity.package_url} className="text-accent hover:underline">
              worker-package.zip
            </a>
          </p>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold text-neutral-300">Queued jobs you can run</h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-neutral-800">
            {queued.map((j) => (
              <tr key={j.job_id} className="hover:bg-neutral-900/40">
                <td className="px-4 py-2.5 font-mono text-xs text-accent-bright">
                  {j.job_id.slice(0, 8)}
                </td>
                <td className="px-4 py-2.5 text-neutral-400">${j.price ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => claim(j.job_id)}
                    disabled={claiming === j.job_id}
                    className="rounded-lg border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {claiming === j.job_id ? "Claiming…" : "Run"}
                  </button>
                </td>
              </tr>
            ))}
            {queued.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-neutral-500">No queued jobs right now.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-neutral-300">Jobs run by this node</h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-neutral-800">
            {jobs.map((j) => (
              <tr key={j.job_id} className="hover:bg-neutral-900/40">
                <td className="px-4 py-2.5 font-mono text-xs text-accent-bright">
                  {j.job_id.slice(0, 8)}
                </td>
                <td className="px-4 py-2.5">
                  <JobProgress state={j.state} />
                </td>
                <td className="px-4 py-2.5 text-right text-neutral-400">${j.price ?? "—"}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-neutral-500">
                  No jobs yet — start the daemon and claim a queued job above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button onClick={onForget} className="mt-8 text-xs text-neutral-500 hover:text-red-300">
        Forget this node on this device
      </button>
    </main>
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
