import type { PiWebPlugin, PluginRuntimeContext } from "@jmfederico/pi-web/plugin-api";
import { defineGrokDnaPanel } from "./panel.js";

function sessionIdFrom(context: PluginRuntimeContext): string | undefined {
  const session = context.state.selectedSession;
  if (typeof session !== "object" || session === null) {
    return undefined;
  }
  if (!("id" in session)) {
    return undefined;
  }
  const id = session.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

function workspacePathFrom(context: PluginRuntimeContext): string | undefined {
  const path = context.state.selectedWorkspace?.path;
  return path !== undefined && path !== "" ? path : undefined;
}

async function postPrompt(sessionId: string, text: string): Promise<void> {
  await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (text === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed)) {
        out[k] = v;
      }
      return out;
    }
  } catch {
    return { raw: text };
  }
  return {};
}

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "Grok Lab (DNA)",
  activate: ({ pluginId, html, svg }) => {
    defineGrokDnaPanel();

    return {
      contributions: {
        actions: [
          {
            id: "grok.lab.open",
            title: "Open Grok Lab",
            description: "Plan · Verify · Best-of-N · Memory · Skills · CLI auth (no sandbox/worktree)",
            group: "Grok DNA",
            shortcut: "mod+shift+g",
            enabled: (context) => context.state.selectedWorkspace !== undefined,
            run: (context) => {
              if (context.state.selectedWorkspace === undefined) {
                window.alert("Select a workspace first, then open Grok Lab.");
                return;
              }
              context.selectWorkspaceTool(`${pluginId}:workspace.grok-lab`);
            },
          },
          {
            id: "grok.plan.on",
            title: "Plan mode ON",
            description: "Grok CLI-style plan gate: only edit plan file until approved",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const sid = sessionIdFrom(context);
              const ws = workspacePathFrom(context);
              if (sid === undefined) {
                return;
              }
              const res = await fetch("/api/grok-dna/plan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sid, state: "active", workspacePath: ws }),
              });
              const data = await readJson(res);
              const inject = data["injectPrompt"];
              if (typeof inject === "string" && inject !== "") {
                await postPrompt(sid, inject);
              }
              const planFile = data["planFile"];
              window.alert(typeof planFile === "string" ? `Plan mode ON\n${planFile}` : "Plan mode ON");
            },
          },
          {
            id: "grok.verify",
            title: "Run verify loop",
            description: "Like grok --check: require evidence from tests/build",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const sid = sessionIdFrom(context);
              if (sid === undefined) {
                return;
              }
              const res = await fetch("/api/grok-dna/verify-prompt", { method: "POST", body: "{}" });
              const data = await readJson(res);
              const prompt = data["prompt"];
              if (typeof prompt === "string") {
                await postPrompt(sid, prompt);
              }
            },
          },
          {
            id: "grok.export",
            title: "Export session markdown",
            description: "Write transcript under ~/.grok-web/grok-dna/exports",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const sid = sessionIdFrom(context);
              if (sid === undefined) {
                return;
              }
              const res = await fetch(`/api/grok-dna/export/${encodeURIComponent(sid)}`);
              const data = await readJson(res);
              const path = data["path"];
              window.alert(typeof path === "string" ? `Exported:\n${path}` : JSON.stringify(data).slice(0, 300));
            },
          },
          {
            id: "grok.context",
            title: "Inject Grok context pack",
            description: "Memory + permission + plan state into the active session",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const sid = sessionIdFrom(context);
              if (sid === undefined) {
                return;
              }
              const res = await fetch("/api/grok-dna/compose-context", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sid }),
              });
              const data = await readJson(res);
              const prompt = data["prompt"];
              if (typeof prompt === "string") {
                await postPrompt(sid, prompt);
              }
            },
          },
        ],
        workspacePanels: [
          {
            id: "workspace.grok-lab",
            title: "Grok Lab",
            order: 15,
            icon: svg`
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3h6"></path>
                <path d="M10 3v7l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"></path>
                <path d="M8.5 14h7"></path>
              </svg>
            `,
            render: (context) => html`<grok-dna-panel .context=${context}></grok-dna-panel>`,
          },
        ],
      },
    };
  },
};

export default plugin;
