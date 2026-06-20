"use client";

/*
  Shared residue-selection store — the single source of truth that links the 3D viewer,
  the sequence strip, the job panel's docking pocket, and the chat's highlight tool.

  A selection is a set of "<chain>:<resi>" keys (e.g. "A:145"). Everything that touches
  residue selection reads/writes this one set, so clicking a residue in 3D lights it up
  in the sequence strip and pre-fills the pocket — with no cross-component wiring.
*/

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ResidueKey = `${string}:${number}` | string;

export function residueKey(chain: string, resi: number): string {
  return `${chain}:${resi}`;
}

export interface SelectionStore {
  selected: Set<string>;
  isSelected: (key: string) => boolean;
  toggle: (key: string) => void;
  add: (keys: string[]) => void;
  set: (keys: string[]) => void;
  clear: () => void;
  /** Human-readable summary, runs collapsed: "A:140-145, A:150". */
  summary: string;
  /** Selected residue numbers grouped by chain. */
  byChain: Record<string, number[]>;
}

const SelectionContext = createContext<SelectionStore | null>(null);

/** Collapse a sorted list of ints into range strings: [1,2,3,5] -> ["1-3","5"]. */
function collapseRuns(nums: number[]): string[] {
  if (nums.length === 0) return [];
  const sorted = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out;
}

function groupByChain(keys: Set<string>): Record<string, number[]> {
  const by: Record<string, number[]> = {};
  for (const k of keys) {
    const [chain, resiStr] = k.split(":");
    const resi = Number(resiStr);
    if (!chain || Number.isNaN(resi)) continue;
    (by[chain] ??= []).push(resi);
  }
  return by;
}

export function summarizeSelection(keys: Set<string>): string {
  const by = groupByChain(keys);
  const parts: string[] = [];
  for (const chain of Object.keys(by).sort()) {
    for (const run of collapseRuns(by[chain])) parts.push(`${chain}:${run}`);
  }
  return parts.join(", ");
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const add = useCallback((keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const set = useCallback((keys: string[]) => {
    setSelected(new Set(keys));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<SelectionStore>(
    () => ({
      selected,
      isSelected: (key: string) => selected.has(key),
      toggle,
      add,
      set,
      clear,
      summary: summarizeSelection(selected),
      byChain: groupByChain(selected),
    }),
    [selected, toggle, add, set, clear],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionStore {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}

/** Parse a selection expression like "A:140-145, A:150" into residue keys. */
export function parseSelectionExpr(expr: string): string[] {
  const keys: string[] = [];
  for (const raw of expr.split(/[,;]/)) {
    const token = raw.trim();
    if (!token) continue;
    const m = token.match(/^([A-Za-z0-9]):?\s*(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const chain = m[1];
    const start = Number(m[2]);
    const end = m[3] ? Number(m[3]) : start;
    for (let r = start; r <= end; r++) keys.push(`${chain}:${r}`);
  }
  return keys;
}
