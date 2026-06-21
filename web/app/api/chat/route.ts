import type { NextRequest } from "next/server";
import {
  CLIENT_TOOL_NAMES,
  SYSTEM_PROMPT,
  toolsForGateway,
  type ChatMessage,
  type ToolCall,
} from "@/lib/tools";

/*
  Server-side agent loop over the Vercel AI Gateway (OpenAI-compatible).

  The browser POSTs the conversation + a small context note (current PDB + residue
  selection). We prepend the system prompt, call the gateway with the tool catalogue, and:
    - execute SERVER tools here (backend status/result lookups, web/PDB search)
    - when the model calls a CLIENT tool (viewer/job-panel effects), pause and return the
      pending calls to the browser, which executes them against the live UI and re-POSTs
      with the tool results appended.

  Secrets (AI_GATEWAY_API_KEY, EXA_API_KEY) are server-only and never reach the client.
*/

export const dynamic = "force-dynamic";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-4.5";
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL ?? "http://localhost:8000";
const MAX_ITERS = 6;

interface ChatContext {
  pdb_id?: string;
  selection?: string;
  has_structure?: boolean;
  granted_files?: { name: string; kind: string }[];
}

function contextNote(ctx: ChatContext): ChatMessage {
  const lines = [
    "Live console context (updates every message):",
    `- loaded receptor: ${ctx.has_structure ? ctx.pdb_id ?? "unknown" : "none"}`,
    `- current residue selection: ${ctx.selection || "none"}`,
  ];
  if (ctx.granted_files?.length) {
    lines.push(
      `- shared files: ${ctx.granted_files.map((f) => `${f.name} (${f.kind})`).join(", ")}`,
    );
  }
  return { role: "system", content: lines.join("\n") };
}

// ---- server tool executors ----

async function backendGet(path: string): Promise<unknown> {
  const res = await fetch(`${BACKEND_BASE_URL}/${path}`, { cache: "no-store" });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) return { error: body?.error ?? `request failed (${res.status})`, status: res.status };
  return body;
}

async function webSearch(query: string): Promise<unknown> {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    return { note: "web search is not configured (no EXA_API_KEY); answer from knowledge or suggest lookup_pdb." };
  }
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, numResults: 5, contents: { text: { maxCharacters: 600 } } }),
    });
    const data = (await res.json()) as { results?: { title?: string; url?: string; text?: string }[] };
    return {
      results: (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: (r.text ?? "").slice(0, 400),
      })),
    };
  } catch {
    return { error: "web search failed" };
  }
}

async function lookupPdb(query: string): Promise<unknown> {
  // RCSB full-text search REST API — no key required.
  const payload = {
    query: { type: "terminal", service: "full_text", parameters: { value: query } },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows: 5 } },
  };
  try {
    const url =
      "https://search.rcsb.org/rcsbsearch/v2/query?json=" +
      encodeURIComponent(JSON.stringify(payload));
    const res = await fetch(url);
    if (!res.ok) return { results: [], note: "no matches" };
    const data = (await res.json()) as { result_set?: { identifier: string }[] };
    return { candidates: (data.result_set ?? []).map((r) => r.identifier) };
  } catch {
    return { error: "pdb lookup failed" };
  }
}

async function execServerTool(call: ToolCall): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    /* leave empty */
  }
  switch (call.function.name) {
    case "get_job_status":
      return backendGet(`jobs/${args.job_id}`);
    case "get_result":
      return backendGet(`jobs/${args.job_id}/result`);
    case "web_search":
      return webSearch(String(args.query ?? ""));
    case "lookup_pdb":
      return lookupPdb(String(args.query ?? ""));
    default:
      return { error: `unknown server tool ${call.function.name}` };
  }
}

// ---- gateway call ----

async function callGateway(messages: ChatMessage[]): Promise<ChatMessage> {
  const key = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY / VERCEL_API_KEY is not set");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: toolsForGateway(),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`gateway ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: { message: ChatMessage }[];
  };
  return data.choices[0].message;
}

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[]; context?: ChatContext };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const incoming = body.messages ?? [];
  const ctx = body.context ?? {};

  // Build the working message list: system + context + conversation so far.
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    contextNote(ctx),
    ...incoming,
  ];

  try {
    for (let i = 0; i < MAX_ITERS; i++) {
      const assistant = await callGateway(messages);
      messages.push(assistant);

      const calls = assistant.tool_calls ?? [];
      if (calls.length === 0) {
        return Response.json({ type: "message", message: assistant, messages: stripSystem(messages) });
      }

      const clientCalls: ToolCall[] = [];
      for (const call of calls) {
        if (CLIENT_TOOL_NAMES.has(call.function.name)) {
          clientCalls.push(call);
        } else {
          const result = await execServerTool(call);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(result),
          });
        }
      }

      // Any client tool in this turn → hand control to the browser to execute it.
      if (clientCalls.length > 0) {
        return Response.json({
          type: "client_tools",
          client_calls: clientCalls,
          messages: stripSystem(messages),
        });
      }
      // else: all tools were server-side; loop again with their results.
    }
    return Response.json({
      type: "message",
      message: { role: "assistant", content: "(stopped after the maximum tool steps)" },
      messages: stripSystem(messages),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "chat failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/** Drop the system + context messages we prepend, so the client keeps only the dialogue. */
function stripSystem(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(
    (m, i) => !(m.role === "system" && i < 2),
  );
}
