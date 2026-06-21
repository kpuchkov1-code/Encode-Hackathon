"use client";

/*
  Far-left icon rail for the console — always visible. Three actions:
    • New chat     — reset the conversation and clear the active job
    • Sidebar      — toggle the Files pane (open/close)
    • Job history  — toggle the run-history pane (open/close)
  The rail owns no state; ConsoleBody passes handlers + active flags.
*/

export function ConsoleRail({
  onNewChat,
  sidebarActive,
  onToggleSidebar,
  historyActive,
  onToggleHistory,
}: {
  onNewChat: () => void;
  sidebarActive: boolean;
  onToggleSidebar: () => void;
  historyActive: boolean;
  onToggleHistory: () => void;
}) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-surface py-3">
      <RailButton label="New chat" onClick={onNewChat}>
        <ComposeIcon />
      </RailButton>

      <div className="my-1 h-px w-5 bg-border" />

      <RailButton label="Files" active={sidebarActive} onClick={onToggleSidebar}>
        <SidebarIcon />
      </RailButton>
      <RailButton label="Job history" active={historyActive} onClick={onToggleHistory}>
        <HistoryIcon />
      </RailButton>
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-9 w-9 place-items-center rounded-lg border transition-colors ${
        active
          ? "border-accent/50 bg-accent/15 text-accent-bright"
          : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ComposeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 1 0 2.2-5.9M3 4v3h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 8v4l2.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
