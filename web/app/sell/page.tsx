"use client";

/*
  Provider (supply) side. Logged out -> a documentation landing page that explains exactly
  how to make your hardware available, with requirements and the real commands, plus the
  email-based registration form. Logged in -> a dashboard keyed off the issued worker_id:
  your email identity, online/offline, the run command, queued jobs to claim, and the jobs
  this node has run. "Log out" fully clears the local identity and SWR cache.
*/

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
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
  const { mutate } = useSWRConfig();

  function logout() {
    clear();
    // Drop any cached provider/job data so nothing from the previous session lingers.
    mutate(() => true, undefined, { revalidate: false });
  }

  if (!ready) return <main className="mx-auto max-w-4xl px-6 py-16" />;
  return identity ? (
    <ProviderDashboard identity={identity} onLogout={logout} />
  ) : (
    <ProviderLanding onRegistered={setIdentity} />
  );
}

/* ----------------------------------------------------------------------------- landing -- */

const STEPS = [
  {
    n: 1,
    title: "Register with your email",
    body: "Your email is your provider identity — sign up (or back in) with the same email any time and you keep the same node, earnings and history. Add the Sui address you want to be paid to.",
  },
  {
    n: 2,
    title: "Download the worker package",
    body: "A small bundle with the orchestrator (worker_daemon.py) and an install script. The only thing that runs on your machine is the orchestrator; the docking engine runs sealed inside Docker.",
  },
  {
    n: 3,
    title: "Run the one-line command",
    body: "We issue a worker id + token and a ready-to-paste command. Run it on the machine you want to rent out — it detects your hardware and starts polling for jobs.",
  },
  {
    n: 4,
    title: "Earn SUI on verified results",
    body: "Claim queued jobs (or let them auto-dispatch). When a result passes proof + verification, the on-chain escrow releases straight to your Sui address.",
  },
];

function ProviderLanding({ onRegistered }: { onRegistered: (id: ProviderIdentity) => void }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <a href="/" className="text-xs text-muted hover:text-foreground">
        ← marketplace
      </a>

      <div className="mt-3">
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          For providers · rent out your GPU/CPU
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Make your hardware available
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Turn idle compute into income: run molecular-docking jobs from the marketplace and
          get paid in SUI for every verified result. Setup is one registration and one
          command — no account approval, no fixed contract.
        </p>
      </div>

      {/* How it works */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-muted">
        How it works
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 font-mono text-xs text-accent-bright">
                {s.n}
              </span>
              <h3 className="text-sm font-semibold">{s.title}</h3>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Requirements + docs */}
      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">Requirements</h3>
          <ul className="mt-3 space-y-2 text-[13px] text-muted">
            <Req>
              <b className="text-foreground">Docker</b> — the docking engine (AutoDock Vina)
              runs in a container, built once on first run (~300&nbsp;MB).
            </Req>
            <Req>
              <b className="text-foreground">Python 3</b> — runs the orchestrator; its only
              dependency (<code className="text-foreground">requests</code>) is installed for
              you.
            </Req>
            <Req>
              A machine you can leave running with an internet connection. A GPU helps but a
              CPU works.
            </Req>
          </ul>
          <p className="mt-3 text-xs text-muted">
            Nothing else touches your system: RDKit, the engine and all job data stay inside a
            fresh container per job and are removed afterwards.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">The commands</h3>
          <p className="mt-2 text-[13px] text-muted">
            After you register, you get your exact command with your worker id + token. The
            shape is:
          </p>
          <div className="mt-3">
            <Copyable value="CONTROL_PLANE_URL=<control-plane> WORKER_ID=<your-id> WORKER_TOKEN=<your-token> ./install_worker.sh" />
          </div>
          <p className="mt-3 text-[13px] text-muted">It will:</p>
          <ul className="mt-1.5 space-y-1.5 text-[13px] text-muted">
            <Req>check Docker + Python 3 are present;</Req>
            <Req>
              install <code className="text-foreground">requests</code> and start{" "}
              <code className="text-foreground">worker_daemon.py</code>;
            </Req>
            <Req>
              print your detected hardware, then{" "}
              <code className="text-foreground">polling for jobs…</code>
            </Req>
          </ul>
          <p className="mt-3 text-xs text-muted">
            The worker id and token are issued by the server — you never invent them, so two
            providers can never collide on the same identity.
          </p>
        </div>
      </div>

      {/* Register */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-muted">
        Register your node
      </h2>
      <RegisterForm onRegistered={onRegistered} />
    </main>
  );
}

