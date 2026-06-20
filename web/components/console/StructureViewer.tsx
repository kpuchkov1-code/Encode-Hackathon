"use client";

/*
  Selection-aware 3Dmol viewer. Loads the structure from the shared structure store and
  lets the user CLICK residues to select them — selected residues turn orange (the Amina
  interaction). Selection lives in the shared store, so the sequence strip and job panel
  react to the same clicks.

  Base cartoon is blue; selected residues are restyled orange + sticks on each selection
  change. Zoom is clamped so you can't fly through or lose the molecule.
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { useSelection } from "@/lib/selection";
import { useStructure } from "@/lib/structureStore";

const ZOOM_MIN = 40;
const ZOOM_MAX = 500;
const BASE_COLOR = "#3b82f6";
const SELECT_COLOR = "#f59e0b";

export function StructureViewer() {
  const { text, status, pdbId, source } = useStructure();
  const { selected, toggle, clear, summary } = useSelection();

  const hostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const homeViewRef = useRef<number[] | null>(null);
  const [ready, setReady] = useState(false);
  const [spinning, setSpinning] = useState(false);

  // Keep the latest toggle in a ref so the click handler (bound once at load) stays current.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  // (Re)build the viewer whenever the structure text changes.
  useEffect(() => {
    if (!text) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    setSpinning(false);

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const $3Dmol: any = await import("3dmol");
      if (cancelled) return;

      host.replaceChildren();
      const viewer = $3Dmol.createViewer(host, {
        backgroundColor: "#0a0a0b",
        antialias: true,
        upscale: true,
        ambientOcclusion: { strength: 0.45, radius: 5 },
      });
      viewerRef.current = viewer;

      viewer.addModel(text, "pdb");
      viewer.setStyle({}, { cartoon: { color: BASE_COLOR, arrows: true } });

      // Click an atom -> toggle that residue in the shared selection store.
      viewer.setClickable({}, true, (atom: { chain?: string; resi?: number }) => {
        if (atom?.resi == null) return;
        const chain = atom.chain || "A";
        toggleRef.current(`${chain}:${atom.resi}`);
      });

      viewer.zoomTo();
      viewer.zoom(1.15, 0);
      viewer.render();
      viewer.setZoomLimits(ZOOM_MIN, ZOOM_MAX);
      homeViewRef.current = viewer.getView();
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      try {
        viewerRef.current?.clear?.();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, [text]);

  // Restyle on selection change: reset to blue, overlay selected residues in orange.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready) return;
    v.setStyle({}, { cartoon: { color: BASE_COLOR, arrows: true } });

    if (selected.size > 0) {
      const byChain: Record<string, number[]> = {};
      for (const key of selected) {
        const [chain, resiStr] = key.split(":");
        const resi = Number(resiStr);
        if (Number.isNaN(resi)) continue;
        (byChain[chain] ??= []).push(resi);
      }
      for (const chain of Object.keys(byChain)) {
        v.addStyle(
          { chain, resi: byChain[chain] },
          { cartoon: { color: SELECT_COLOR }, stick: { color: SELECT_COLOR, radius: 0.2 } },
        );
      }
    }
    v.render();
  }, [selected, ready]);

  const resetView = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (homeViewRef.current) v.setView(homeViewRef.current);
    else v.zoomTo();
    v.render();
  }, []);

  const toggleSpin = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    setSpinning((on) => {
      v.spin(on ? false : "y");
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
          <span className="font-mono text-sm text-foreground">
            {pdbId || "—"}
          </span>
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
          <CtrlButton label="Spin" active={spinning} disabled={!ready} onClick={toggleSpin}>
            <SpinIcon />
          </CtrlButton>
          <CtrlButton label="Reset view" disabled={!ready} onClick={resetView}>
            <ResetIcon />
          </CtrlButton>
        </div>
      </div>

      <div className="relative flex-1">
        <div ref={hostRef} className="absolute inset-0" />
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
        {ready && (
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-muted">
            source: {source} · click residues to select · scroll to zoom
          </div>
        )}
        {ready && summary && (
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
