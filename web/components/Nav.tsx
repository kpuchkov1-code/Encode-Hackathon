import Link from "next/link";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { AccountMenu } from "./AccountMenu";

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent/15 text-accent">
            <span className="h-3.5 w-3.5 rounded-sm bg-accent" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            DockMarket
            <span className="ml-2 hidden text-xs font-normal text-muted sm:inline">
              bio-compute marketplace
            </span>
          </span>
        </Link>

        {/* Side switching (Run / Provide) now lives in the account dropdown. */}
        <div className="flex items-center gap-4">
          <ConnectionIndicator />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
