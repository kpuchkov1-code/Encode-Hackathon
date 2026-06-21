"use client";

/*
  Bottom half of the split structure pane: a second (headless) Mol* instance that shows the
  docking candidate sitting in the receptor's binding pocket "as it happens".

  Data reality: the mock returns scores but no pose geometry, so we infer the real pocket
  location from the receptor's bound-ligand atoms and place a clearly-labelled representative
  candidate there. While the job is `running` we re-place it (the search) and spin; once
  `docked` we settle on the best pose, stop, and focus. Pass a real `poseSdf` (from the
  backend) to render the actual docked pose instead — nothing else changes.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginContext } from "@/lib/molstar";
import { pocketCenterFromPdb, buildPoseSdf, hashSeed, type Vec3 } from "@/lib/docking";
import type { JobState } from "@/lib/types";

const ACTIVE: JobState[] = ["running", "docked", "proven", "settled"];
const SETTLED_SPREAD = 1.2; // Å — tight wobble for the docked pose (still varies per job)
const SEARCH_SPREAD = 3.8; // Å — wide scatter while searching

export function DockingViewer({
  pdbText,
  state,
  ligandId,
  bestScore,
  seedKey = "",
  poseSdf,
}: {
  pdbText: string | null;
  state: JobState | undefined;
  ligandId?: string;
  bestScore?: number;
  /** Stable key (e.g. jobId:ligandId) so each docking renders a slightly different pose. */
  seedKey?: string;
  /** Real backend pose SDF — when present, overrides the synthetic candidate. */
  poseSdf?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pluginRef = useRef<PluginContext | null>(null);
  const [pluginReady, setPluginReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [poseN, setPoseN] = useState(0);

  const center = useMemo<Vec3>(
    () => (pdbText ? pocketCenterFromPdb(pdbText) : [0, 0, 0]),
    [pdbText],
  );
  const base = useMemo(() => hashSeed(seedKey), [seedKey]);

  const running = state === "running";
  const settledPose = !!state && state !== "running" && ACTIVE.includes(state);

  // Create the Mol* plugin once.
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let disposed = false;

    (async () => {
      try {
        const mol = await import("@/lib/molstar");
        if (disposed) return;
        const plugin = await mol.createViewer(canvas, host);
        if (disposed) {
          plugin.dispose();
          return;
        }
        pluginRef.current = plugin;
        setPluginReady(true);
      } catch (err) {
        if (!disposed) console.warn("[docking] viewer init failed:", err);
      }
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

  // Load the receptor whenever its coordinates change.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !pluginReady) return;
    let cancelled = false;
    setLoaded(false);

    (async () => {
      try {
        const mol = await import("@/lib/molstar");
        if (!pdbText) {
          await plugin.clear();
          return;
        }
        await mol.loadPdb(plugin, pdbText);
        if (!cancelled) setLoaded(true);
      } catch {
        /* ignore — the top viewer surfaces load errors */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdbText, pluginReady]);

  // Drive the candidate pose from job state: search-and-spin while running, settle when docked.
  useEffect(() => {
    const plugin = pluginRef.current;
    if (!plugin || !loaded || !pdbText) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    // Skip a tick if the previous placement is still committing — stacking clearLigand→rebuild
    // calls races Mol*'s internal state and is what throws deep in the engine. Self-contained
    // so a Mol* hiccup degrades to a warning instead of an unhandled promise rejection.
    let inFlight = false;
    const place = async (seed: number, spread: number, focus: boolean) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const mol = await import("@/lib/molstar");
        const sdf = poseSdf ?? buildPoseSdf(center, seed, spread);
        if (cancelled) return;
        await mol.addLigandSdf(plugin, sdf, focus);
      } catch (err) {
        if (!cancelled) console.warn("[docking] pose render skipped:", err);
      } finally {
        inFlight = false;
      }
    };

    (async () => {
      try {
        const mol = await import("@/lib/molstar");
        if (!state || !ACTIVE.includes(state)) {
          await mol.clearLigand(plugin);
          mol.setSpin(plugin, false);
          return;
        }
        if (state === "running" && !poseSdf) {
          mol.setSpin(plugin, true);
          let k = 1;
          await place(base + k, SEARCH_SPREAD, true);
          timer = setInterval(() => {
            k += 1;
            void place(base + k, SEARCH_SPREAD, false);
          }, 1100);
        } else {
          mol.setSpin(plugin, false);
          await place(base, SETTLED_SPREAD, true);
        }
      } catch (err) {
        if (!cancelled) console.warn("[docking] update failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [loaded, state, pdbText, poseSdf, center, base]);

  // HUD pose counter (purely cosmetic, mirrors the search above). State writes happen in
  // async callbacks / cleanup only — never synchronously in the effect body.
  useEffect(() => {
    if (state !== "running") return;
    let n = 0;
    const kick = setTimeout(() => setPoseN(1), 0);
    const t = setInterval(() => {
      n = Math.min(64, n + 1);
      setPoseN(n);
    }, 1100);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
      setPoseN(0);
    };
  }, [state]);

  const hud = running
    ? `searching · pose ${poseN}/64 · best ΔG ${(-5 - poseN * 0.05).toFixed(1)}`
    : settledPose
      ? `best pose · ${ligandId ?? "ligand"}${
          bestScore !== undefined ? ` · CNN aff ${bestScore.toFixed(2)}` : ""
        }`
      : "waiting for docking…";

  return (
    <div className="flex h-full min-h-[200px] flex-col overflow-hidden rounded-xl border border-accent/30 bg-background">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-bright">
            Docking
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                running ? "animate-node-pulse bg-accent" : settledPose ? "bg-accent/70" : "bg-surface-2"
              }`}
            />
            {state ?? "idle"}
          </span>
        </div>
        <span className="font-mono text-[10px] text-accent-bright">{hud}</span>
      </div>

      <div className="relative flex-1">
        <div ref={hostRef} className="absolute inset-0">
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute bottom-2 left-3 max-w-[90%] font-mono text-[9px] leading-tight text-muted">
          {poseSdf
            ? "docked pose · rendered from backend SDF"
            : "representative pose · pocket inferred from bound-ligand atoms"}
        </div>
      </div>
    </div>
  );
}
