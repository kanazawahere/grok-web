/** Grok Lab panel — plain custom element (same style as workspace-tasks). */

export const grokDnaPanelTag = "grok-dna-panel";

export function defineGrokDnaPanel(): void {
  if (!customElements.get(grokDnaPanelTag)) {
    customElements.define(grokDnaPanelTag, GrokDnaPanel);
  }
}

type Ctx = {
  state?: {
    selectedSession?: { id?: string };
    selectedWorkspace?: { path?: string };
  };
};

class GrokDnaPanel extends HTMLElement {
  private ctx: Ctx | undefined;
  private root: ShadowRoot;
  private log = "";
  private busy = "";
  private statusHtml = "loading…";
  private skillsHtml = "";
  private notesHtml = "";
  private presetsHtml = "";

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: Ctx | undefined) {
    this.ctx = value;
    void this.refresh();
  }

  connectedCallback(): void {
    this.renderShell();
    void this.refresh();
  }

  private sessionId(): string | undefined {
    return this.ctx?.state?.selectedSession?.id;
  }

  private workspacePath(): string | undefined {
    return this.ctx?.state?.selectedWorkspace?.path;
  }

  private async api(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(`/api/grok-dna${path}`, {
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new Error(json?.error || text || res.statusText);
    return json;
  }

  private async refresh(): Promise<void> {
    try {
      const [status, memory, skills, presets] = await Promise.all([
        this.api("/status"),
        this.api("/memory"),
        this.api("/skills"),
        this.api("/lab/presets"),
      ]);
      const cli = status.cliAuth || {};
      this.statusHtml = [
        pill(cli.tokenPresent && !cli.expired ? "ok" : "warn", `CLI ${cli.tokenPresent ? cli.email || "ok" : "no login"}`),
        pill("", `memory ${status.memoryCount ?? 0}`),
        pill("", `skills ${status.skillCount ?? 0}`),
        pill("", `mode ${status.permissionMode || "default"}`),
        pill("", `model ${status.preferredModel || "—"}`),
      ].join(" ");
      this.notesHtml = (memory.notes || [])
        .slice(0, 8)
        .map((n: any) => `<div class="skill"><span class="pill">${esc(n.id)}</span> ${esc(n.text)}</div>`)
        .join("");
      this.skillsHtml = (skills.skills || [])
        .slice(0, 25)
        .map(
          (s: any) =>
            `<div class="skill"><strong>${esc(s.name)}</strong> <button data-skill="${esc(s.name)}">Inject</button><div class="sub">${esc(s.preview)}</div></div>`,
        )
        .join("");
      this.presetsHtml = (presets.presets || [])
        .map((p: any) => `<button data-preset='${esc(JSON.stringify(p))}'>${esc(p.title)}</button>`)
        .join("");
    } catch (e) {
      this.log = `refresh failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.renderShell();
  }

  private async inject(text: string, label: string): Promise<void> {
    const sid = this.sessionId();
    if (!sid) {
      this.log = "Select a session first.";
      this.renderShell();
      return;
    }
    this.busy = label;
    this.renderShell();
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sid)}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 200));
      this.log = `${label}: sent → ${sid}`;
    } catch (e) {
      this.log = `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = "";
      this.renderShell();
    }
  }

  private async onClick(ev: Event): Promise<void> {
    const t = ev.target as HTMLElement;
    if (!(t instanceof HTMLElement)) return;
    const btn = t.closest("button") as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const id = btn.dataset["action"];
    const mode = btn.dataset["mode"];
    const skill = btn.dataset["skill"];
    const presetRaw = btn.dataset["preset"];
    try {
      if (id === "refresh") await this.refresh();
      else if (id === "import-cli") {
        this.busy = "cli";
        this.renderShell();
        const res = await this.api("/cli-auth/import-env-file", { method: "POST", body: "{}" });
        this.log = `CLI → ${res.envPath}\n${res.hint}`;
      } else if (id === "compose") {
        const res = await this.api("/compose-context", {
          method: "POST",
          body: JSON.stringify({ sessionId: this.sessionId() }),
        });
        await this.inject(res.prompt, "Context pack");
        return;
      } else if (id === "plan-on" || id === "plan-off") {
        const on = id === "plan-on";
        const sid = this.sessionId();
        if (!sid) throw new Error("Select a session");
        const res = await this.api("/plan", {
          method: "POST",
          body: JSON.stringify({
            sessionId: sid,
            state: on ? "active" : "inactive",
            workspacePath: this.workspacePath(),
          }),
        });
        if (res.injectPrompt) await this.inject(res.injectPrompt, on ? "Plan ON" : "Plan OFF");
        this.log = on ? `Plan ON → ${res.planFile}` : "Plan OFF";
      } else if (id === "verify") {
        const res = await this.api("/verify-prompt", { method: "POST", body: "{}" });
        await this.inject(res.prompt, "Verify");
        return;
      } else if (id === "export") {
        const sid = this.sessionId();
        if (!sid) throw new Error("Select a session");
        const res = await this.api(`/export/${encodeURIComponent(sid)}`);
        this.log = `Exported → ${res.path}`;
      } else if (id === "best") {
        const task = (this.root.querySelector("#best-task") as HTMLTextAreaElement)?.value?.trim() || "";
        const n = Number((this.root.querySelector("#best-n") as HTMLInputElement)?.value || 3);
        if (!task) throw new Error("Enter a task");
        this.busy = "best-of-n";
        this.renderShell();
        const res = await this.api("/best-of-n", {
          method: "POST",
          body: JSON.stringify({ task, n, cwd: this.workspacePath() }),
        });
        this.log = `Best-of-N:\n${JSON.stringify(res.branches, null, 2)}`;
      } else if (id === "mem") {
        const text = (this.root.querySelector("#mem") as HTMLTextAreaElement)?.value?.trim() || "";
        if (!text) return;
        await this.api("/memory", { method: "POST", body: JSON.stringify({ text }) });
        (this.root.querySelector("#mem") as HTMLTextAreaElement).value = "";
        await this.refresh();
        return;
      } else if (mode) {
        const res = await this.api("/prefs", {
          method: "POST",
          body: JSON.stringify({ mode }),
        });
        await this.inject(res.injectPrompt, `Mode ${mode}`);
        await this.refresh();
        return;
      } else if (skill) {
        const res = await this.api("/skills/inject-prompt", {
          method: "POST",
          body: JSON.stringify({ name: skill }),
        });
        await this.inject(res.prompt, `Skill ${skill}`);
        return;
      } else if (presetRaw) {
        const p = JSON.parse(presetRaw) as { prompt: string; title: string };
        await this.inject(p.prompt, p.title);
        return;
      }
    } catch (e) {
      this.log = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = "";
      this.renderShell();
    }
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <style>
        :host { display:block; height:100%; overflow:auto; padding:12px 14px 24px; color:var(--pi-text,#e6edf3); font:13px/1.45 system-ui,sans-serif; }
        h2 { margin:0 0 4px; font-size:15px; }
        .sub { color:var(--pi-muted,#8b949e); margin-bottom:12px; font-size:12px; }
        section { border:1px solid var(--pi-border,#30363d); border-radius:10px; padding:10px 12px; margin:0 0 10px; background:var(--pi-surface,#161b22); }
        section h3 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--pi-muted,#8b949e); }
        .row { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
        button { border:1px solid var(--pi-border,#30363d); background:#21262d; color:inherit; border-radius:8px; padding:6px 10px; cursor:pointer; font:inherit; }
        button.primary { background:#9a3412; border-color:#f97316; }
        button:disabled { opacity:.5; cursor:not-allowed; }
        textarea, input[type=number] { width:100%; box-sizing:border-box; background:#0d1117; color:inherit; border:1px solid var(--pi-border,#30363d); border-radius:8px; padding:8px; font:inherit; }
        .pill { display:inline-block; border:1px solid var(--pi-border,#30363d); border-radius:999px; padding:2px 8px; margin:2px 4px 2px 0; font-size:11px; color:var(--pi-muted,#8b949e); }
        .pill.ok { color:#3fb950; border-color:#238636; }
        .pill.warn { color:#d29922; }
        .log { white-space:pre-wrap; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:var(--pi-muted,#8b949e); max-height:180px; overflow:auto; }
        .skill { border-top:1px solid var(--pi-border-muted,#21262d); padding:6px 0; }
      </style>
      <h2>Grok Lab</h2>
      <div class="sub">CLI DNA on ATP Pi-Web shell · excluded: sandbox, worktree</div>
      <section>
        <h3>Status</h3>
        <div>${this.statusHtml}</div>
        <div class="row">
          <button data-action="refresh" ${dis(this.busy)}>Refresh</button>
          <button data-action="import-cli" ${dis(this.busy)}>Export CLI → env</button>
          <button class="primary" data-action="compose" ${dis(this.busy)}>Inject context pack</button>
        </div>
      </section>
      <section>
        <h3>Plan · Verify · Export</h3>
        <div class="row">
          <button class="primary" data-action="plan-on" ${dis(this.busy)}>Plan ON</button>
          <button data-action="plan-off" ${dis(this.busy)}>Plan OFF</button>
          <button class="primary" data-action="verify" ${dis(this.busy)}>Verify loop</button>
          <button data-action="export" ${dis(this.busy)}>Export MD</button>
        </div>
      </section>
      <section>
        <h3>Best-of-N</h3>
        <textarea id="best-task" rows="3" placeholder="Task for parallel candidates…"></textarea>
        <div class="row">
          <label>N <input id="best-n" type="number" min="2" max="5" value="3" style="width:4rem" /></label>
          <button class="primary" data-action="best" ${dis(this.busy)}>Launch</button>
        </div>
      </section>
      <section>
        <h3>Permission mode</h3>
        <div class="row">
          ${["default", "acceptEdits", "auto", "plan", "bypassPermissions"]
            .map((m) => `<button data-mode="${m}" ${dis(this.busy)}>${m}</button>`)
            .join("")}
        </div>
      </section>
      <section>
        <h3>Memory</h3>
        <textarea id="mem" rows="2" placeholder="Save a note for future sessions…"></textarea>
        <div class="row"><button class="primary" data-action="mem">Save note</button></div>
        ${this.notesHtml}
      </section>
      <section>
        <h3>Prompt lab</h3>
        <div class="row">${this.presetsHtml}</div>
      </section>
      <section>
        <h3>Skills bridge</h3>
        <div class="sub">~/.grok · Claude · Central_Command skills</div>
        ${this.skillsHtml || "<div class='sub'>No skills found</div>"}
      </section>
      <section>
        <h3>Log</h3>
        <div class="log">${this.busy ? `(${esc(this.busy)}) ` : ""}${esc(this.log) || "—"}</div>
      </section>
    `;
    this.root.addEventListener("click", (ev: Event) => {
      void this.onClick(ev);
    });
  }
}

function pill(cls: string, text: string): string {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function dis(busy: string): string {
  return busy ? "disabled" : "";
}
