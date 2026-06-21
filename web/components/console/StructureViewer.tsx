"use client";

/*
  Selection-aware Mol* viewer. Mol* (the engine behind RCSB/PDBe) renders publication-grade
  cartoons — smooth ribbons, real secondary-structure assignment, ambient occlusion + outlines
  — replacing the lower-poly 3Dmol render.

  Interaction is unchanged from the user's point of view: click a residue in 3D OR the
  sequence strip and it turns orange. Clicks in 3D toggle the shared selection store; the store
  (also driven by the sequence strip + chat) is mirrored back into Mol* as the orange marking.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { useSelection } from "@/lib/selection";
import { useStructure } from "@/lib/structureStore";
import type { PluginContext } from "@/lib/molstar";

export function StructureViewer() {
  const { text, status, pdbId, source } = useStructure();
  const { selected, toggle, clear, summary } = useSelection();

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluginRef = useRef<PluginContext | null>(null);
  const [pluginReady, setPluginReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [spinning, setSpinning] = useState(false);

  // Keep the latest toggle in a ref so the click handler (bound once) stays current.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  // Create the Mol* plugin once, against the canvas/container.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;
    let sub: { unsubscribe: () => void } | null = null;

    (async () => {
      const mol = await import("@/lib/molstar");
      if (disposed) return;
      const plugin = await mol.createViewer(canvas, host);
      if (disposed) {
        plugin.dispose();
        return;
      }
      pluginRef.current = plugin;

      // Click an atom -> toggle that residue in the shared selection store.
      sub = plugin.behaviors.interaction.click.subscribe((e) => {
        const key = mol.residueKeyFromLoci(e?.current?.loci);
        if (key) toggleRef.current(key);
      });

      setPluginReady(true);
    })();

    return () => {
      disposed = true;
      sub?.unsubscribe();
      try {
        pluginRef.current?.dispose();
      } catch {
        /* noop */
      }
      pluginRef.current = null;
      setPluginReady(false);
    };
  }, []);

  // (Re)load the structure whenever the coordinate text changes.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !pluginReady) return;
    let cancelled = false;
    setLoaded(false);
    setSpinning(false);

    (async () => {
      const mol = await import("@/lib/molstar");
      if (!text) {
        await plugin.clear();
        return;
      }
      try {
        await mol.loadPdb(plugin, text);
        if (!cancelled) setLoaded(true);
      } catch {
        /* the store already surfaces load errors */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, pluginReady]);

  // Mirror the shared selection into Mol* as the orange marking.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !loaded) return;
    let cancelled = false;
    (async () => {
      const mol = await import("@/lib/molstar");
      if (!cancelled) mol.markResidues(plugin, selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, loaded]);

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
    <div className="flex h-full min-h-[280px] flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            PDB ID
          </span>
          <span className="font-mono text-sm text-foreground">{pdbId || "—"}</span>
        </div>
        <div className="flex items-center gap-1">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clear}
              className="rounded-md border border-select/40 bg-select/10 px-2 py-1 font-mono text-[10px] text-select-bright transition-colors hover:bg-select/20"
            >
              clear {selected.size}
            </button>
          )}
          <CtrlButton label="Spin" active={spinning} disabled={!loaded} onClick={toggleSpin}>
            <SpinIcon />
          </CtrlButton>
          <CtrlButton label="Reset view" disabled={!loaded} onClick={resetView}>
            <ResetIcon />
          </CtrlButton>
        </div>
      </div>

      <div className="relative flex-1">
        <div ref={hostRef} className="absolute inset-0">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {status === "idle" && (
              <p className="font-mono text-xs text-muted">enter a PDB ID to load a receptor</p>
            )}
            {status === "loading" && (
              <p className="font-mono text-xs text-accent">loading {pdbId}…</p>
            )}
            {status === "error" && (
              <p className="font-mono text-xs text-amber-400">couldn&rsquo;t load {pdbId} from RCSB</p>
            )}
          </div>
        )}
        {loaded && (
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-muted">
            source: {source} · click residues to select · scroll to zoom
          </div>
        )}
        {loaded && summary && (
          <div className="absolute right-2 top-2 max-w-[60%] truncate rounded-md border border-select/40 bg-select/10 px-2 py-1 text-right font-mono text-[10px] text-select-bright">
            {summary}
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
