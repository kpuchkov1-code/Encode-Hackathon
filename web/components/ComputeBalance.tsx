"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account";

// Compute-credit balance shown in the nav. Reflects the shared account state, so it updates
// the instant you sign in/out from the account menu. Links to settings (where top-up lives).
export function ComputeBalance() {
  const { user, ready } = useAccount();

  // Reserve width pre-hydration to avoid layout shift.
  if (!ready) return <div className="h-8 w-24" aria-hidden="true" />;

  // Always shown — reads 0 when signed out so the balance is visible across the app.
  const credits = user?.credits ?? 0;

  return (
    <Link
      href="/settings"
      title="Compute balance"
      className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-accent/50"
    >
      <BoltIcon />
      <span className="font-mono text-sm text-accent-bright">
        {credits.toLocaleString()}
      </span>
      <span className="hidden text-xs text-muted sm:inline">credits</span>
    </Link>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-accent">
      <path
        d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}
