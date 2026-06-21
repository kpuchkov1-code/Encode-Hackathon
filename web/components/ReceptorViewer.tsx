"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginContext } from "@/lib/molstar";

/*
  Mol* receptor viewer. Renders the ACTUAL receptor structure: either inline PDB text
  (e.g. an uploaded file, passed via `pdbText`) or a structure fetched from RCSB by `pdbId`.
  Nothing is hardcoded — what shows is whatever the caller passes.

  This uses the SAME Mol* engine as the console's StructureViewer (via lib/molstar.ts) for
  the publication-grade ribbon look — smooth cartoons, real secondary-structure assignment,
  ambient occlusion — instead of the lower-poly 3Dmol render. It stays self-contained and
  prop-driven (no shared selection store): the plugin is created once against its own canvas,
  and the structure is (re)loaded whenever the id/text changes. All Mol* access is behind a
  dynamic import() inside useEffect, so it never runs during SSR.
*/

type Status = "idle" | "loading" | "ready" | "error";

export function ReceptorViewer({
  pdbId = "",
  pdbText = null,
  label,
}: {
  /** PDB id to fetch from RCSB (used when no inline text is given). */
  pdbId?: string;
  /** Raw PDB text to render directly (e.g. an uploaded receptor). Takes precedence. */
  pdbText?: string | null;
  /** Header label override; defaults to the id, or "uploaded" for inline text. */
  label?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluginRef = useRef<PluginContext | null>(null);
  const [pluginReady, setPluginReady] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [spinning, setSpinning] = useState(false);

  const id = pdbId.trim().toUpperCase();
  const validId = !!id && id.length >= 4 && id !== "FAIL";
  const inline = !!pdbText && pdbText.trim().length > 0;
  const headerLabel = label || (inline ? "uploaded" : validId ? id : "—");

  // Create the Mol* plugin once, against this viewer's own canvas/container.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;

    (async () => {
      const mol = await import("@/lib/molstar");
      if (disposed) return;
      const plugin = await mol.createViewer(canvas, host);
      if (disposed) {
        plugin.dispose();
        return;
      }
      pluginRef.current = plugin;
      setPluginReady(true);
    })();

    return () => {
      disposed = true;
      try {
        pluginRef.current?.dispose();
      } catch {
        /* noop */
      }
      pluginRef.current = null;
      setPluginReady(false);
    };
  }, []);

  // (Re)load the structure whenever the id/text changes (or the plugin becomes ready).
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !pluginReady) return;

    if (!inline && !validId) {
      setStatus("idle");
      plugin.clear();
      return;
    }

    let cancelled = false;
    setSpinning(false);

    // Inline text renders immediately; an id fetch is debounced (typing a PDB id).
    const timer = setTimeout(
      async () => {
        setStatus("loading");
        try {
          let pdbData: string;
          if (inline) {
            pdbData = pdbText as string;
          } else {
            const fileRes = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
            if (!fileRes.ok) throw new Error(`PDB ${id} not found`);
            pdbData = await fileRes.text();
          }
          if (cancelled) return;

          const mol = await import("@/lib/molstar");
          if (cancelled) return;
          await mol.loadPdb(plugin, pdbData);
          if (!cancelled) setStatus("ready");
        } catch {
          if (!cancelled) setStatus("error");
        }
      },
      inline ? 0 : 400,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, validId, inline, pdbText, pluginReady]);

  const resetView = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const mol = await import("@/lib/molstar");
    mol.resetCamera(plugin);
  }, []);

  const toggleSpin = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const mol = await import("@/lib/molstar");
    setSpinning((on) => {
      mol.setSpin(plugin, !on);
      return !on;
    });
  }, []);

  return (
    <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-xl border border-border bg-background">
      {/* Header bar — AminoAnalytica-style viewer chrome */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            {inline ? "Receptor" : "PDB ID"}
          </span>
          <span className="font-mono text-sm text-foreground">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <CtrlButton label="Spin" active={spinning} disabled={status !== "ready"} onClick={toggleSpin}>
            <SpinIcon />
          </CtrlButton>
          <CtrlButton label="Reset view" disabled={status !== "ready"} onClick={resetView}>
            <ResetIcon />
          </CtrlButton>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative flex-1">
        <div ref={hostRef} className="absolute inset-0">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {status === "idle" && (
              <p className="font-mono text-xs text-muted">no receptor for this job</p>
            )}
            {status === "loading" && (
              <p className="font-mono text-xs text-accent">loading {headerLabel}…</p>
            )}
            {status === "error" && (
              <p className="font-mono text-xs text-amber-400">
                couldn’t load {inline ? "the receptor" : `${headerLabel} from RCSB`}
              </p>
            )}
          </div>
        )}
        {status === "ready" && (
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-muted">
            source: {inline ? "uploaded" : "RCSB"} · drag to rotate · scroll to zoom
          </div>
        )}
      </div>
    </div>
  );
}

function CtrlButton({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-md border text-muted transition-colors disabled:opacity-40 ${
        active
          ? "border-accent/50 bg-accent/15 text-accent-bright"
          : "border-border bg-surface-2 hover:border-accent/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ResetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="10" ry="4.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
