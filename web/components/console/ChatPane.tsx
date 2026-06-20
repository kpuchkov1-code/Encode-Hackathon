"use client";

/*
  Center pane — the copilot chat. Phase 1: presentational shell (greeting, suggestion
  cards, input bar with Files/Tools/Web toggles). The tool-calling agent loop is wired
  into this component in Phase 2.
*/

import { useState } from "react";

const SUGGESTIONS = [
  { title: "Load & clean a structure", body: "Fetch 6LU7 and strip waters + ligands" },
  { title: "Select a pocket", body: "Click residues in the viewer to define where to dock" },
  { title: "Run a docking screen", body: "Dock aspirin vs a decoy and watch it settle" },
  { title: "Explain the results", body: "What does CNN affinity mean for my binder?" },
];

export function ChatPane() {
  const [web, setWeb] = useState(false);
  const [tools, setTools] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Thread */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="flex gap-3">
            <Avatar />
            <div className="rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
              <p className="font-medium text-foreground">
                Copilot ready. I can fetch and clean structures, define a docking pocket from
                residues you pick, run a screen on idle GPUs, and explain the results.
              </p>
              <p className="mt-2 text-muted">
                Load a receptor on the right, or tell me what you want to dock.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <div
                key={s.title}
                className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">{s.title}</span>
                <span className="text-xs text-muted">{s.body}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2">
            <textarea
              rows={1}
              placeholder="Message the copilot…"
              className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="button"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-bright"
              title="Send"
            >
              ↑
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Toggle active label="Files" />
            <Toggle active={tools} onClick={() => setTools((v) => !v)} label="Tools" />
            <Toggle active={web} onClick={() => setWeb((v) => !v)} label="🌐 Web Search" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent/50 bg-accent/15 text-accent-bright"
          : "border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Avatar() {
  return (
    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
      <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
    </span>
  );
}
