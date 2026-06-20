"use client";

/*
  Returns a STABLE function identity that always calls the latest version of `fn`. Lets us
  hand a callback to non-React code (the chat transport) without it capturing stale store
  values, and without re-subscribing on every render.
*/

import { useCallback, useRef } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCallbackRef<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(((...args) => ref.current(...args)) as T, []);
}
