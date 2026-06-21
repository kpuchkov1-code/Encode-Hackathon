"use client";

/*
  Center pane — the copilot chat. Owns the dialogue state and drives the agent loop via
  runChat: each send posts the conversation, the server runs server tools, client tools
  run here against the live viewer / job panel, and the transcript updates as it goes.
*/

import { useEffect, useMemo, useRef, useState } from "react";
import { runChat } from "@/lib/chat";
import type { ChatMessage } from "@/lib/tools";
import { useClientTools } from "@/lib/clientTools";
import { ToolCallCard } from "./ToolCallCard";

const SUGGESTIONS = [
  "Clean this structure for docking",
  "Highlight residues A:140-145",
  "Dock aspirin against the current pocket",
  "What does CNN affinity tell me?",
];

export function ChatPane({
  filesOpen,
  onToggleFiles,
}: {
  filesOpen: boolean;
  onToggleFiles: () => void;
}) {
  const { applyClientTool, getContext } = useClientTools();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setBusy(true);

    const ctx = getContext();
    const res = await runChat(history, ctx, applyClientTool, (live) => setMessages(live));
    if (res.error) setError(res.error);
    setMessages(res.messages.length ? res.messages : history);
    setBusy(false);
  }

  const rendered = useMemo(() => toRenderItems(messages), [messages]);
  const empty = messages.length === 0;

  function newChat() {
    setMessages([]);
    setInput("");
    setError(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header bar — matches the Files / Structure pane headers for a cohesive 3-pane look. */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          Copilot
        </span>
        {!empty && (
          <button
            type="button"
            onClick={newChat}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            + new chat
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {empty && <Greeting onPick={send} />}

          {rendered.map((item, i) => {
            if (item.kind === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-surface-2 px-4 py-2.5 text-sm text-foreground">
                    {item.text}
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex gap-3">
                <Avatar />
                <div className="min-w-0 flex-1 space-y-2">
                  {item.tools.map((t, j) => (
                    <ToolCallCard key={j} name={t.name} result={t.result} />
                  ))}
                  {item.text && (
                    <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground">
                      {item.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex gap-3">
              <Avatar />
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3">
                <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 font-mono text-[11px] text-amber-300">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface px-3 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Message the copilot…"
              className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-bright disabled:opacity-40"
              title="Send"
            >
              ↑
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Toggle active={filesOpen} onClick={onToggleFiles} label="Files" />
            <Toggle active label="Tools" />
            <Toggle active={web} onClick={() => setWeb((v) => !v)} label="🌐 Web Search" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- transcript folding ----

interface UserItem { kind: "user"; text: string }
interface AssistantItem {
  kind: "assistant";
  text: string;
  tools: { name: string; result: unknown }[];
}
type RenderItem = UserItem | AssistantItem;

function toRenderItems(messages: ChatMessage[]): RenderItem[] {
  // Map tool_call_id -> result content for pairing.
  const results = new Map<string, unknown>();
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) {
      try {
        results.set(m.tool_call_id, JSON.parse(m.content ?? "null"));
      } catch {
        results.set(m.tool_call_id, m.content);
      }
    }
  }
  const items: RenderItem[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content) {
      items.push({ kind: "user", text: m.content });
    } else if (m.role === "assistant") {
      const tools = (m.tool_calls ?? []).map((tc) => ({
        name: tc.function.name,
        result: results.get(tc.id),
      }));
      const text = m.content ?? "";
      if (text || tools.length) items.push({ kind: "assistant", text, tools });
    }
  }
  return items;
}

// ---- bits ----

function Greeting({ onPick }: { onPick: (s: string) => void }) {
  return (
    <>
      <div className="flex gap-3">
        <Avatar />
        <div className="rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 text-sm leading-relaxed">
          <p className="font-medium text-foreground">
            Copilot ready. I can fetch and clean structures, define a docking pocket from
            residues you pick, fill a screen and explain the results.
          </p>
          <p className="mt-2 text-muted">
            Load a receptor on the right, or tell me what you want to dock.
          </p>
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm text-foreground transition-colors hover:border-accent/50 hover:bg-surface-2"
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-accent/50 bg-accent/15 text-accent-bright"
          : "border-border bg-surface text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Avatar() {
  return (
    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
      <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
    </span>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  );
}
