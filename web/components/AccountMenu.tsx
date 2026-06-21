"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { createResearcher, ApiError } from "@/lib/api";
import { useResearcher } from "@/lib/researcher-identity";

// Top-right account menu. The researcher's IDENTITY is their email (sign-up/sign-in by email,
// the same key used for "My jobs" and submissions). Paying for a job is separate: that's
// signed by a connected Sui wallet at pay time, shown here as a connect/disconnect row.

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function AccountMenu() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const { identity, signIn, signOut } = useResearcher();
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? "";
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function logout() {
    signOut();
    disconnect();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-accent/50"
      >
        {identity ? (
          <>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
              {identity.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-[160px] truncate font-mono text-xs text-foreground sm:inline">
              {identity.email}
            </span>
          </>
        ) : (
          <span className="text-sm text-foreground">Account</span>
        )}
        <Chevron />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
          {/* Marketplace side switcher — available signed in or not. */}
          <div className="border-b border-border p-1.5">
            <SideItem
              href="/console"
              active={isActive("/console")}
              label="Run"
              sub="Submit docking jobs"
              onClick={() => setOpen(false)}
            />
            <SideItem
              href="/sell"
              active={isActive("/sell")}
              label="Provide"
              sub="Rent out your GPUs"
              onClick={() => setOpen(false)}
            />
          </div>

          {identity ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="text-xs text-muted">Signed in as</div>
                <div className="mt-0.5 truncate font-mono text-xs text-accent-bright">
                  {identity.email}
                </div>
              </div>

              {/* Wallet for paying — separate from the email account. */}
              <div className="border-b border-border px-4 py-3">
                <div className="text-xs text-muted">Payment wallet (testnet)</div>
                {account ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">
                      {shortAddr(account.address)}
                    </span>
                    <button
                      type="button"
                      onClick={() => disconnect()}
                      className="shrink-0 text-[11px] text-muted hover:text-red-300"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <ConnectModal
                    trigger={
                      <button
                        type="button"
                        className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-accent/50"
                      >
                        <WalletIcon /> Connect wallet to pay
                      </button>
                    }
                    open={connectOpen}
                    onOpenChange={setConnectOpen}
                  />
                )}
              </div>

              <MenuLink href="/jobs" onClick={() => setOpen(false)}>
                My jobs
              </MenuLink>
              <MenuLink href="/settings" onClick={() => setOpen(false)}>
                Settings
              </MenuLink>
              <button
                type="button"
                onClick={logout}
                className="block w-full px-4 py-2.5 text-left text-sm text-red-300 transition-colors hover:bg-surface-2"
              >
                Sign out
              </button>
            </>
          ) : (
            <SignInForm onSignedIn={signIn} />
          )}
        </div>
      )}
    </div>
  );
}

function SignInForm({
  onSignedIn,
}: {
  onSignedIn: (id: { researcher_id: string; email: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/.+@.+\..+/.test(email.trim())) {
      setErr("Enter a valid email.");
      return;
    }
    setBusy(true);
    try {
      onSignedIn(await createResearcher(email.trim()));
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="p-3">
      <div className="px-1 pb-2 text-xs text-muted">
        Sign in or sign up with your email — it&rsquo;s your account. Connect a wallet when you
        pay.
      </div>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@lab.bio"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
      />
      {err && <p className="mt-1.5 px-1 text-xs text-red-400">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-2 flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}

function SideItem({
  href,
  active,
  label,
  sub,
  onClick,
}: {
  href: string;
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
        active ? "bg-accent/15" : "hover:bg-surface-2"
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block text-sm font-medium ${
            active ? "text-accent-bright" : "text-foreground"
          }`}
        >
          {label}
        </span>
        <span className="block text-[11px] text-muted">{sub}</span>
      </span>
      {active && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
    </Link>
  );
}

function MenuLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-muted">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 12h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
