"use client";

/*
  The copilot console — a 3-pane workspace (files · chat · structure) modelled on Amina.
  Side panes collapse; on narrow screens the panes stack. Providers for selection and the
  loaded structure wrap the whole tree so every pane shares one source of truth.
*/

import { useState } from "react";
import { SelectionProvider } from "@/lib/selection";
import { StructureProvider } from "@/lib/structureStore";
import { FilesProvider } from "@/lib/files";
import { StructurePane } from "./StructurePane";
import { FilesPanel } from "./FilesPanel";
import { ChatPane } from "./ChatPane";

export function ConsoleShell() {
  const [filesOpen, setFilesOpen] = useState(true);
  const [structOpen, setStructOpen] = useState(true);

  return (
    <SelectionProvider>
      <StructureProvider initialPdbId="6LU7">
        <FilesProvider>
        <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
          {/* Left — files */}
          <SidePane
            open={filesOpen}
            side="left"
            label="Files"
            onToggle={() => setFilesOpen((v) => !v)}
            widthClass="w-72"
          >
            <FilesPanel />
          </SidePane>

          {/* Center — chat */}
          <section className="flex min-w-0 flex-1 flex-col border-x border-border bg-background">
            <ChatPane />
          </section>

          {/* Right — structure */}
          <SidePane
            open={structOpen}
            side="right"
            label="Structure"
            onToggle={() => setStructOpen((v) => !v)}
            widthClass="w-[clamp(360px,34vw,560px)]"
          >
            <div className="h-full p-3">
              <StructurePane />
            </div>
          </SidePane>
        </div>
        </FilesProvider>
      </StructureProvider>
    </SelectionProvider>
  );
}

function SidePane({
  open,
  side,
  label,
  widthClass,
  onToggle,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  label: string;
  widthClass: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={`Show ${label}`}
        className="flex w-9 shrink-0 items-center justify-center bg-surface text-muted transition-colors hover:text-foreground"
      >
        <span className="rotate-180 font-mono text-[10px] uppercase tracking-widest [writing-mode:vertical-rl]">
          {label}
        </span>
      </button>
    );
  }
  return (
    <aside className={`${widthClass} flex shrink-0 flex-col bg-surface`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {label}
        </span>
        <button
          type="button"
          onClick={onToggle}
          title={`Hide ${label}`}
          className="grid h-6 w-6 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {side === "left" ? "‹" : "›"}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}
