export type Role = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: Role;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type SessionMeta = {
  id: string;
  title: string;
  projectName: string;
  projectPath: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionRecord = SessionMeta & {
  messages: ChatMessage[];
};

export type ProjectRecord = {
  name: string;
  path: string;
};

/** Server → client event stream (WebSocket) */
export type ServerEvent =
  | { type: "session"; session: SessionMeta }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "text_delta"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "status"; message: string };

export type ClientEvent =
  | { type: "user_message"; content: string }
  | { type: "interrupt" }
  | { type: "ping" };
