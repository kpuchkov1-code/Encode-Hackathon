import HoverFramesRoleCard from "@/components/HoverFramesRoleCard";

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
      {/* Scrim for legibility — kept light so the video colour stays vivid */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background/55 via-background/25 to-background/60" />

      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight drop-shadow-[0_2px_20px_rgba(0,0,0,0.6)] sm:text-6xl lg:text-7xl">
          The compute exchange for{" "}
          <span className="text-orange-400">biomolecular science</span>
        </h1>

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
