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
import type { Receptor } from "./types";

export type StructureStatus = "idle" | "loading" | "ready" | "error";

export interface StructureStore {
  pdbId: string;
  setPdbId: (id: string) => void;
  /** Load raw PDB text directly (e.g. from an uploaded/cleaned file). Marks it as an upload. */
  loadText: (text: string, label?: string) => void;
  /** Load a named PDB structure directly (sets the displayed id + text), no refetch. */
  loadStructure: (
    pdbId: string,
    text: string,
    source?: string,
    opts?: { uploaded?: boolean },
  ) => void;
  text: string | null;
  parsed: ParsedStructure | null;
  status: StructureStatus;
  source: string;
  /** True when the active structure came from an upload (no canonical RCSB id to re-fetch). */
  uploaded: boolean;
  /** The receptor to submit: `file` for uploads, otherwise `pdb_id` (backend re-fetches). */
  receptor: Receptor;
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
  const [uploaded, setUploaded] = useState(false);
  // Bumped on manual loadText so the fetch effect skips the next id-driven load.
  const manualRef = useRef(false);

  const setPdbId = useCallback((id: string) => {
    manualRef.current = false;
    setUploaded(false);
    setPdbIdState(id.trim().toUpperCase());
  }, []);

  const loadText = useCallback((raw: string, label = "upload") => {
    manualRef.current = true;
    setText(raw);
    setParsed(parsePdb(raw));
    setStatus("ready");
    setSource(label);
    setUploaded(true);
  }, []);

  const loadStructure = useCallback(
    (id: string, raw: string, src = "RCSB", opts?: { uploaded?: boolean }) => {
      manualRef.current = true;
      setPdbIdState(id.trim().toUpperCase());
      setText(raw);
      setParsed(parsePdb(raw));
      setStatus("ready");
      setSource(src);
      setUploaded(opts?.uploaded ?? false);
    },
    [],
  );

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
      // An upload (loadText) may have landed during the debounce window — if so, don't
      // clobber the uploaded receptor with the default id's RCSB fetch.
      if (manualRef.current) return;
      setStatus("loading");
      try {
        const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
        if (!res.ok) throw new Error(`PDB ${id} not found`);
        const raw = await res.text();
        if (cancelled || manualRef.current) return;
        setText(raw);
        setParsed(parsePdb(raw));
        setSource("RCSB");
        setUploaded(false);
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

  const receptor: Receptor =
    uploaded && text ? { file: text } : { pdb_id: pdbId.trim().toUpperCase() };

  const value = useMemo<StructureStore>(
    () => ({
      pdbId,
      setPdbId,
      loadText,
      loadStructure,
      text,
      parsed,
      status,
      source,
      uploaded,
      receptor,
    }),
    [pdbId, setPdbId, loadText, loadStructure, text, parsed, status, source, uploaded, receptor],
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
