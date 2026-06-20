"use client";

/*
  Left pane — file uploads. Drag/drop or pick files; each file gets a "give assistant
  access" checkbox (only granted files reach chat context). A .pdb loads straight into
  the structure viewer.
*/

import { useCallback, useRef, useState } from "react";
import { useFiles, type UploadedFile } from "@/lib/files";
import { useStructure } from "@/lib/structureStore";

export function FilesPanel() {
  const { files, addFiles, remove, toggleAccess } = useFiles();
  const { loadText } = useStructure();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const ingest = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const read = await Promise.all(
        Array.from(list).map(
          (f) =>
            new Promise<{ name: string; text: string }>((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve({ name: f.name, text: String(r.result ?? "") });
              r.readAsText(f);
            }),
        ),
      );
      const created = addFiles(read);
      // First PDB dropped loads into the viewer immediately.
      const pdb = created.find((f) => f.kind === "pdb");
      if (pdb) loadText(pdb.text, pdb.name);
    },
    [addFiles, loadText],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <p className="mb-2 text-[11px] leading-relaxed text-muted">
          Upload structures and ligand lists. Checked files are shared with the assistant.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            ingest(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
            dragging
              ? "border-accent bg-accent/10"
              : "border-border bg-surface-2/40 hover:border-accent/50"
          }`}
        >
          <UploadIcon />
          <span className="text-xs text-foreground">Choose files or drag and drop</span>
          <span className="font-mono text-[10px] text-muted">.pdb · .smi · .sdf</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdb,.ent,.smi,.smiles,.txt,.sdf,.mol"
          className="hidden"
          onChange={(e) => ingest(e.target.files)}
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {files.length === 0 ? (
          <p className="px-1 py-2 font-mono text-[10px] text-muted">no files yet</p>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                onToggle={() => toggleAccess(f.id)}
                onRemove={() => remove(f.id)}
                onLoad={f.kind === "pdb" ? () => loadText(f.text, f.name) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  onToggle,
  onRemove,
  onLoad,
}: {
  file: UploadedFile;
  onToggle: () => void;
  onRemove: () => void;
  onLoad?: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
      <input
        type="checkbox"
        checked={file.accessGranted}
        onChange={onToggle}
        title="Give the assistant access"
        className="h-3.5 w-3.5 accent-[var(--color-accent)]"
      />
      <button
        type="button"
        onClick={onLoad}
        disabled={!onLoad}
        className="min-w-0 flex-1 text-left enabled:hover:text-accent-bright"
        title={onLoad ? "Load into viewer" : file.name}
      >
        <span className="block truncate font-mono text-[11px] text-foreground">
          {file.name}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
          {file.kind}
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="text-muted opacity-0 transition-opacity hover:text-amber-400 group-hover:opacity-100"
      >
        ×
      </button>
    </li>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted">
      <path
        d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
