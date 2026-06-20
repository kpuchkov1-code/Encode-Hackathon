import Link from "next/link";

const WORKLOADS = [
  "Molecular docking",
  "Protein folding",
  "Molecular dynamics",
  "Virtual screening",
];

// Two-sided marketplace entry: pick a side. Full-bleed looping video background.
export default function Home() {
  return (
    <main className="relative isolate overflow-hidden">
      {/* Background video */}
      <video
        className="absolute inset-0 -z-20 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/hero_loop.mp4" type="video/mp4" />
      </video>
      {/* Scrim for legibility */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/85 via-background/65 to-background/90" />

      <section className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] sm:text-5xl">
          The compute exchange for{" "}
          <span className="text-accent">molecular science</span>.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-foreground/75 drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)] sm:text-lg">
          Rent idle GPUs to run real molecular workloads. Settled on-chain, with
          cryptographic proof of execution.
        </p>

        {/* Workload breadth */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {WORKLOADS.map((w) => (
            <span
              key={w}
              className="rounded-full border border-border bg-surface/50 px-3 py-1 text-xs text-foreground/70 backdrop-blur"
            >
              {w}
            </span>
          ))}
        </div>

        {/* The two doors */}
        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2">
          <RoleCard href="/console" title="Pay for compute" primary />
          <RoleCard href="/sell" title="Rent out your hardware" />
        </div>

        {/* Live network stats */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-mono text-xs text-muted">
          <Stat value="128" label="GPUs online" />
          <Stat value="3,412" label="jobs run" />
          <Stat value="100%" label="proof-verified" />
        </div>
      </section>
    </main>
  );
}

function RoleCard({
  href,
  title,
  primary,
}: {
  href: string;
  title: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center justify-between rounded-2xl border p-6 text-left backdrop-blur-md transition-all ${
        primary
          ? "border-accent/50 bg-accent/10 hover:border-accent/80"
          : "border-border bg-surface/70 hover:border-accent/50 hover:bg-surface-2/80"
      }`}
    >
      <span className="text-2xl font-semibold tracking-tight">{title}</span>
      <span className="text-xl text-accent transition-transform group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm text-foreground">{value}</span>
      <span>{label}</span>
    </span>
  );
}
