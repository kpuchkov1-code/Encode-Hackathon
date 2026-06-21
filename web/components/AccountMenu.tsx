"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";

// Top-right wallet menu. Identity is the connected Sui wallet (dapp-kit) — the same wallet
// that signs the escrow lock — so "who am I" is consistent across submit, my jobs and pay.
// Replaces the old mocked localStorage sign-in.

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function AccountMenu() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 transition-colors hover:border-accent/50"
      >
        {account ? (
          <>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
              <WalletIcon />
            </span>
            <span className="hidden font-mono text-xs text-foreground sm:inline">
              {shortAddr(account.address)}
            </span>
          </>
        ) : (
          <span className="text-sm text-foreground">Account</span>
        )}
        <Chevron />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
          {/* Marketplace side switcher — available connected or not. */}
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

          {account ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="text-xs text-muted">Connected wallet (testnet)</div>
                <div className="mt-0.5 font-mono text-xs text-accent-bright">
                  {shortAddr(account.address)}
                </div>
              </div>
              <MenuLink href="/jobs" onClick={() => setOpen(false)}>
                My jobs
              </MenuLink>
              <MenuLink href="/settings" onClick={() => setOpen(false)}>
                Settings
              </MenuLink>
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-red-300 transition-colors hover:bg-surface-2"
              >
                Disconnect
              </button>
            </>
          ) : (
            <div className="p-2">
              <ConnectModal
                trigger={
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-left text-sm font-medium text-white transition-colors hover:bg-accent-bright"
                  >
                    <WalletIcon /> Connect Sui wallet
                  </button>
                }
                open={connectOpen}
                onOpenChange={(o) => {
                  setConnectOpen(o);
                  if (o) setOpen(false);
                }}
              />
              <p className="px-3 pb-1 pt-2 text-[10px] text-muted">
                Slush / Sui Wallet / Suiet — set to testnet. Your wallet is your identity and
                signs the escrow lock.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
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
