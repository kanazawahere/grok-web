import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import {
  discoverSkills,
  isPermissionMode,
  isPlanState,
  listPersonas,
  loadState,
  newId,
  readCliAccessToken,
  readCliAuthSummary,
  readSkillBody,
  saveState,
  type MemoryNote,
  type PlanState,
} from "./store.js";
import {
  bestOfNBranchPrompt,
  memoryContextBlock,
  permissionModeHint,
  planModeSystemAddendum,
  skillInjectBlock,
  verifyPromptAddendum,
} from "./prompts.js";
import type { SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { piWebDataDir } from "../../config.js";

function dataDir(): string {
  try {
    return piWebDataDir();
  } catch {
    return join(homedir(), ".grok-web");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function daemonJson(
  daemon: SessionDaemonRequestClient | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; json: unknown }> {
  if (daemon === undefined) {
    return { statusCode: 503, json: { error: "session daemon unavailable" } };
  }
  const res = await daemon.request(method, path, body);
  if (res.body === "") {
    return { statusCode: res.statusCode, json: null };
  }
  try {
    return { statusCode: res.statusCode, json: JSON.parse(res.body) };
  } catch {
    return { statusCode: res.statusCode, json: { raw: res.body } };
  }
}

function readSessionId(json: unknown): string | undefined {
  if (!isRecord(json)) {
    return undefined;
  }
  const id = asString(json["id"]);
  if (id !== undefined && id !== "") {
    return id;
  }
  const session = json["session"];
  if (isRecord(session)) {
    const nested = asString(session["id"]);
    if (nested !== undefined && nested !== "") {
      return nested;
    }
  }
  return undefined;
}

function messageContent(message: Record<string, unknown>): string {
  const content = message["content"];
  if (typeof content === "string") {
    return content;
  }
  const text = message["text"];
  if (typeof text === "string") {
    return text;
  }
  return JSON.stringify(content ?? message, null, 2);
}

function extractMessages(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json)) {
    return [];
  }
  const direct = json["messages"];
  if (Array.isArray(direct)) {
    return direct.filter(isRecord);
  }
  const items = json["items"];
  if (Array.isArray(items)) {
    return items.filter(isRecord);
  }
  return [];
}

export function registerGrokDnaRoutes(app: FastifyInstance, daemon?: SessionDaemonRequestClient): void {
  const prefix = "/api/grok-dna";

  app.get(`${prefix}/status`, () => {
    const state = loadState(dataDir());
    const cli = readCliAuthSummary();
    return {
      product: "grok-web",
      fleetPort: 2025,
      lineage: "kanazawahere/pi-web@atp-stable → grok-web",
      excludes: ["sandbox", "worktree"],
      features: [
        "cli-oidc",
        "plan-mode",
        "verify",
        "best-of-n",
        "memory",
        "skills-bridge",
        "personas",
        "export",
        "permission-mode",
        "prompt-lab",
      ],
      cliAuth: cli,
      memoryEnabled: state.memoryEnabled,
      memoryCount: state.memory.length,
      permissionMode: state.permissionMode,
      preferredModel: state.preferredModel ?? null,
      persona: state.persona ?? null,
      skillCount: discoverSkills().length,
    };
  });

  app.get(`${prefix}/cli-auth`, () => readCliAuthSummary());

  app.post(`${prefix}/cli-auth/import-env-file`, async (_request, reply) => {
    const token = readCliAccessToken();
    if (token === null) {
      return reply.code(400).send({
        error: "No live Grok CLI token. Run `grok login` first.",
      });
    }
    const dir = join(dataDir(), "grok-dna");
    mkdirSync(dir, { recursive: true });
    const envPath = join(dir, "xai-from-cli.env");
    const escaped = token.replace(/'/g, `'\\''`);
    writeFileSync(envPath, `export XAI_API_KEY='${escaped}'\n`, { mode: 0o600 });
    writeFileSync(join(dir, "xai-from-cli.key"), `${token}\n`, { mode: 0o600 });
    return {
      ok: true,
      envPath,
      hint: `Restart grok-web sessiond after: set -a; source ${envPath}; set +a`,
      email: readCliAuthSummary().email ?? null,
    };
  });

  app.get(`${prefix}/memory`, () => {
    const state = loadState(dataDir());
    return { enabled: state.memoryEnabled, notes: state.memory };
  });

  app.post<{ Body: { text?: string; tags?: string[] } | undefined }>(`${prefix}/memory`, (request, reply) => {
    const body = request.body;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text === "") {
      return reply.code(400).send({ error: "text required" });
    }
    const state = loadState(dataDir());
    const now = new Date().toISOString();
    const tags = Array.isArray(body?.tags)
      ? body.tags.filter((t): t is string => typeof t === "string")
      : [];
    const note: MemoryNote = {
      id: newId(),
      text,
      tags,
      createdAt: now,
      updatedAt: now,
    };
    state.memory.unshift(note);
    state.memory = state.memory.slice(0, 200);
    saveState(state, dataDir());
    return { note };
  });

  app.delete<{ Params: { id: string } }>(`${prefix}/memory/:id`, (request) => {
    const state = loadState(dataDir());
    state.memory = state.memory.filter((n) => n.id !== request.params.id);
    saveState(state, dataDir());
    return { ok: true };
  });

  app.post<{ Body: { enabled?: boolean } | undefined }>(`${prefix}/memory/toggle`, (request) => {
    const state = loadState(dataDir());
    const enabled = request.body?.enabled;
    if (typeof enabled === "boolean") {
      state.memoryEnabled = enabled;
    } else {
      state.memoryEnabled = !state.memoryEnabled;
    }
    saveState(state, dataDir());
    return { enabled: state.memoryEnabled };
  });

  app.get<{ Querystring: { sessionId?: string } }>(`${prefix}/plan`, (request) => {
    const state = loadState(dataDir());
    const sid = typeof request.query.sessionId === "string" ? request.query.sessionId : "";
    const sessionState: PlanState = sid !== "" ? (state.planBySession[sid] ?? "inactive") : "inactive";
    return {
      state: sessionState,
      planFile: sid !== "" ? state.planFileBySession[sid] : undefined,
      all: state.planBySession,
    };
  });

  app.post<{
    Body: { sessionId?: string; state?: string; workspacePath?: string } | undefined;
  }>(`${prefix}/plan`, (request, reply) => {
    const body = request.body;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    const nextRaw = typeof body?.state === "string" ? body.state : "active";
    if (sessionId === "") {
      return reply.code(400).send({ error: "sessionId required" });
    }
    if (!isPlanState(nextRaw)) {
      return reply.code(400).send({ error: "invalid plan state" });
    }
    const next = nextRaw;
    const state = loadState(dataDir());
    if (next === "inactive") {
      const nextPlan: Record<string, PlanState> = {};
      for (const [k, v] of Object.entries(state.planBySession)) {
        if (k !== sessionId) {
          nextPlan[k] = v;
        }
      }
      state.planBySession = nextPlan;
    } else {
      state.planBySession[sessionId] = next;
    }
    if (next === "active" || next === "pending") {
      const ws =
        typeof body?.workspacePath === "string" && body.workspacePath.trim() !== ""
          ? body.workspacePath.trim()
          : process.cwd();
      const planDir = join(ws, ".grok-web");
      mkdirSync(planDir, { recursive: true });
      const planFile = join(planDir, `plan-${sessionId}.md`);
      if (!existsSync(planFile)) {
        writeFileSync(
          planFile,
          `# Plan (${sessionId})\n\n## Goal\n\n## Approach\n\n## Steps\n\n## Risks\n\n## Tests\n`,
        );
      }
      state.planFileBySession[sessionId] = planFile;
    }
    saveState(state, dataDir());
    const activePlanFile = state.planFileBySession[sessionId];
    let injectPrompt: string | undefined;
    if (next === "active" && activePlanFile !== undefined) {
      injectPrompt = planModeSystemAddendum(activePlanFile);
    } else if (next === "inactive") {
      injectPrompt = "Plan mode OFF. You may implement normally. Follow the approved plan if one exists.";
    }
    return {
      state: state.planBySession[sessionId] ?? "inactive",
      planFile: activePlanFile,
      injectPrompt,
    };
  });

  app.get(`${prefix}/skills`, () => ({ skills: discoverSkills() }));

  app.get<{ Params: { name: string } }>(`${prefix}/skills/:name`, (request, reply) => {
    const skill = readSkillBody(request.params.name);
    if (skill === null) {
      return reply.code(404).send({ error: "skill not found" });
    }
    return skill;
  });

  app.post<{ Body: { name?: string } | undefined }>(`${prefix}/skills/inject-prompt`, (request, reply) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (name === "") {
      return reply.code(400).send({ error: "name required" });
    }
    const skill = readSkillBody(name);
    if (skill === null) {
      return reply.code(404).send({ error: "skill not found" });
    }
    return { prompt: skillInjectBlock(skill.name, skill.content), skill };
  });

  app.get(`${prefix}/personas`, () => ({ personas: listPersonas() }));

  app.post<{ Body: { mode?: string; model?: string; persona?: string } | undefined }>(
    `${prefix}/prefs`,
    (request, reply) => {
      const state = loadState(dataDir());
      const mode = request.body?.mode;
      if (typeof mode === "string") {
        if (!isPermissionMode(mode)) {
          return reply.code(400).send({ error: "invalid permission mode" });
        }
        state.permissionMode = mode;
      }
      const model = request.body?.model;
      if (typeof model === "string" && model.trim() !== "") {
        state.preferredModel = model.trim();
      }
      if (request.body !== undefined && "persona" in request.body) {
        const persona = request.body.persona;
        if (typeof persona === "string" && persona.trim() !== "") {
          state.persona = persona.trim();
        } else {
          delete state.persona;
        }
      }
      saveState(state, dataDir());
      return {
        permissionMode: state.permissionMode,
        preferredModel: state.preferredModel ?? null,
        persona: state.persona ?? null,
        injectPrompt: permissionModeHint(state.permissionMode),
      };
    },
  );

  app.post<{ Body: { sessionId?: string } | undefined }>(`${prefix}/compose-context`, (request) => {
    const state = loadState(dataDir());
    const parts: string[] = [];
    if (state.memoryEnabled && state.memory.length > 0) {
      parts.push(memoryContextBlock(state.memory));
    }
    parts.push(permissionModeHint(state.permissionMode));
    const sid = typeof request.body?.sessionId === "string" ? request.body.sessionId : "";
    if (sid !== "" && state.planBySession[sid] === "active") {
      const planFile = state.planFileBySession[sid];
      if (planFile !== undefined) {
        parts.push(planModeSystemAddendum(planFile));
      }
    }
    if (state.preferredModel !== undefined && state.preferredModel !== "") {
      parts.push(`## Preferred model: ${state.preferredModel} (request xAI/Grok when selecting models).`);
    }
    if (state.persona !== undefined && state.persona !== "") {
      parts.push(`## Persona overlay: ${state.persona}`);
    }
    return { prompt: parts.filter((p) => p !== "").join("\n\n") };
  });

  app.post(`${prefix}/verify-prompt`, () => ({ prompt: verifyPromptAddendum() }));

  app.post<{
    Body: {
      task?: string;
      n?: number;
      cwd?: string;
      projectId?: string;
    } | undefined;
  }>(`${prefix}/best-of-n`, async (request, reply) => {
    const task = typeof request.body?.task === "string" ? request.body.task.trim() : "";
    const rawN = request.body?.n;
    const n = Math.min(5, Math.max(2, typeof rawN === "number" && Number.isFinite(rawN) ? Math.trunc(rawN) : 3));
    if (task === "") {
      return reply.code(400).send({ error: "task required" });
    }
    if (daemon === undefined) {
      return reply.code(503).send({ error: "session daemon unavailable" });
    }

    const cwd = typeof request.body?.cwd === "string" ? request.body.cwd : undefined;
    const projectId = typeof request.body?.projectId === "string" ? request.body.projectId : undefined;
    const created: { index: number; sessionId?: string; error?: string }[] = [];

    for (let i = 1; i <= n; i += 1) {
      const createBody: Record<string, unknown> = {
        name: `best-of-n ${String(i)}/${String(n)}`,
      };
      if (cwd !== undefined && cwd !== "") {
        createBody["cwd"] = cwd;
      }
      if (projectId !== undefined && projectId !== "") {
        createBody["projectId"] = projectId;
      }

      const createdRes = await daemonJson(daemon, "POST", "/sessions", createBody);
      const sessionId = readSessionId(createdRes.json);
      if (createdRes.statusCode >= 300 || sessionId === undefined) {
        created.push({
          index: i,
          error: `create failed ${String(createdRes.statusCode)}: ${JSON.stringify(createdRes.json).slice(0, 200)}`,
        });
        continue;
      }
      const prompt = bestOfNBranchPrompt(i, n, task);
      const promptRes = await daemonJson(daemon, "POST", `/sessions/${sessionId}/prompt`, {
        text: prompt,
      });
      if (promptRes.statusCode >= 300) {
        created.push({
          index: i,
          sessionId,
          error: `prompt failed ${String(promptRes.statusCode)}`,
        });
      } else {
        created.push({ index: i, sessionId });
      }
    }

    return {
      n,
      task,
      branches: created,
      note: "Compare branches in the session list; use /api/grok-dna/export/:id for summaries.",
    };
  });

  app.get<{ Params: { sessionId: string } }>(`${prefix}/export/:sessionId`, async (request, reply) => {
    if (daemon === undefined) {
      return reply.code(503).send({ error: "session daemon unavailable" });
    }
    const res = await daemonJson(daemon, "GET", `/sessions/${request.params.sessionId}`);
    if (res.statusCode >= 300) {
      return reply.code(res.statusCode).send(res.json);
    }

    const session = isRecord(res.json) ? res.json : {};
    let messages = extractMessages(res.json);
    if (messages.length === 0) {
      const page = await daemonJson(daemon, "GET", `/sessions/${request.params.sessionId}/messages?limit=500`);
      messages = extractMessages(page.json);
    }

    const lines: string[] = [
      `# Session export`,
      ``,
      `- id: ${asString(session["id"]) ?? request.params.sessionId}`,
      `- name: ${asString(session["name"]) ?? asString(session["title"]) ?? ""}`,
      `- cwd: ${asString(session["cwd"]) ?? ""}`,
      `- exportedAt: ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
    ];

    for (const m of messages) {
      const role = asString(m["role"]) ?? asString(m["type"]) ?? "message";
      const content = messageContent(m);
      lines.push(`## ${role}`, ``, content, ``);
    }

    const markdown = lines.join("\n");
    const outDir = join(dataDir(), "grok-dna", "exports");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${request.params.sessionId}-${String(Date.now())}.md`);
    writeFileSync(outPath, markdown);
    return { markdown, path: outPath };
  });

  app.get(`${prefix}/lab/presets`, () => ({
    presets: [
      {
        id: "architect",
        title: "Architect pass",
        prompt:
          "Act as principal engineer. Map constraints, propose 2 COAs with tradeoffs, recommend one. No code yet.",
      },
      {
        id: "redteam",
        title: "Red-team the plan",
        prompt:
          "Adversarially review the current approach: failure modes, security, data loss, fleet blast radius. List fixes ordered by severity.",
      },
      {
        id: "distill",
        title: "Distill for AAR",
        prompt:
          "Write a short AAR: what changed, root cause if bugfix, lessons, and concrete follow-ups for SOPs/skills.",
      },
      {
        id: "mobile",
        title: "Phone-operator brief",
        prompt: "Summarize status for an operator on a phone: 5 bullets max, one next action, one risk.",
      },
    ],
  }));
}
