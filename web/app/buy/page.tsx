import Link from "next/link";
import { SponsorBadge } from "@/components/SponsorBadge";

const CARDS = [
  {
    title: "Run the sample screen",
    subtitle: "Aspirin vs decoy (SARS Mpro) — load and submit",
    href: "/submit?preset=sample",
  },
  {
    title: "Submit your own job",
    subtitle: "Pick a receptor PDB ID, upload a ligand SDF, choose a GPU supplier",
    href: "/submit",
  },
  {
    title: "Inspect a proof",
    subtitle: "See the SHA-256 manifest that proves your molecule ran unaltered",
    href: "/jobs",
  },
  {
    title: "Trigger a failure",
    subtitle: "Watch graceful failure + on-chain escrow refund (FAIL receptor)",
    href: "/submit?preset=fail",
  },
];

export default function BuyHome() {
  return (
    <main className="bg-grid-glow">
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 sm:pt-24">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link href="/" className="text-xs text-muted hover:text-foreground">
            ← marketplace
          </Link>
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
            For buyers · run bio-compute jobs
          </span>
        </div>
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Dock millions of molecules on the world&rsquo;s{" "}
          <span className="text-accent">idle GPUs</span>.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          A 100k-compound screen costs ~$50k on the cloud. Submit it here instead: idle
          GPUs run real <span className="text-foreground">molecular docking</span>, payment
          settles on-chain on Sui, and every result carries a cryptographic proof that your
          unpublished molecule was processed and never altered.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/submit?preset=sample"
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
          >
            Run the sample screen →
          </Link>
          <Link
            href="/submit"
            className="rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-accent/50"
          >
            Submit a custom job
          </Link>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              className="group flex flex-col gap-1 rounded-xl border border-border bg-surface px-5 py-4 transition-all hover:border-accent/50 hover:bg-surface-2"
            >
              <span className="font-medium text-foreground">{c.title}</span>
              <span className="text-sm text-muted">{c.subtitle}</span>
            </Link>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-6 text-sm text-muted">
          <span>Powered by</span>
          <span className="flex items-center gap-2">
            <SponsorBadge name="Sui" /> blockchain
          </span>
          <span className="flex items-center gap-2">
            <SponsorBadge name="DeepBook" /> on-chain escrow
          </span>
          <span className="flex items-center gap-2">
            <SponsorBadge name="Walrus" /> proof storage
          </span>
          <span className="flex items-center gap-2">
            <SponsorBadge name="Vercel" /> hosting
          </span>
        </div>
      </section>
    </main>
  );
}
