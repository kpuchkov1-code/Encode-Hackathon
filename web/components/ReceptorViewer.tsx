"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
  3Dmol.js receptor viewer. Loads a structure straight from RCSB by PDB ID — fully
  client-side, no backend dependency.

  Quality: antialias + upscale (2x render) + oval cartoon cross-sections give the smooth,
  glossy ribbon look (vs the default jagged rectangles). Zoom is clamped with
  setZoomLimits so you can't fly through the molecule or lose it in the distance.

  All 3Dmol access is inside useEffect with a dynamic import, so it never runs during SSR.
*/

type Status = "idle" | "loading" | "ready" | "error";

// Camera-distance clamps for zoom (tuned for typical protein sizes; lower = closer).
const ZOOM_MIN = 40;
const ZOOM_MAX = 500;

export function ReceptorViewer({ pdbId }: { pdbId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const homeViewRef = useRef<number[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [spinning, setSpinning] = useState(false);

  const id = pdbId.trim().toUpperCase();
  const validId = !!id && id.length >= 4 && id !== "FAIL";

  useEffect(() => {
    if (!validId) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setSpinning(false);

    // Debounce so typing a PDB ID doesn't fetch per keystroke.
    const timer = setTimeout(async () => {
      const host = hostRef.current;
      if (!host) return;
      setStatus("loading");

      try {
        const fileRes = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
        if (!fileRes.ok) throw new Error(`PDB ${id} not found`);
        const pdbData = await fileRes.text();
        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const $3Dmol: any = await import("3dmol");
        if (cancelled) return;

        host.replaceChildren(); // avoid stacking canvases on re-run
        const viewer = $3Dmol.createViewer(host, {
          backgroundColor: "#0a0a0b",
          antialias: true, // smooth edges
          upscale: true, // render at 2x then downsample — kills the jaggies
          disableFog: false,
          ambientOcclusion: { strength: 0.45, radius: 5 }, // soft contact shadows = depth
        });
        viewerRef.current = viewer;

        viewer.addModel(pdbData, "pdb");
        // Default cartoon: flat ribbons for helices, arrowed sheets — the proper
        // secondary-structure look. (Overriding style/thickness turned it into tubes.)
        viewer.setStyle({}, { cartoon: { color: "#3b82f6", arrows: true } });
        viewer.zoomTo();
        viewer.zoom(1.15, 0);
        viewer.render();
        // Clamp zoom after the initial fit so limits are relative to a sensible frame.
        viewer.setZoomLimits(ZOOM_MIN, ZOOM_MAX);
        homeViewRef.current = viewer.getView();
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        viewerRef.current?.clear?.();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
  }, [id, validId]);

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
    <div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-xl border border-border bg-background">
      {/* Header bar — AminoAnalytica-style viewer chrome */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            PDB ID
          </span>
          <span className="font-mono text-sm text-foreground">
            {validId ? id : "—"}
          </span>
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
        <div ref={hostRef} className="absolute inset-0" />
        {status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            {status === "idle" && (
              <p className="font-mono text-xs text-muted">
                enter a PDB ID to preview the receptor
              </p>
            )}
            {status === "loading" && (
              <p className="font-mono text-xs text-accent">loading {id}…</p>
            )}
            {status === "error" && (
              <p className="font-mono text-xs text-amber-400">
                couldn’t load {id} from RCSB
              </p>
            )}
          </div>
        )}
        {status === "ready" && (
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[10px] text-muted">
            source: RCSB · drag to rotate · scroll to zoom
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
