import type { PiWebPlugin } from "@jmfederico/pi-web/plugin-api";
import { defineGrokDnaPanel } from "./panel.js";

const plugin: PiWebPlugin = {
  apiVersion: 1,
  name: "Grok Lab (DNA)",
  activate: ({ pluginId, html, svg }) => {
    defineGrokDnaPanel();

    const openLab = (context: { selectWorkspaceTool: (id: string) => void; state: { selectedWorkspace?: unknown } }) => {
      if (context.state.selectedWorkspace === undefined) {
        window.alert("Select a workspace first, then open Grok Lab.");
        return;
      }
      context.selectWorkspaceTool(`${pluginId}:workspace.grok-lab`);
    };

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
            run: (context) => openLab(context),
          },
          {
            id: "grok.plan.on",
            title: "Plan mode ON",
            description: "Grok CLI-style plan gate: only edit plan file until approved",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const session = context.state.selectedSession as { id?: string } | undefined;
              const workspace = context.state.selectedWorkspace as { path?: string } | undefined;
              const sid = session?.id;
              const ws = workspace?.path;
              if (!sid) return;
              const res = await fetch("/api/grok-dna/plan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sid, state: "active", workspacePath: ws }),
              });
              const data = (await res.json()) as { injectPrompt?: string; planFile?: string };
              if (data.injectPrompt) {
                await fetch(`/api/sessions/${encodeURIComponent(sid)}/prompt`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ text: data.injectPrompt }),
                });
              }
              window.alert(data.planFile ? `Plan mode ON\n${data.planFile}` : "Plan mode ON");
            },
          },
          {
            id: "grok.verify",
            title: "Run verify loop",
            description: "Like grok --check: require evidence from tests/build",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const session = context.state.selectedSession as { id?: string } | undefined;
              const sid = session?.id;
              if (!sid) return;
              const res = await fetch("/api/grok-dna/verify-prompt", { method: "POST", body: "{}" });
              const data = (await res.json()) as { prompt?: string };
              await fetch(`/api/sessions/${encodeURIComponent(sid)}/prompt`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: data.prompt }),
              });
            },
          },
          {
            id: "grok.export",
            title: "Export session markdown",
            description: "Write transcript under ~/.grok-web/grok-dna/exports",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const session = context.state.selectedSession as { id?: string } | undefined;
              const sid = session?.id;
              if (!sid) return;
              const res = await fetch(`/api/grok-dna/export/${encodeURIComponent(sid)}`);
              const data = (await res.json()) as { path?: string };
              window.alert(data.path ? `Exported:\n${data.path}` : JSON.stringify(data).slice(0, 300));
            },
          },
          {
            id: "grok.context",
            title: "Inject Grok context pack",
            description: "Memory + permission + plan state into the active session",
            group: "Grok DNA",
            enabled: (context) => context.state.selectedSession !== undefined,
            run: async (context) => {
              const session = context.state.selectedSession as { id?: string } | undefined;
              const sid = session?.id;
              if (!sid) return;
              const res = await fetch("/api/grok-dna/compose-context", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: sid }),
              });
              const data = (await res.json()) as { prompt?: string };
              await fetch(`/api/sessions/${encodeURIComponent(sid)}/prompt`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: data.prompt }),
              });
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
