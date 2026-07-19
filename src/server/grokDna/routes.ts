import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import {
  discoverSkills,
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

async function daemonJson(
  daemon: SessionDaemonRequestClient | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; json: unknown }> {
  if (!daemon) return { statusCode: 503, json: { error: "session daemon unavailable" } };
  const res = await daemon.request(method, path, body);
  let json: unknown = res.body;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = { raw: res.body };
  }
  return { statusCode: res.statusCode, json };
}

export function registerGrokDnaRoutes(app: FastifyInstance, daemon?: SessionDaemonRequestClient): void {
  const prefix = "/api/grok-dna";

  app.get(`${prefix}/status`, async () => {
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
      preferredModel: state.preferredModel,
      persona: state.persona,
      skillCount: discoverSkills().length,
    };
  });

  app.get(`${prefix}/cli-auth`, async () => readCliAuthSummary());

  /** Import Grok Build CLI OIDC token into env-facing status (sessiond must see XAI_API_KEY to use it). */
  app.post(`${prefix}/cli-auth/import-env-file`, async (_request, reply) => {
    const token = readCliAccessToken();
    if (!token) {
      return reply.code(400).send({
        error: "No live Grok CLI token. Run `grok login` first.",
      });
    }
    const dir = join(dataDir(), "grok-dna");
    mkdirSync(dir, { recursive: true });
    const envPath = join(dir, "xai-from-cli.env");
    // file mode guidance: operator sources this into sessiond restart
    writeFileSync(envPath, `export XAI_API_KEY='${token.replace(/'/g, `'\\''`)}'\n`, { mode: 0o600 });
    // also write a non-shell copy for tools that read raw key
    writeFileSync(join(dir, "xai-from-cli.key"), token + "\n", { mode: 0o600 });
    return {
      ok: true,
      envPath,
      hint: "Restart grok-web sessiond after: set -a; source " + envPath + "; set +a",
      email: readCliAuthSummary().email,
    };
  });

  app.get(`${prefix}/memory`, async () => {
    const state = loadState(dataDir());
    return { enabled: state.memoryEnabled, notes: state.memory };
  });

  app.post<{ Body: { text?: string; tags?: string[] } }>(`${prefix}/memory`, async (request, reply) => {
    const text = (request.body?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "text required" });
    const state = loadState(dataDir());
    const now = new Date().toISOString();
    const note: MemoryNote = {
      id: newId(),
      text,
      tags: request.body?.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    state.memory.unshift(note);
    state.memory = state.memory.slice(0, 200);
    saveState(state, dataDir());
    return { note };
  });

  app.delete<{ Params: { id: string } }>(`${prefix}/memory/:id`, async (request) => {
    const state = loadState(dataDir());
    state.memory = state.memory.filter((n) => n.id !== request.params.id);
    saveState(state, dataDir());
    return { ok: true };
  });

  app.post<{ Body: { enabled?: boolean } }>(`${prefix}/memory/toggle`, async (request) => {
    const state = loadState(dataDir());
    if (typeof request.body?.enabled === "boolean") state.memoryEnabled = request.body.enabled;
    else state.memoryEnabled = !state.memoryEnabled;
    saveState(state, dataDir());
    return { enabled: state.memoryEnabled };
  });

  app.get<{ Querystring: { sessionId?: string } }>(`${prefix}/plan`, async (request) => {
    const state = loadState(dataDir());
    const sid = request.query.sessionId ?? "";
    return {
      state: sid ? (state.planBySession[sid] ?? "inactive") : "inactive",
      planFile: sid ? state.planFileBySession[sid] : undefined,
      all: state.planBySession,
    };
  });

  app.post<{
    Body: { sessionId?: string; state?: PlanState; workspacePath?: string };
  }>(`${prefix}/plan`, async (request, reply) => {
    const sessionId = request.body?.sessionId?.trim();
    const next = request.body?.state ?? "active";
    if (!sessionId) return reply.code(400).send({ error: "sessionId required" });
    const state = loadState(dataDir());
    state.planBySession[sessionId] = next;
    if (next === "active" || next === "pending") {
      const ws = request.body?.workspacePath?.trim() || process.cwd();
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
    if (next === "inactive") {
      delete state.planBySession[sessionId];
    }
    saveState(state, dataDir());
    const planFile = state.planFileBySession[sessionId];
    return {
      state: state.planBySession[sessionId] ?? "inactive",
      planFile,
      injectPrompt:
        next === "active" && planFile
          ? planModeSystemAddendum(planFile)
          : next === "inactive"
            ? "Plan mode OFF. You may implement normally. Follow the approved plan if one exists."
            : undefined,
    };
  });

  app.get(`${prefix}/skills`, async () => ({ skills: discoverSkills() }));

  app.get<{ Params: { name: string } }>(`${prefix}/skills/:name`, async (request, reply) => {
    const skill = readSkillBody(request.params.name);
    if (!skill) return reply.code(404).send({ error: "skill not found" });
    return skill;
  });

  app.post<{ Body: { name?: string } }>(`${prefix}/skills/inject-prompt`, async (request, reply) => {
    const name = request.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const skill = readSkillBody(name);
    if (!skill) return reply.code(404).send({ error: "skill not found" });
    return { prompt: skillInjectBlock(skill.name, skill.content), skill };
  });

  app.get(`${prefix}/personas`, async () => ({ personas: listPersonas() }));

  app.post<{ Body: { mode?: string; model?: string; persona?: string } }>(`${prefix}/prefs`, async (request) => {
    const state = loadState(dataDir());
    if (request.body?.mode) {
      state.permissionMode = request.body.mode as typeof state.permissionMode;
    }
    if (request.body?.model) state.preferredModel = request.body.model;
    if (request.body?.persona !== undefined) {
      const p = request.body.persona.trim();
      if (p) state.persona = p;
      else delete state.persona;
    }
    saveState(state, dataDir());
    return {
      permissionMode: state.permissionMode,
      preferredModel: state.preferredModel,
      persona: state.persona ?? null,
      injectPrompt: permissionModeHint(state.permissionMode),
    };
  });

  app.post<{ Body: { sessionId?: string } }>(`${prefix}/compose-context`, async (request) => {
    const state = loadState(dataDir());
    const parts: string[] = [];
    if (state.memoryEnabled && state.memory.length) {
      parts.push(memoryContextBlock(state.memory));
    }
    parts.push(permissionModeHint(state.permissionMode));
    const sid = request.body?.sessionId;
    if (sid && state.planBySession[sid] === "active" && state.planFileBySession[sid]) {
      parts.push(planModeSystemAddendum(state.planFileBySession[sid]));
    }
    if (state.preferredModel) {
      parts.push(`## Preferred model: ${state.preferredModel} (request xAI/Grok when selecting models).`);
    }
    if (state.persona) {
      parts.push(`## Persona overlay: ${state.persona}`);
    }
    return { prompt: parts.filter(Boolean).join("\n\n") };
  });

  app.post(`${prefix}/verify-prompt`, async () => ({ prompt: verifyPromptAddendum() }));

  app.post<{
    Body: {
      task?: string;
      n?: number;
      cwd?: string;
      projectId?: string;
    };
  }>(`${prefix}/best-of-n`, async (request, reply) => {
    const task = (request.body?.task ?? "").trim();
    const n = Math.min(5, Math.max(2, Number(request.body?.n ?? 3)));
    if (!task) return reply.code(400).send({ error: "task required" });
    if (!daemon) return reply.code(503).send({ error: "session daemon unavailable" });

    const cwd = request.body?.cwd;
    const created: Array<{ index: number; sessionId?: string; error?: string }> = [];

    for (let i = 1; i <= n; i++) {
      const createBody: Record<string, unknown> = {
        name: `best-of-n ${i}/${n}`,
      };
      if (cwd) createBody["cwd"] = cwd;
      if (request.body?.projectId) createBody["projectId"] = request.body.projectId;

      const createdRes = await daemonJson(daemon, "POST", "/sessions", createBody);
      const sessionObj = createdRes.json as { id?: string; session?: { id?: string } };
      const sessionId = sessionObj?.id ?? sessionObj?.session?.id;
      if (createdRes.statusCode >= 300 || !sessionId) {
        created.push({
          index: i,
          error: `create failed ${createdRes.statusCode}: ${JSON.stringify(createdRes.json).slice(0, 200)}`,
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
          error: `prompt failed ${promptRes.statusCode}`,
        });
      } else {
        created.push({ index: i, sessionId });
      }
    }

    return {
      n,
      task,
      branches: created,
      note: "Compare branches in the session list; use /api/grok-dna/export/:id for summaries, then judge manually or open a judge session.",
    };
  });

  app.get<{ Params: { sessionId: string } }>(`${prefix}/export/:sessionId`, async (request, reply) => {
    if (!daemon) return reply.code(503).send({ error: "session daemon unavailable" });
    const res = await daemonJson(daemon, "GET", `/sessions/${request.params.sessionId}`);
    if (res.statusCode >= 300) return reply.code(res.statusCode).send(res.json);

    const session = res.json as {
      id?: string;
      name?: string;
      title?: string;
      cwd?: string;
      messages?: Array<{ role?: string; content?: string | unknown; type?: string; text?: string }>;
      // pi-web may nest transcript differently
      transcript?: unknown;
    };

    // Try messages page endpoint if needed
    let messages = session.messages;
    if (!messages || messages.length === 0) {
      const page = await daemonJson(daemon, "GET", `/sessions/${request.params.sessionId}/messages?limit=500`);
      const pj = page.json as { messages?: typeof messages; items?: typeof messages };
      messages = pj.messages ?? pj.items ?? [];
    }

    const lines: string[] = [
      `# Session export`,
      ``,
      `- id: ${session.id ?? request.params.sessionId}`,
      `- name: ${session.name ?? session.title ?? ""}`,
      `- cwd: ${session.cwd ?? ""}`,
      `- exportedAt: ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
    ];

    for (const m of messages ?? []) {
      const role = m.role ?? m.type ?? "message";
      let content = "";
      if (typeof m.content === "string") content = m.content;
      else if (typeof m.text === "string") content = m.text;
      else content = JSON.stringify(m.content ?? m, null, 2);
      lines.push(`## ${role}`, ``, content, ``);
    }

    const markdown = lines.join("\n");
    const outDir = join(dataDir(), "grok-dna", "exports");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${request.params.sessionId}-${Date.now()}.md`);
    writeFileSync(outPath, markdown);
    return { markdown, path: outPath };
  });

  /** Creative: prompt lab presets */
  app.get(`${prefix}/lab/presets`, async () => ({
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
        prompt:
          "Summarize status for an operator on a phone: 5 bullets max, one next action, one risk.",
      },
    ],
  }));
}
