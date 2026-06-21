"use client";

/*
  Researcher account identity — email-based sign-up/sign-in, persisted in localStorage so the
  account survives reloads. The email is the identity used to own jobs ("My jobs") and to
  attribute submissions. Paying for a job is separate: that's signed by a connected Sui wallet
  at pay time. A context is used so the nav menu and every consumer stay in sync within a tab.
*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ResearcherIdentity } from "./api";

const KEY = "dm_researcher";

type Value = {
  identity: ResearcherIdentity | null;
  ready: boolean;
  signIn: (id: ResearcherIdentity) => void;
  signOut: () => void;
};

const Ctx = createContext<Value | null>(null);

export function ResearcherProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<ResearcherIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setIdentity(JSON.parse(raw));
    } catch {
      /* ignore malformed */
    }
    setReady(true);
  }, []);

  const signIn = useCallback((id: ResearcherIdentity) => {
    setIdentity(id);
    try {
      localStorage.setItem(KEY, JSON.stringify(id));
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(() => {
    setIdentity(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ identity, ready, signIn, signOut }),
    [identity, ready, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useResearcher(): Value {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useResearcher must be used within a ResearcherProvider");
  return ctx;
}
