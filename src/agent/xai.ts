import type { ChatMessage } from "../shared/types.js";
import { toolDefinitions } from "./tools.js";

export type StreamHandlers = {
  onTextDelta?: (text: string) => void;
  onToolCalls?: (
    calls: Array<{ id: string; name: string; arguments: string }>,
  ) => void;
};

export type CompletionResult = {
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: string }>;
  finish_reason?: string;
};

export async function completeChat(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  stream?: boolean;
  onTextDelta?: (text: string) => void;
}): Promise<CompletionResult> {
  if (!opts.apiKey) {
    throw new Error("Missing XAI_API_KEY / GROK_API_KEY");
  }

  const body = {
    model: opts.model,
    messages: opts.messages.map((m) => {
      const row: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
      if (m.name) row.name = m.name;
      if (m.tool_calls) row.tool_calls = m.tool_calls;
      return row;
    }),
    tools: toolDefinitions(),
    tool_choice: "auto",
    stream: Boolean(opts.stream && opts.onTextDelta),
  };

  const res = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`xAI API ${res.status}: ${t.slice(0, 500)}`);
  }

  if (body.stream && res.body) {
    return streamParse(res, opts.onTextDelta);
  }

  const json = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const choice = json.choices?.[0];
  const msg = choice?.message;
  return {
    content: msg?.content ?? "",
    finish_reason: choice?.finish_reason,
    tool_calls: msg?.tool_calls?.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    })),
  };
}

async function streamParse(
  res: Response,
  onTextDelta?: (text: string) => void,
): Promise<CompletionResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
  let finish_reason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{
            finish_reason?: string | null;
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const ch = chunk.choices?.[0];
        if (ch?.finish_reason) finish_reason = ch.finish_reason;
        const delta = ch?.delta;
        if (delta?.content) {
          content += delta.content;
          onTextDelta?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  const tool_calls = [...toolAcc.values()].filter((t) => t.name);
  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    finish_reason,
  };
}
