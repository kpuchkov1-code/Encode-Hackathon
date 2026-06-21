import Link from "next/link";
import { Copyable } from "@/components/Copyable";

// Lightweight getting-started page linked from the nav's Docs button.
export const metadata = {
  title: "Docs — Getting started · DockMarket",
  description: "How to run a docking job or rent out your GPUs on DockMarket.",
};

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-xs text-muted hover:text-foreground">
        ← marketplace
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Getting started</h1>
      <p className="mt-0.5 text-sm text-muted">
        DockMarket is a two-sided exchange for biomolecular compute. Pick a side below.
      </p>

      <Card
        eyebrow="Pay for compute"
        title="Run a docking job"
        href="/console"
        cta="Open the console"
      >
        <Step n={1} title="Load a receptor">
          Fetch a structure by PDB ID or upload your own{" "}
          <Code>.pdb</Code> in the Files panel.
        </Step>
        <Step n={2} title="Define the pocket">
          Drag across residues in the sequence strip, or ask the copilot to highlight a
          region — the selection becomes your docking box.
        </Step>
        <Step n={3} title="Add ligands & submit">
          Drop an <Code>.sdf</Code> ligand library and submit. The price is set by the
          network and held in on-chain escrow on Sui until the run is proven.
        </Step>
        <Step n={4} title="Read the results">
          Watch the candidate settle into the pocket as the job runs, then export the ranked
          docking affinity scores as CSV.
        </Step>
      </Card>

      <Card
        eyebrow="Rent out your hardware"
        title="Provide GPU compute"
        href="/sell"
        cta="Open the provider dashboard"
      >
        <Step n={1} title="Register a node">
          Add your GPU and on-demand rate in the provider dashboard. Set a payout wallet in{" "}
          <Link href="/settings" className="text-accent-bright hover:underline">
            settings
          </Link>
          .
        </Step>
        <Step n={2} title="Accept jobs">
          Matching jobs flow to your queue. Each run produces a cryptographic proof of
          execution.
        </Step>
        <Step n={3} title="Get paid">
          Escrow releases to your wallet automatically once the proof verifies.
        </Step>
      </Card>

      {/* Full worker-daemon setup — also surfaced on the provider dashboard while offline. */}
      <section className="mt-6 rounded-xl border border-border bg-surface p-6">
        <div className="font-mono text-[11px] uppercase tracking-wider text-accent-bright">
          Provider setup
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Set up the worker daemon</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The daemon runs on the machine you want to rent out. It needs <Code>Docker</Code> and{" "}
          <Code>Python 3</Code> — the docking engine (AutoDock Vina) runs sealed inside a
          container, so nothing else touches your system.
        </p>

        <ol className="mt-5 space-y-5">
          <DStep n={1} title="Register to get your command">
            <p>
              Sign up at the{" "}
              <Link href="/sell" className="text-accent-bright hover:underline">
                provider dashboard
              </Link>{" "}
              with your email + Sui payout address. You get a worker id, token and a
              ready-to-paste command — its shape is:
            </p>
            <div className="mt-2">
              <Copyable value="CONTROL_PLANE_URL=<control-plane> WORKER_ID=<your-id> WORKER_TOKEN=<your-token> ./install_worker.sh" />
            </div>
          </DStep>
          <DStep n={2} title="Download & unzip the package">
            <Copyable value="curl -L -o worker-package.zip <control-plane>/worker-package.zip && unzip worker-package.zip && cd worker-package" />
          </DStep>
          <DStep n={3} title="Check prerequisites">
            <Copyable value="docker --version && python3 --version && docker info >/dev/null && echo ok" />
            <p className="mt-1.5 text-xs">
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
          </DStep>
          <DStep n={4} title="Run it & keep it running">
            <p>
              Paste your command. First run builds the engine image (~300&nbsp;MB, one-time),
              prints your detected hardware, then <Code>polling for jobs…</Code>. Leave it
              running (or under <Code>nohup</Code> / a service). On a verified result the
              on-chain escrow releases straight to your payout address.
            </p>
          </DStep>
        </ol>
        <Link
          href="/sell"
          className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Register your node
        </Link>
      </section>

      <p className="mt-8 text-xs text-muted">
        Testnet demo — escrow and payouts run on Sui testnet (play-money).
      </p>
    </main>
  );
}

function DStep({
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
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 space-y-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

function Card({
  eyebrow,
  title,
  href,
  cta,
  children,
}: {
  eyebrow: string;
  title: string;
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-6">
      <div className="font-mono text-[11px] uppercase tracking-wider text-accent-bright">
        {eyebrow}
      </div>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      <ol className="mt-4 space-y-4">{children}</ol>
      <Link
        href={href}
        className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
      >
        {cta}
      </Link>
    </section>
  );
}

function Step({
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
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
      {children}
    </code>
  );
}