function Req({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
      <span>{children}</span>
    </li>
  );
}

function RegisterForm({ onRegistered }: { onRegistered: (id: ProviderIdentity) => void }) {
  const [email, setEmail] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/.+@.+\..+/.test(email.trim())) {
      setErr("Enter a valid email — it's your provider identity.");
      return;
    }
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
    <form
      onSubmit={submit}
      className="mt-3 grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2"
    >
      <label className="block text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lab.bio"
          className="input mt-1.5 font-mono"
        />
        <span className="mt-1 block text-xs text-muted">
          Your identity. Sign in again with it to recover this node.
        </span>
      </label>
      <label className="block text-sm">
        <span className="font-medium">Sui payout address (testnet)</span>
        <input
          type="text"
          required
          placeholder="0x…"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          className="input mt-1.5 font-mono text-xs"
          spellCheck={false}
        />
        <span className="mt-1 block text-xs text-muted">
          Where escrow pays out on a verified job.
        </span>
      </label>
      <div className="sm:col-span-2">
        {err && <p className="mb-3 text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
        >
          {busy ? "Registering…" : "Register node"}
        </button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------------------- dashboard -- */

function ProviderDashboard({
  identity,
  onLogout,
}: {
  identity: ProviderIdentity;
  onLogout: () => void;
}) {
  const { data: node } = useSWR(
    ["provider", identity.worker_id],
    () => getProvider(identity.worker_id),
    { refreshInterval: 5000 },
  );
  const { data: list } = useSWR("jobs-list", getJobsList, { refreshInterval: 4000 });
  const [claiming, setClaiming] = useState<string | null>(null);

  const jobs = node?.jobs ?? [];
  const completed = node?.jobs_completed ?? jobs.filter((j) => j.state === "settled").length;
  const earned = node?.total_earned ?? 0;
  const queued = (list?.jobs ?? []).filter((j) => j.state === "queued");
  const online = node?.status === "online";
  const email = identity.email || node?.email || "—";

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
    <main className="bg-grid-glow">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Header card */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent-bright">
                <ServerIcon />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight">Provider node</h1>
                <p className="mt-0.5 truncate text-sm text-muted">
                  Signed in as <span className="font-mono text-foreground">{email}</span>
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted">{identity.worker_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill online={online} />
              <button
                type="button"
                onClick={onLogout}
                className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground transition-colors hover:border-red-500/50 hover:text-red-300"
              >
                Log out
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat icon={<CheckIcon />} n={completed} label="jobs completed" />
          <Stat
            icon={<CoinIcon />}
            n={(earned as number).toFixed(4)}
            unit="SUI"
            label="earned"
            accent
          />
          <Stat icon={<EyeIcon />} n={jobs.length} label="jobs seen" />
        </div>

      {/* Setup guide — shown only while the node is offline; the full guide also lives in /docs. */}
      {online ? (
        <p className="mt-4 text-center text-xs text-muted">
          Your node is running and receiving jobs. Need the setup steps again?{" "}
          <a href="/docs" className="text-accent hover:underline">
            See the docs
          </a>
          .
        </p>
      ) : (
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/40 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/15 text-accent-bright">
              <BoltIcon />
            </span>
            <h2 className="text-sm font-semibold">Make your hardware available</h2>
          </div>
          <span className={`text-xs ${online ? "text-emerald-300" : "text-amber-300"}`}>
            {online ? "node online ✓" : "offline — not receiving jobs"}
          </span>
        </div>
        <div className="p-6">
        <p className="text-[13px] leading-relaxed text-muted">
          Run the daemon on the machine you want to rent out. It needs{" "}
          <b className="text-foreground">Docker</b> and <b className="text-foreground">Python 3</b>
          {" "}— the docking engine runs sealed in a container, nothing else touches your system.
        </p>

        <ol className="mt-5 space-y-5">
          <SetupStep n={1} title="Download the worker package">
            <p className="text-[13px] text-muted">
              Grab the bundle (orchestrator + install script) and unzip it:
            </p>
            <div className="mt-2">
              <Copyable
                value={`curl -L -o worker-package.zip ${identity.package_url} && unzip worker-package.zip && cd worker-package`}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Or download it directly:{" "}
              <a href={identity.package_url} className="text-accent hover:underline">
                worker-package.zip
              </a>
            </p>
          </SetupStep>

          <SetupStep n={2} title="Check prerequisites">
            <p className="text-[13px] text-muted">
              Confirm Docker and Python 3 are installed and the Docker daemon is running:
            </p>
            <div className="mt-2">
              <Copyable value="docker --version && python3 --version && docker info >/dev/null && echo ok" />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              No Docker?{" "}
              <a
                href="https://docs.docker.com/get-docker/"
                className="text-accent hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                docs.docker.com/get-docker
              </a>
            </p>
          </SetupStep>

          <SetupStep n={3} title="Start the daemon (your one-line command)">
            <p className="text-[13px] text-muted">
              This is pre-filled with your worker id + token — paste and run it:
            </p>
            <div className="mt-2">
              <Copyable value={identity.run_command} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              The script installs the one Python dependency (
              <code className="text-foreground">requests</code>), then starts the orchestrator.
            </p>
          </SetupStep>

          <SetupStep n={4} title="What you'll see">
            <ul className="space-y-1.5 text-[13px] text-muted">
              <Bullet>
                First run builds the AutoDock Vina engine image (~300&nbsp;MB, one-time).
              </Bullet>
              <Bullet>It prints your detected hardware (CPU/GPU, cores, memory).</Bullet>
              <Bullet>
                Then <code className="text-foreground">polling for jobs…</code> — at that point
                your status above flips to <span className="text-emerald-300">online</span> and
                queued jobs become claimable.
              </Bullet>
            </ul>
          </SetupStep>

          <SetupStep n={5} title="Keep it running & get paid">
            <p className="text-[13px] text-muted">
              Leave the process running (or run it under <code className="text-foreground">nohup</code>
              {" "}/ a service). Claim queued jobs below, or let them auto-dispatch. On a verified
              result the on-chain escrow releases straight to your payout address:
            </p>
            <p className="mt-1.5 break-all font-mono text-xs text-foreground">
              {identity.sui_address || "—"}
            </p>
          </SetupStep>
        </ol>
        </div>
      </section>
      )}

      {/* Queued jobs */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/40 px-5 py-3">
          <h2 className="text-sm font-semibold">Queued jobs you can run</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {queued.length}
          </span>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {queued.map((j) => (
              <tr key={j.job_id} className="transition-colors hover:bg-surface-2/40">
                <td className="px-5 py-3 font-mono text-xs text-accent-bright">
                  {j.job_id.slice(0, 8)}
                </td>
                <td className="px-5 py-3 font-mono text-xs text-muted">{j.price ?? "—"} SUI</td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => claim(j.job_id)}
                    disabled={claiming === j.job_id}
                    className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
                  >
                    {claiming === j.job_id ? "Claiming…" : "Run ▶"}
                  </button>
                </td>
              </tr>
            ))}
            {queued.length === 0 && (
              <tr>
                <td className="px-5 py-8 text-center text-sm text-muted">
                  No queued jobs right now — they appear here as researchers submit.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Jobs run by this node */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/40 px-5 py-3">
          <h2 className="text-sm font-semibold">Jobs run by this node</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {jobs.length}
          </span>
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {jobs.map((j) => (
              <tr key={j.job_id} className="transition-colors hover:bg-surface-2/40">
                <td className="px-5 py-3 font-mono text-xs text-accent-bright">
                  {j.job_id.slice(0, 8)}
                </td>
                <td className="px-5 py-3">
                  <JobProgress state={j.state} />
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs text-muted">
                  {j.price ?? "—"} SUI
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td className="px-5 py-8 text-center text-sm text-muted">
                  No jobs yet — start the daemon and claim a queued job above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      </div>
    </main>
  );
}

function Stat({
  icon,
  n,
  unit,
  label,
  accent,
}: {
  icon: React.ReactNode;
  n: number | string;
  unit?: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 text-muted">
        {icon}
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div
        className={`mt-2 text-2xl font-semibold tracking-tight ${
          accent ? "text-accent-bright" : "text-foreground"
        }`}
      >
        {n}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        online ? "bg-emerald-500/15 text-emerald-300" : "bg-surface-2 text-muted"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          online ? "animate-pulse bg-emerald-400" : "bg-muted"
        }`}
      />
      {online ? "online" : "offline"}
    </span>
  );
}

function ServerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7 7.5h.01M7 16.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M20 7L10 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5v9M9.5 10h3.2a1.8 1.8 0 0 1 0 3.6H9.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

function SetupStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 font-mono text-xs text-accent-bright">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
      <span>{children}</span>
    </li>
  );
}
