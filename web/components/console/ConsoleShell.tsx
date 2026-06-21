"use client";

/*
  The copilot console — a 3-pane workspace (files · chat · structure) modelled on Amina, with
  a far-left icon rail (new chat · sidebar · job history). Providers wrap the whole tree so
  every pane shares one source of truth; ConsoleBody lives inside them so the rail can reset
  the active job.
*/

import { useEffect, useState } from "react";
import { SelectionProvider } from "@/lib/selection";
import { StructureProvider } from "@/lib/structureStore";
import { FilesProvider } from "@/lib/files";
import { JobProvider, useJobDraft } from "@/lib/jobStore";
import { StructurePane } from "./StructurePane";
import { FilesPanel } from "./FilesPanel";
import { RunsPanel } from "./RunsPanel";
import { ChatPane } from "./ChatPane";
import { ConsoleRail } from "./ConsoleRail";

type LeftView = "files" | "history";

export function ConsoleShell() {
  // Lock document scroll: the console is a fixed, single-screen workspace.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      overflow: body.style.overflow,
      height: body.style.height,
      display: body.style.display,
      flexDirection: body.style.flexDirection,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.overflow;
      body.style.height = prev.height;
      body.style.display = prev.display;
      body.style.flexDirection = prev.flexDirection;
    };
  }, []);

  return (
    <SelectionProvider>
      <StructureProvider initialPdbId="6LU7">
        <FilesProvider>
          <JobProvider>
            <ConsoleBody />
          </JobProvider>
        </FilesProvider>
      </StructureProvider>
    </SelectionProvider>
  );
}

function ConsoleBody() {
  const job = useJobDraft();
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftView, setLeftView] = useState<LeftView>("files");
  const [structOpen, setStructOpen] = useState(true);
  // Remounting ChatPane (via key) is the cleanest full reset of its internal chat state.
  const [chatKey, setChatKey] = useState(0);

  const sidebarActive = leftOpen && leftView === "files";
  const historyActive = leftOpen && leftView === "history";

  function newChat() {
    setChatKey((k) => k + 1);
    job.setJobId(null);
    window.history.replaceState({}, "", window.location.pathname);
  }

  // Each rail button toggles its own view: click to open it, click again to close the pane.
  function selectLeft(view: LeftView) {
    if (leftOpen && leftView === view) {
      setLeftOpen(false);
    } else {
      setLeftView(view);
      setLeftOpen(true);
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <ConsoleRail
        onNewChat={newChat}
        sidebarActive={sidebarActive}
        onToggleSidebar={() => selectLeft("files")}
        historyActive={historyActive}
        onToggleHistory={() => selectLeft("history")}
      />

      {/* Left content pane — Files or Job history, chosen from the rail. */}
      {leftOpen && (
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
              {leftView === "files" ? "Files" : "Job history"}
            </span>
            <button
              type="button"
              onClick={() => setLeftOpen(false)}
              title="Hide"
              className="grid h-6 w-6 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              ‹
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {leftView === "files" ? <FilesPanel /> : <RunsPanel />}
          </div>
        </aside>
      )}

      {/* Center — chat */}
      <section className="flex min-w-0 flex-1 flex-col border-x border-border bg-background">
        <ChatPane
          key={chatKey}
          filesOpen={sidebarActive}
          onToggleFiles={() => selectLeft("files")}
        />
      </section>

      {/* Right — structure */}
      {structOpen ? (
        <aside className="flex w-[clamp(360px,34vw,560px)] shrink-0 flex-col bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
              Structure
            </span>
            <button
              type="button"
              onClick={() => setStructOpen(false)}
              title="Hide Structure"
              className="grid h-6 w-6 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              ›
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-3">
            <StructurePane />
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={() => setStructOpen(true)}
          title="Show Structure"
          className="flex w-9 shrink-0 items-center justify-center bg-surface text-muted transition-colors hover:text-foreground"
        >
          <span className="rotate-180 font-mono text-[10px] uppercase tracking-widest [writing-mode:vertical-rl]">
            Structure
          </span>
        </button>
      )}
    </div>
  );
}
