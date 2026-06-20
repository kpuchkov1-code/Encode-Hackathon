"use client";

/*
  Uploaded-files store. Files live client-side; each carries an `accessGranted` flag (the
  Amina "give the assistant access" checkbox). Only granted files are passed into chat
  context. A .pdb upload can be loaded straight into the structure viewer.
*/

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type FileKind = "pdb" | "ligands" | "sdf" | "other";

export interface UploadedFile {
  id: string;
  name: string;
  kind: FileKind;
  text: string;
  accessGranted: boolean;
}

export interface FilesStore {
  files: UploadedFile[];
  addFiles: (incoming: { name: string; text: string }[]) => UploadedFile[];
  remove: (id: string) => void;
  toggleAccess: (id: string) => void;
  granted: UploadedFile[];
}

const FilesContext = createContext<FilesStore | null>(null);

function kindFor(name: string): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdb") || lower.endsWith(".ent")) return "pdb";
  if (lower.endsWith(".smi") || lower.endsWith(".txt") || lower.endsWith(".smiles"))
    return "ligands";
  if (lower.endsWith(".sdf") || lower.endsWith(".mol")) return "sdf";
  return "other";
}

let seq = 0;

export function FilesProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const addFiles = useCallback((incoming: { name: string; text: string }[]) => {
    const created = incoming.map((f) => ({
      id: `f${++seq}`,
      name: f.name,
      kind: kindFor(f.name),
      text: f.text,
      accessGranted: true,
    }));
    setFiles((prev) => [...prev, ...created]);
    return created;
  }, []);

  const remove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const toggleAccess = useCallback((id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, accessGranted: !f.accessGranted } : f)),
    );
  }, []);

  const value = useMemo<FilesStore>(
    () => ({
      files,
      addFiles,
      remove,
      toggleAccess,
      granted: files.filter((f) => f.accessGranted),
    }),
    [files, addFiles, remove, toggleAccess],
  );

  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
}

export function useFiles(): FilesStore {
  const ctx = useContext(FilesContext);
  if (!ctx) throw new Error("useFiles must be used within FilesProvider");
  return ctx;
}
