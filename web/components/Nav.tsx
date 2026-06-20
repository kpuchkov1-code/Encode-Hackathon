import Link from "next/link";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { AccountMenu } from "./AccountMenu";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded bg-accent/15 text-accent">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
          </span>
          <span className="font-semibold tracking-tight">
            DockMarket
            <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">
              bio-compute marketplace
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-5">
          <nav className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-sm">
            <Link
              href="/buy"
              className="rounded-md px-3 py-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Buy
            </Link>
            <Link
              href="/sell"
              className="rounded-md px-3 py-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Sell
            </Link>
          </nav>
          <ConnectionIndicator />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
