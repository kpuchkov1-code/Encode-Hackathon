import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { ComputeBalance } from "./ComputeBalance";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent/15 text-accent">
            <span className="h-3.5 w-3.5 rounded-sm bg-accent" />
          </span>
          <span className="text-lg font-semibold tracking-tight">DockMarket</span>
        </Link>

        {/* Side switching (Run / Provide) now lives in the account dropdown. */}
        <div className="flex items-center gap-3">
          <Link
            href="/docs"
            title="Getting started"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground transition-colors hover:border-accent/50"
          >
            <BookIcon />
            <span className="hidden sm:inline">Docs</span>
          </Link>
          <ComputeBalance />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-muted">
      <path
        d="M4 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v15l-4-2-4 2-4-2V5z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 7h6M8 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
