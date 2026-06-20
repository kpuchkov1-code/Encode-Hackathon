"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Mock auth for the demo: persisted in localStorage, no backend. Provides the top-right
// sign-in + account/settings/wallet menu.

type User = { name: string; email: string; initial: string; credits: number };

const DEMO_USER: User = {
  name: "Demo Lab",
  email: "demo@lab.bio",
  initial: "D",
  credits: 1240,
};

const STORAGE_KEY = "dm_user";

export function AccountMenu() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function signIn() {
    setUser(DEMO_USER);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_USER));
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  function signOut() {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  // Render a stable placeholder until mounted to avoid hydration mismatch.
  if (!mounted) {
    return <div className="h-8 w-20" aria-hidden="true" />;
  }

  return (
    <div ref={ref} className="relative">
      {user ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1 transition-colors hover:border-accent/50"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-semibold text-white">
            {user.initial}
          </span>
          <span className="hidden text-sm text-foreground sm:inline">{user.name}</span>
          <Chevron />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-bright"
        >
          Sign in
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/40">
          {user ? (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-medium text-foreground">{user.name}</div>
                <div className="font-mono text-xs text-muted">{user.email}</div>
              </div>
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-xs text-muted">Wallet</span>
                <span className="font-mono text-sm text-accent-bright">
                  {user.credits.toLocaleString()} credits
                </span>
              </div>
              <MenuLink href="/sell" onClick={() => setOpen(false)}>
                Provider dashboard
              </MenuLink>
              <MenuLink href="/settings" onClick={() => setOpen(false)}>
                Settings
              </MenuLink>
              <button
                type="button"
                onClick={signOut}
                className="block w-full px-4 py-2.5 text-left text-sm text-red-300 transition-colors hover:bg-surface-2"
              >
                Sign out
              </button>
            </>
          ) : (
            <div className="p-2">
              <button
                type="button"
                onClick={signIn}
                className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-2"
              >
                <WalletIcon /> Connect wallet
              </button>
              <button
                type="button"
                onClick={signIn}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-2"
              >
                <MailIcon /> Continue with email
              </button>
              <p className="px-3 pb-1 pt-2 text-[10px] text-muted">Demo sign-in — no real auth.</p>
            </div>
          )}
        </div>
      )}
    </div>
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-muted">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 12h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="text-muted">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
