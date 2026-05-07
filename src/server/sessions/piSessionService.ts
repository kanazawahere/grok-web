import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";
import type { ClientCommand, ClientCommandResult, ClientSession, ClientSessionStatus } from "../types.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { BUILTIN_COMMANDS } from "./builtinCommands.js";
import { SessionCommandService } from "./sessionCommandService.js";
import type { ActiveSession } from "./sessionRuntimeStore.js";

export class PiSessionService {
  private readonly active = new Map<string, ActiveSession>();
  private readonly activities = new Map<string, { phase: "active" | "idle" | "error"; label: string; detail?: string; at: string }>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly commandService: SessionCommandService;
  private readonly agentDir = getAgentDir();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = ModelRegistry.create(this.authStorage);
  private readonly createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir, authStorage: this.authStorage, modelRegistry: this.modelRegistry });
    const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
    return { ...result, services, diagnostics: services.diagnostics };
  };

  constructor(private readonly events: SessionEventHub) {
    this.heartbeat = setInterval(() => this.publishHeartbeats(), 2000);
    this.commandService = new SessionCommandService(
      (sessionId) => this.getActive(sessionId),
      (sessionId, text) => this.prompt(sessionId, text),
      events,
    );
  }

  async list(cwd: string): Promise<ClientSession[]> {
    const sessions = await SessionManager.list(cwd);
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      cwd: s.cwd,
      name: s.name,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage,
    }));
  }

  async start(cwd: string): Promise<ClientSession> {
    const active = await this.create(SessionManager.create(cwd), cwd);
    const { session } = active.runtime;
    return {
      id: session.sessionId,
      path: session.sessionFile ?? "",
      cwd,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      messageCount: session.messages.length,
      firstMessage: "",
    };
  }

  async messages(sessionId: string): Promise<unknown[]> {
    const session = await this.getOrOpen(sessionId);
    return session.messages;
  }

  async status(sessionId: string): Promise<ClientSessionStatus> {
    return this.statusFromSession(await this.getOrOpen(sessionId));
  }

  async commands(sessionId: string): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(sessionId);
    const commands: ClientCommand[] = [...BUILTIN_COMMANDS];
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: command.invocationName, description: command.description, source: "extension" });
    }
    for (const template of session.promptTemplates) {
      commands.push({ name: template.name, description: template.description, source: "prompt" });
    }
    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${skill.name}`, description: skill.description, source: "skill" });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const session = await this.getOrOpen(sessionId);
    this.publishActivity(session, "prompt accepted", "active");
    void session.prompt(text).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(session, "error", "error", message);
      this.events.publish(sessionId, { type: "session.error", message });
    });
  }

  async runCommand(sessionId: string, text: string): Promise<ClientCommandResult> {
    return this.commandService.run(sessionId, text);
  }

  async respondToCommand(sessionId: string, requestId: string, value: string): Promise<ClientCommandResult> {
    return this.commandService.respond(sessionId, requestId, value);
  }

  async abort(sessionId: string): Promise<void> {
    const active = this.active.get(sessionId);
    if (active) await active.runtime.session.abort();
  }

  stop(sessionId: string): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    active.unsubscribe();
    void active.runtime.session.abort().finally(() => active.runtime.dispose());
    this.active.delete(sessionId);
    this.activities.delete(sessionId);
  }

  private async getOrOpen(sessionId: string): Promise<AgentSession> {
    return (await this.getActive(sessionId)).runtime.session;
  }

  private async getActive(sessionId: string): Promise<ActiveSession> {
    const active = this.active.get(sessionId);
    if (active) return active;

    const match = (await SessionManager.listAll()).find((s) => s.id === sessionId || s.id.startsWith(sessionId));
    if (!match) throw new Error("Session not found");
    return this.create(SessionManager.open(match.path), match.cwd);
  }

  private async create(sessionManager: SessionManager, cwd: string): Promise<ActiveSession> {
    const runtime = await createAgentSessionRuntime(this.createRuntime, { cwd, agentDir: this.agentDir, sessionManager });
    const active: ActiveSession = { runtime, unsubscribe: () => {} };
    this.bindRuntime(active);
    runtime.setRebindSession(async () => this.bindRuntime(active));
    this.active.set(runtime.session.sessionId, active);
    this.publishStatus(runtime.session);
    return active;
  }

  private bindRuntime(active: ActiveSession): void {
    active.unsubscribe();
    for (const [sessionId, candidate] of this.active.entries()) {
      if (candidate === active) this.active.delete(sessionId);
    }
    const { session } = active.runtime;
    active.unsubscribe = session.subscribe((event) => {
      this.events.publish(session.sessionId, toClientEvent(event));
      this.publishActivityForEvent(session, event);
      this.publishStatus(session);
    });
    this.active.set(session.sessionId, active);
  }

  private publishHeartbeats(): void {
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      const activity = this.activities.get(session.sessionId);
      const isActive = session.isStreaming || session.isBashRunning || session.isCompacting || session.pendingMessageCount > 0 || activity?.phase === "active";
      if (!isActive) continue;
      this.publishStatus(session);
      if (activity) this.publishActivity(session, activity.label, "active", activity.detail);
      else this.publishActivity(session, this.activityLabelFromStatus(session), "active");
    }
  }

  private activityLabelFromStatus(session: AgentSession): string {
    if (session.isCompacting) return "compacting";
    if (session.isBashRunning) return "running bash";
    if (session.isStreaming) return "agent running";
    if (session.pendingMessageCount) return "queued";
    return "active";
  }

  private publishActivityForEvent(session: AgentSession, event: any): void {
    if (event.type === "agent_start") return this.publishActivity(session, "agent running", "active");
    if (event.type === "agent_end") {
      this.publishActivity(session, "idle", "idle");
      setTimeout(() => {
        this.publishActivity(session, "idle", "idle");
        this.publishStatus(session);
      }, 250);
      return;
    }
    if (event.type === "turn_end") return this.publishActivity(session, "turn complete", "active");
    if (event.type === "message_start") return this.publishActivity(session, "message started", "active");
    if (event.type === "message_end") return this.publishActivity(session, "message complete", "idle");
    if (event.type === "message_update") return this.publishActivity(session, "receiving response", "active");
    if (event.type === "tool_execution_start") return this.publishActivity(session, "running tool", "active", event.toolName);
    if (event.type === "tool_execution_end") return this.publishActivity(session, event.isError ? "tool failed" : "tool complete", event.isError ? "error" : "active", event.toolName);
    if (event.type === "bash_execution_start") return this.publishActivity(session, "running bash", "active");
    if (event.type === "bash_execution_end") return this.publishActivity(session, "bash complete", "active");
    this.publishActivity(session, event.type.replaceAll("_", " "), "active");
  }

  private publishActivity(session: AgentSession, label: string, phase: "active" | "idle" | "error", detail?: string): void {
    const at = new Date().toISOString();
    this.activities.set(session.sessionId, { phase, label, detail, at });
    const activity = { sessionId: session.sessionId, phase, label, detail, at };
    this.events.publish(session.sessionId, { type: "activity.update", activity });
    this.events.publishGlobal({ type: "activity.update", activity });
  }

  private publishStatus(session: AgentSession): void {
    const status = this.statusFromSession(session);
    this.events.publish(session.sessionId, { type: "status.update", status });
    this.events.publishGlobal({ type: "status.update", status });
  }

  private statusFromSession(session: AgentSession): ClientSessionStatus {
    const stats = session.getSessionStats();
    return {
      sessionId: session.sessionId,
      model: session.model
        ? {
            provider: session.model.provider,
            id: session.model.id,
            name: (session.model as any).name,
            contextWindow: session.model.contextWindow,
            reasoning: (session.model as any).reasoning,
          }
        : undefined,
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      pendingMessageCount: session.pendingMessageCount,
      tokens: stats.tokens,
      cost: stats.cost,
      contextUsage: session.getContextUsage(),
    };
  }
}

function toClientEvent(event: any): unknown {
  if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
    return { type: "assistant.delta", text: event.assistantMessageEvent.delta };
  }
  if (event.type === "tool_execution_start") {
    return { type: "tool.start", toolName: event.toolName, toolCallId: event.toolCallId, summary: summarizeToolArgs(event.args) };
  }
  if (event.type === "tool_execution_end") {
    return { type: "tool.end", toolName: event.toolName, toolCallId: event.toolCallId, text: stringifyToolResult(event.result), isError: event.isError };
  }
  if (event.type === "agent_start") return { type: "agent.start" };
  if (event.type === "agent_end") return { type: "agent.end" };
  if (event.type === "message_end") return { type: "message.end" };
  return { type: "pi.event", eventType: event.type };
}

function summarizeToolArgs(args: any): string {
  if (!args || typeof args !== "object") return args == null ? "" : String(args);
  if (typeof args.command === "string") return args.command;
  if (typeof args.path === "string") return args.path;
  if (typeof args.oldText === "string" && typeof args.newText === "string") return "edit text replacement";
  if (Array.isArray(args.edits)) return `${args.edits.length} edit${args.edits.length === 1 ? "" : "s"}`;
  const entries = Object.entries(args).filter(([, value]) => value != null).slice(0, 3);
  return entries.map(([key, value]) => `${key}: ${shortToolValue(value)}`).join(" · ");
}

function shortToolValue(value: unknown): string {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object" && value) return "object";
  return "";
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(stringifyToolResult).filter(Boolean).join("\n");
  if (result && typeof result === "object") {
    const text = (result as any).text ?? (result as any).content ?? (result as any).output;
    if (typeof text === "string") return text;
    return JSON.stringify(result, null, 2);
  }
  return result == null ? "" : String(result);
}
