import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "./steam/webapi";

export class AnthropicError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AnthropicError"; }
}

export interface ClaudeTool { name: string; description: string; input_schema: object; }
export type ToolHandler = (input: any) => Promise<unknown>;

const API = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-sonnet-5";

export async function claudeComplete(opts: {
  apiKey: string; system: string; user: string; model?: string;
  tools?: ClaudeTool[]; handlers?: Record<string, ToolHandler>;
  maxTokens?: number; fetchFn?: FetchFn; maxToolRounds?: number;
}): Promise<string> {
  const {
    apiKey, system, user, model = DEFAULT_MODEL, tools, handlers = {},
    maxTokens = 4096, fetchFn = tauriFetch, maxToolRounds = 8,
  } = opts;

  const messages: any[] = [{ role: "user", content: user }];

  for (let round = 0; round <= maxToolRounds; round++) {
    const res = await fetchFn(API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // Requests from the Tauri webview carry a browser Origin, which Anthropic rejects
        // with HTTP 401 unless this opt-in header is present. Safe here: the key lives on
        // the user's own machine, not shipped to third-party browsers.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, ...(tools ? { tools } : {}) }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message ? `: ${errBody.error.message}` : "";
      } catch { /* non-JSON error body: fall back to bare status */ }
      throw new AnthropicError(res.status, `Anthropic API: HTTP ${res.status}${detail}`);
    }
    const body = await res.json();

    if (body.stop_reason !== "tool_use") {
      return (body.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }

    messages.push({ role: "assistant", content: body.content });
    const results = [];
    for (const block of body.content) {
      if (block.type !== "tool_use") continue;
      let content: string;
      try {
        const handler = handlers[block.name];
        if (handler === undefined) {
          content = JSON.stringify({ error: "unknown tool" });
        } else {
          const result = await handler(block.input);
          content = JSON.stringify(result === undefined ? null : result);
        }
      }
      catch (e) { content = JSON.stringify({ error: String(e) }); }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  throw new AnthropicError(0, "tool loop exceeded maxToolRounds");
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate.trim()) as T; } catch { /* fall through */ }
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model output");
  for (let end = candidate.length; end > start; end--) {
    try { return JSON.parse(candidate.slice(start, end)) as T; } catch { /* keep shrinking */ }
  }
  throw new Error("no parseable JSON found in model output");
}
