// Small consistent label tying a UI panel to the sponsor tech it demonstrates.
// Judges look for real roles, not decoration — these sit on the panels that earn them.

const STYLES: Record<string, string> = {
  DeepBook: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  Walrus: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  gnina: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  Solvimon: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  Vercel: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
};

export function SponsorBadge({ name }: { name: keyof typeof STYLES | string }) {
  const cls = STYLES[name] ?? "border-border bg-surface-2 text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {name}
    </span>
  );
}
