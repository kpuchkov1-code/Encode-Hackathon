"use client";

/*
  Persists the provider's issued identity (worker_id + token + the daemon run command) in
  localStorage so the /sell dashboard remembers who you are across reloads. The token is
  shown once at registration and needed to run the daemon — we keep it client-side only,
  the same trust model as the original server page (the backend never re-emits it).
*/

import { useCallback, useEffect, useState } from "react";
import type { ProviderIdentity } from "./api";

const KEY = "dm_provider";

export function useProviderIdentity() {
  const [identity, setIdentityState] = useState<ProviderIdentity | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setIdentityState(JSON.parse(raw));
    } catch {
      /* ignore malformed */
    }
    setReady(true);
  }, []);

  const setIdentity = useCallback((id: ProviderIdentity) => {
    setIdentityState(id);
    try {
      localStorage.setItem(KEY, JSON.stringify(id));
    } catch {
      /* ignore */
    }
  }, []);

  const clear = useCallback(() => {
    setIdentityState(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { identity, ready, setIdentity, clear };
}
