import HoverFramesRoleCard from "@/components/HoverFramesRoleCard";

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

      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] sm:text-6xl lg:text-7xl">
          The compute exchange for{" "}
          <span className="text-accent">molecular science</span>.
        </h1>

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
          <HoverFramesRoleCard
            href="/console"
            title="Pay for compute"
            frames={["/dna-a.jpg", "/dna-b.jpg"]}
            frameClassName="h-10 w-[3.5rem]"
            primary
          />
          <HoverFramesRoleCard
            href="/sell"
            title="Rent out your hardware"
            frames={["/pc-a.png", "/pc-b.png"]}
            frameClassName="h-11 w-11"
          />
        </div>
      </section>
    </main>
  );
}
