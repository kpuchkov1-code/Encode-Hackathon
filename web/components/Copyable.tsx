"use client";

import { useState } from "react";

// Monospace value with a copy affordance — used for hashes, ids, blob ids.
export function Copyable({
  value,
  label,
  truncate = false,
  className = "",
}: {
  value: string;
  label?: string;
  truncate?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  };

  const shown = truncate && value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className={`group inline-flex items-center gap-1.5 font-mono text-xs text-foreground/90 transition-colors hover:text-accent ${className}`}
    >
      {label && <span className="text-muted">{label}</span>}
      <span className="break-all">{shown}</span>
      <span className="text-[10px] text-muted group-hover:text-accent">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
