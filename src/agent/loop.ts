import type { ChatMessage, ServerEvent, SessionRecord } from "../shared/types.js";
import type { GrokWebConfig } from "../config.js";
import { completeChat } from "./xai.js";
import { executeTool, systemPrompt } from "./tools.js";

export type Emit = (ev: ServerEvent) => void;

export async function runAgentTurn(opts: {
  cfg: GrokWebConfig;
  session: SessionRecord;
  userText: string;
  emit: Emit;
  signal?: AbortSignal;
}): Promise<SessionRecord> {
  const { cfg, emit } = opts;
  const session = structuredClone(opts.session);
  session.messages.push({ role: "user", content: opts.userText });
  session.updatedAt = new Date().toISOString();

  const baseMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt(session.projectPath) },
    ...session.messages,
  ];

  let rounds = 0;
  while (rounds < cfg.maxToolRounds) {
    rounds += 1;
    if (opts.signal?.aborted) {
      emit({ type: "cancelled" });
      return session;
    }

    emit({ type: "status", message: `model round ${rounds}` });

    let assistantText = "";
    const result = await completeChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: session.model || cfg.model,
      messages: baseMessages,
      signal: opts.signal,
      stream: true,
      onTextDelta: (t) => {
        assistantText += t;
        emit({ type: "text_delta", content: t });
      },
    });

    // stream may have already filled assistantText; prefer stream content
    const content = assistantText || result.content || "";
    const toolCalls = result.tool_calls;

    if (toolCalls?.length) {
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: content || "",
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        })),
      };
      session.messages.push(assistantMsg);
      baseMessages.push(assistantMsg);

      for (const call of toolCalls) {
        emit({
          type: "tool_call",
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
        const tr = await executeTool(session.projectPath, call.name, call.arguments);
        emit({
          type: "tool_result",
          id: call.id,
          name: call.name,
          content: tr.content,
          isError: tr.isError,
        });
        const toolMsg: ChatMessage = {
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: tr.content,
        };
        session.messages.push(toolMsg);
        baseMessages.push(toolMsg);
      }
      continue;
    }

    // final text response
    if (content) {
      session.messages.push({ role: "assistant", content });
    }
    session.updatedAt = new Date().toISOString();
    emit({ type: "done" });
    return session;
  }

  emit({ type: "error", message: `hit max tool rounds (${cfg.maxToolRounds})` });
  return session;
}
