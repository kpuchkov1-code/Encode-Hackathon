"use client";

/*
  Client chat transport. Talks to /api/chat and drives the tool round-trip:

    POST messages -> server runs the agent loop, executing server tools itself
      -> returns {type:"message"} (final answer), OR
      -> returns {type:"client_tools"} with calls the BROWSER must run against the live
         viewer / job panel; we execute them, append the results, and POST again.

  The caller supplies `applyClientTool` (name, args) => result, and `getContext()` so the
  server always sees the latest PDB + residue selection.
*/

import type { ChatMessage, ToolCall } from "./tools";

export interface ChatContext {
  pdb_id?: string;
  selection?: string;
  has_structure?: boolean;
  granted_files?: { name: string; kind: string }[];
}

export type ClientToolFn = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

type ChatResponse =
  | { type: "message"; message: ChatMessage; messages: ChatMessage[] }
  | { type: "client_tools"; client_calls: ToolCall[]; messages: ChatMessage[] }
  | { error: string };

async function postChat(
  messages: ChatMessage[],
  context: ChatContext,
): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
  return (await res.json()) as ChatResponse;
}

export interface RunChatResult {
  /** Full message list (dialogue only, no system) after the exchange. */
  messages: ChatMessage[];
  /** The final assistant text, if any. */
  final: ChatMessage | null;
  error?: string;
}

const MAX_ROUNDS = 8;

export async function runChat(
  history: ChatMessage[],
  context: ChatContext,
  applyClientTool: ClientToolFn,
  onProgress?: (messages: ChatMessage[]) => void,
): Promise<RunChatResult> {
  let messages = history;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await postChat(messages, context);

    if ("error" in res) {
      return { messages, final: null, error: res.error };
    }

    if (res.type === "message") {
      onProgress?.(res.messages);
      return { messages: res.messages, final: res.message };
    }

    // client_tools — execute each against the live UI, append results, continue.
    onProgress?.(res.messages);
    const toolMessages: ChatMessage[] = [];
    for (const call of res.client_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* empty */
      }
      let result: unknown;
      try {
        result = await applyClientTool(call.function.name, args);
      } catch (e) {
        result = { error: e instanceof Error ? e.message : "client tool failed" };
      }
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result ?? { ok: true }),
      });
    }
    messages = [...res.messages, ...toolMessages];
  }

  return { messages, final: null, error: "too many tool rounds" };
}
