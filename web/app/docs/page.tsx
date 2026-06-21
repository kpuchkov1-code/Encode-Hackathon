import Link from "next/link";

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
          Fetch a structure by PDB ID (try <Code>6LU7</Code>) or upload your own{" "}
          <Code>.pdb</Code> in the Files panel.
        </Step>
        <Step n={2} title="Define the pocket">
          Drag across residues in the sequence strip, or ask the copilot to highlight a
          region — the selection becomes your docking box.
        </Step>
        <Step n={3} title="Add ligands & submit">
          Paste SMILES or drop an <Code>.sdf</Code>, pick a provider, and submit. Payment is
          held in on-chain escrow until the run is proven.
        </Step>
        <Step n={4} title="Read the results">
          Watch the candidate settle into the pocket as the job runs, then export the ranked
          gnina / CNN affinity scores as CSV.
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

      <p className="mt-8 text-xs text-muted">
        This is a demo environment — sign-in, balances and payments are mocked.
      </p>
    </main>
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
