"use client";

import { useHealth } from "@/lib/hooks";

// Live backend health dot in the nav. Green = backend reachable via the proxy.
export function ConnectionIndicator() {
  const { ok, offline } = useHealth();
  const color = ok ? "bg-green-500" : offline ? "bg-red-500" : "bg-amber-500";
  const label = ok ? "backend online" : offline ? "backend offline" : "connecting";

  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${color} ${ok ? "" : "animate-pulse"}`} />
      <span className="font-mono">{label}</span>
    </span>
  );
}
