/*
  Shared tool catalogue for the copilot — used by both the server agent loop and the
  client transport. Tools are OpenAI-function-shaped (the AI Gateway speaks the
  OpenAI-compatible API). Each tool is tagged with where it runs:

    - "server": executed inside the agent loop (RCSB fetch, clean, submit, search…)
    - "client": executed in the browser against the live viewer / job panel, then the
      result is posted back to continue the loop (highlight_residues, set_pocket)
*/

export type ToolRunsOn = "server" | "client";

export interface ToolDef {
  type: "function";
  runsOn: ToolRunsOn;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---- OpenAI-compatible chat message shapes ----

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

const str = (description: string) => ({ type: "string", description });

export const TOOL_DEFS: ToolDef[] = [
  {
    type: "function",
    runsOn: "client",
    function: {
      name: "fetch_structure",
      description:
        "Fetch a protein structure from the RCSB PDB by its 4-character PDB id and load it into the viewer. Returns a summary (chains, residue count).",
      parameters: {
        type: "object",
        properties: { pdb_id: str("4-character PDB id, e.g. 6LU7") },
        required: ["pdb_id"],
      },
    },
  },
  {
    type: "function",
    runsOn: "client",
    function: {
      name: "clean_structure",
      description:
        "Clean the currently loaded structure for docking: remove waters, non-protein hetero atoms, and alternate conformations. Returns counts of what was removed. Does not invent atoms.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    runsOn: "client",
    function: {
      name: "submit_job",
      description:
        "Fill the job panel with a docking specification so the user can review and run it. Use the currently loaded receptor and current residue selection as the pocket when available. Does NOT start the job; the user clicks Run.",
      parameters: {
        type: "object",
        properties: {
          ligands: {
            type: "array",
            description: "Ligands to dock, each with an id and a SMILES string.",
            items: {
              type: "object",
              properties: { id: str("short id"), smiles: str("SMILES string") },
              required: ["id", "smiles"],
            },
          },
          amount: { type: "number", description: "Payment amount (marketplace units)." },
        },
        required: ["ligands"],
      },
    },
  },
  {
    type: "function",
    runsOn: "server",
    function: {
      name: "get_job_status",
      description: "Get the current state of a docking job by id.",
      parameters: {
        type: "object",
        properties: { job_id: str("job id") },
        required: ["job_id"],
      },
    },
  },
  {
    type: "function",
    runsOn: "server",
    function: {
      name: "get_result",
      description: "Get ranked docking results (cnn_affinity etc) for a job once it is docked.",
      parameters: {
        type: "object",
        properties: { job_id: str("job id") },
        required: ["job_id"],
      },
    },
  },
  {
    type: "function",
    runsOn: "server",
    function: {
      name: "web_search",
      description:
        "Search the web for scientific literature or context. Use for questions about inhibitors, targets, or recent findings.",
      parameters: {
        type: "object",
        properties: { query: str("search query") },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    runsOn: "server",
    function: {
      name: "lookup_pdb",
      description:
        "Search the RCSB PDB for structures matching a free-text query (e.g. 'SARS-CoV-2 main protease'). Returns candidate PDB ids and titles. No API key needed.",
      parameters: {
        type: "object",
        properties: { query: str("free-text structure query") },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    runsOn: "client",
    function: {
      name: "highlight_residues",
      description:
        "Highlight residues in the 3D viewer and sequence strip (orange). Use a selection expression like 'A:140-145, A:150'.",
      parameters: {
        type: "object",
        properties: {
          selection: str("residue selection expression, e.g. 'A:140-145, A:150'"),
        },
        required: ["selection"],
      },
    },
  },
  {
    type: "function",
    runsOn: "client",
    function: {
      name: "set_pocket",
      description:
        "Set the docking pocket from the current residue selection (or a given selection expression). Computes the box and writes it into the job panel.",
      parameters: {
        type: "object",
        properties: {
          selection: str("optional selection expression; omit to use the current selection"),
        },
        required: [],
      },
    },
  },
];

export const CLIENT_TOOL_NAMES = new Set(
  TOOL_DEFS.filter((t) => t.runsOn === "client").map((t) => t.function.name),
);

/** Strip the runsOn tag — the gateway only wants {type, function}. */
export function toolsForGateway() {
  return TOOL_DEFS.map(({ type, function: fn }) => ({ type, function: fn }));
}

export const SYSTEM_PROMPT = `You are the copilot for DockMarket, a decentralized marketplace where idle GPUs run real molecular docking. You help a scientist load and clean a receptor, choose a binding pocket by selecting residues, submit a docking screen, and interpret the results.

Guidelines:
- Be concise and scientific. Use monospace-friendly plain text; no markdown headers.
- To dock, first ensure a receptor is loaded (fetch_structure) and a pocket is chosen. Prefer the user's current residue selection as the pocket.
- submit_job only FILLS the job panel; tell the user to review and click Run. Never claim a job started until you have a job_id from a status tool.
- When the user references "this pocket", "here", or "these residues", use their current selection (provided to you as context).
- Explain cnn_affinity simply: higher is a better predicted binder; the active should outrank the decoy.`;
