"use client";

/*
  Loaded-structure store. Holds the active PDB id, raw coordinate text, and the parsed
  chains/sequence so the viewer, sequence strip, and job panel all read one source.
  Fetches straight from RCSB (client-side) and parses with lib/structure.
*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { parsePdb, type ParsedStructure } from "./structure";

export type StructureStatus = "idle" | "loading" | "ready" | "error";

export interface StructureStore {
  pdbId: string;
  setPdbId: (id: string) => void;
  /** Load raw PDB text directly (e.g. from an uploaded/cleaned file). */
  loadText: (text: string, label?: string) => void;
  text: string | null;
  parsed: ParsedStructure | null;
  status: StructureStatus;
  source: string;
}

const StructureContext = createContext<StructureStore | null>(null);

export function StructureProvider({
  initialPdbId = "6LU7",
  children,
}: {
  initialPdbId?: string;
  children: ReactNode;
}) {
  const [pdbId, setPdbIdState] = useState(initialPdbId);
  const [text, setText] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStructure | null>(null);
  const [status, setStatus] = useState<StructureStatus>("idle");
  const [source, setSource] = useState("RCSB");
  // Bumped on manual loadText so the fetch effect skips the next id-driven load.
  const manualRef = useRef(false);

  const setPdbId = useCallback((id: string) => {
    manualRef.current = false;
    setPdbIdState(id.trim().toUpperCase());
  }, []);

  const loadText = useCallback((raw: string, label = "upload") => {
    manualRef.current = true;
    setText(raw);
    setParsed(parsePdb(raw));
    setStatus("ready");
    setSource(label);
  }, []);

  const id = pdbId.trim().toUpperCase();
  const validId = id.length >= 4 && id !== "FAIL";

  useEffect(() => {
    if (manualRef.current) return;
    if (!validId) {
      setStatus("idle");
      setText(null);
      setParsed(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
        if (!res.ok) throw new Error(`PDB ${id} not found`);
        const raw = await res.text();
        if (cancelled) return;
        setText(raw);
        setParsed(parsePdb(raw));
        setSource("RCSB");
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setText(null);
          setParsed(null);
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, validId]);

  const value = useMemo<StructureStore>(
    () => ({ pdbId, setPdbId, loadText, text, parsed, status, source }),
    [pdbId, setPdbId, loadText, text, parsed, status, source],
  );

  return (
    <StructureContext.Provider value={value}>
      {children}
    </StructureContext.Provider>
  );
}

export function useStructure(): StructureStore {
  const ctx = useContext(StructureContext);
  if (!ctx) throw new Error("useStructure must be used within StructureProvider");
  return ctx;
}
