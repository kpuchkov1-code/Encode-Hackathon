"use client";

import type { ReactNode } from "react";

// AminoAnalytica-style affordance: dark card, title + muted subtitle.
export function SuggestionCard({
  title,
  subtitle,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col gap-1 rounded-xl border border-border bg-surface px-5 py-4 text-left transition-all hover:border-accent/50 hover:bg-surface-2"
    >
      <span className="flex items-center gap-2 font-medium text-foreground">
        {icon}
        {title}
      </span>
      <span className="text-sm text-muted">{subtitle}</span>
    </button>
  );
}
