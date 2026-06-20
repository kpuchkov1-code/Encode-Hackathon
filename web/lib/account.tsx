"use client";

/*
  Mock account state for the demo — a single source of truth shared by the account menu and
  the nav's compute-balance chip. Persisted in localStorage (no real auth). A context is used
  (rather than each component reading localStorage) because same-tab writes don't emit a
  `storage` event, so sibling components would otherwise drift out of sync until a reload.
*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Account = {
  name: string;
  email: string;
  initial: string;
  credits: number;
};

export const DEMO_ACCOUNT: Account = {
  name: "Demo Lab",
  email: "demo@lab.bio",
  initial: "D",
  credits: 1240,
};

const STORAGE_KEY = "dm_user";

type AccountContextValue = {
  /** The signed-in account, or null when signed out. */
  user: Account | null;
  /** False until the initial localStorage read completes (avoids hydration mismatch). */
  ready: boolean;
  signIn: () => void;
  signOut: () => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore malformed storage */
    }
    setReady(true);
  }, []);

  const signIn = useCallback(() => {
    setUser(DEMO_ACCOUNT);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEMO_ACCOUNT));
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, signIn, signOut }),
    [user, ready, signIn, signOut],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within an AccountProvider");
  return ctx;
}
