/** Grok Lab panel — plain custom element (same style as workspace-tasks). */

export const grokDnaPanelTag = "grok-dna-panel";

export function defineGrokDnaPanel(): void {
  if (customElements.get(grokDnaPanelTag) === undefined) {
    customElements.define(grokDnaPanelTag, GrokDnaPanel);
  }
}

interface SessionRef {
  id?: string;
}

interface WorkspaceRef {
  path?: string;
}

interface PanelContext {
  state?: {
    selectedSession?: SessionRef;
    selectedWorkspace?: WorkspaceRef;
  };
}

interface MemoryNote {
  id: string;
  text: string;
}

interface SkillHit {
  name: string;
  preview: string;
}

interface Preset {
  id: string;
  title: string;
  prompt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

class GrokDnaPanel extends HTMLElement {
  private ctx: PanelContext | undefined;
  private readonly root: ShadowRoot;
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

  set context(value: PanelContext | undefined) {
    this.ctx = value;
    void this.refresh();
  }

  connectedCallback(): void {
    this.renderShell();
    void this.refresh();
  }

  private sessionId(): string | undefined {
    const id = this.ctx?.state?.selectedSession?.id;
    return id !== undefined && id !== "" ? id : undefined;
  }

  private workspacePath(): string | undefined {
    const path = this.ctx?.state?.selectedWorkspace?.path;
    return path !== undefined && path !== "" ? path : undefined;
  }

  private async api(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const res = await fetch(`/api/grok-dna${path}`, {
      ...init,
      headers,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    if (!res.ok) {
      const errMsg =
        isRecord(json) && typeof json["error"] === "string"
          ? json["error"]
          : text !== ""
            ? text
            : res.statusText;
      throw new Error(errMsg);
    }
    return json;
  }

  private async refresh(): Promise<void> {
    try {
      const [statusRaw, memoryRaw, skillsRaw, presetsRaw] = await Promise.all([
        this.api("/status"),
        this.api("/memory"),
        this.api("/skills"),
        this.api("/lab/presets"),
      ]);
      const status = isRecord(statusRaw) ? statusRaw : {};
      const cliRaw = status["cliAuth"];
      const cli = isRecord(cliRaw) ? cliRaw : {};
      const tokenPresent = cli["tokenPresent"] === true;
      const expired = cli["expired"] === true;
      const email = typeof cli["email"] === "string" ? cli["email"] : "";
      const memoryCount = typeof status["memoryCount"] === "number" ? status["memoryCount"] : 0;
      const skillCount = typeof status["skillCount"] === "number" ? status["skillCount"] : 0;
      const permissionMode =
        typeof status["permissionMode"] === "string" ? status["permissionMode"] : "default";
      const preferredModel =
        typeof status["preferredModel"] === "string" ? status["preferredModel"] : "—";
      this.statusHtml = [
        pill(tokenPresent && !expired ? "ok" : "warn", `CLI ${tokenPresent ? (email !== "" ? email : "ok") : "no login"}`),
        pill("", `memory ${String(memoryCount)}`),
        pill("", `skills ${String(skillCount)}`),
        pill("", `mode ${permissionMode}`),
        pill("", `model ${preferredModel}`),
      ].join(" ");

      const memory = isRecord(memoryRaw) ? memoryRaw : {};
      const notesRaw = memory["notes"];
      const notes: MemoryNote[] = [];
      if (Array.isArray(notesRaw)) {
        for (const n of notesRaw) {
          if (!isRecord(n)) {
            continue;
          }
          const id = asString(n["id"]);
          const text = asString(n["text"]);
          if (id !== undefined && text !== undefined) {
            notes.push({ id, text });
          }
        }
      }
      this.notesHtml = notes
        .slice(0, 8)
        .map((n) => `<div class="skill"><span class="pill">${esc(n.id)}</span> ${esc(n.text)}</div>`)
        .join("");

      const skillsObj = isRecord(skillsRaw) ? skillsRaw : {};
      const skillsList = skillsObj["skills"];
      const skills: SkillHit[] = [];
      if (Array.isArray(skillsList)) {
        for (const s of skillsList) {
          if (!isRecord(s)) {
            continue;
          }
          const name = asString(s["name"]);
          const preview = asString(s["preview"]) ?? "";
          if (name !== undefined) {
            skills.push({ name, preview });
          }
        }
      }
      this.skillsHtml = skills
        .slice(0, 25)
        .map(
          (s) =>
            `<div class="skill"><strong>${esc(s.name)}</strong> <button data-skill="${esc(s.name)}">Inject</button><div class="sub">${esc(s.preview)}</div></div>`,
        )
        .join("");

      const presetsObj = isRecord(presetsRaw) ? presetsRaw : {};
      const presetsList = presetsObj["presets"];
      const presets: Preset[] = [];
      if (Array.isArray(presetsList)) {
        for (const p of presetsList) {
          if (!isRecord(p)) {
            continue;
          }
          const id = asString(p["id"]);
          const title = asString(p["title"]);
          const prompt = asString(p["prompt"]);
          if (id !== undefined && title !== undefined && prompt !== undefined) {
            presets.push({ id, title, prompt });
          }
        }
      }
      this.presetsHtml = presets
        .map((p) => `<button data-preset="${esc(JSON.stringify(p))}">${esc(p.title)}</button>`)
        .join("");
    } catch (e) {
      this.log = `refresh failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.renderShell();
  }

  private async inject(text: string, label: string): Promise<void> {
    const sid = this.sessionId();
    if (sid === undefined) {
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
      if (!res.ok) {
        throw new Error((await res.text()).slice(0, 200));
      }
      this.log = `${label}: sent → ${sid}`;
    } catch (e) {
      this.log = `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.busy = "";
      this.renderShell();
    }
  }

  private async onClick(ev: Event): Promise<void> {
    const t = ev.target;
    if (!(t instanceof Element)) {
      return;
    }
    const btn = t.closest("button");
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
      return;
    }
    const id = btn.dataset["action"];
    const mode = btn.dataset["mode"];
    const skill = btn.dataset["skill"];
    const presetRaw = btn.dataset["preset"];
    try {
      if (id === "refresh") {
        await this.refresh();
      } else if (id === "import-cli") {
        this.busy = "cli";
        this.renderShell();
        const res = await this.api("/cli-auth/import-env-file", { method: "POST", body: "{}" });
        if (isRecord(res)) {
          const envPath = asString(res["envPath"]) ?? "";
          const hint = asString(res["hint"]) ?? "";
          this.log = `CLI → ${envPath}\n${hint}`;
        }
      } else if (id === "compose") {
        const res = await this.api("/compose-context", {
          method: "POST",
          body: JSON.stringify({ sessionId: this.sessionId() }),
        });
        const prompt = isRecord(res) ? asString(res["prompt"]) : undefined;
        if (prompt !== undefined) {
          await this.inject(prompt, "Context pack");
          return;
        }
      } else if (id === "plan-on" || id === "plan-off") {
        const on = id === "plan-on";
        const sid = this.sessionId();
        if (sid === undefined) {
          throw new Error("Select a session");
        }
        const res = await this.api("/plan", {
          method: "POST",
          body: JSON.stringify({
            sessionId: sid,
            state: on ? "active" : "inactive",
            workspacePath: this.workspacePath(),
          }),
        });
        if (isRecord(res)) {
          const inject = asString(res["injectPrompt"]);
          if (inject !== undefined) {
            await this.inject(inject, on ? "Plan ON" : "Plan OFF");
            return;
          }
          const planFile = asString(res["planFile"]) ?? "";
          this.log = on ? `Plan ON → ${planFile}` : "Plan OFF";
        }
      } else if (id === "verify") {
        const res = await this.api("/verify-prompt", { method: "POST", body: "{}" });
        const prompt = isRecord(res) ? asString(res["prompt"]) : undefined;
        if (prompt !== undefined) {
          await this.inject(prompt, "Verify");
          return;
        }
      } else if (id === "export") {
        const sid = this.sessionId();
        if (sid === undefined) {
          throw new Error("Select a session");
        }
        const res = await this.api(`/export/${encodeURIComponent(sid)}`);
        if (isRecord(res)) {
          const path = asString(res["path"]) ?? "";
          this.log = `Exported → ${path}`;
        }
      } else if (id === "best") {
        const taskEl = this.root.querySelector("#best-task");
        const nEl = this.root.querySelector("#best-n");
        const task =
          taskEl instanceof HTMLTextAreaElement ? taskEl.value.trim() : "";
        const n =
          nEl instanceof HTMLInputElement ? Number(nEl.value) : 3;
        if (task === "") {
          throw new Error("Enter a task");
        }
        this.busy = "best-of-n";
        this.renderShell();
        const res = await this.api("/best-of-n", {
          method: "POST",
          body: JSON.stringify({
            task,
            n: Number.isFinite(n) ? n : 3,
            cwd: this.workspacePath(),
          }),
        });
        this.log = `Best-of-N:\n${JSON.stringify(isRecord(res) ? res["branches"] : res, null, 2)}`;
      } else if (id === "mem") {
        const memEl = this.root.querySelector("#mem");
        const text = memEl instanceof HTMLTextAreaElement ? memEl.value.trim() : "";
        if (text === "") {
          return;
        }
        await this.api("/memory", { method: "POST", body: JSON.stringify({ text }) });
        if (memEl instanceof HTMLTextAreaElement) {
          memEl.value = "";
        }
        await this.refresh();
        return;
      } else if (mode !== undefined && mode !== "") {
        const res = await this.api("/prefs", {
          method: "POST",
          body: JSON.stringify({ mode }),
        });
        const inject = isRecord(res) ? asString(res["injectPrompt"]) : undefined;
        if (inject !== undefined) {
          await this.inject(inject, `Mode ${mode}`);
        }
        await this.refresh();
        return;
      } else if (skill !== undefined && skill !== "") {
        const res = await this.api("/skills/inject-prompt", {
          method: "POST",
          body: JSON.stringify({ name: skill }),
        });
        const prompt = isRecord(res) ? asString(res["prompt"]) : undefined;
        if (prompt !== undefined) {
          await this.inject(prompt, `Skill ${skill}`);
          return;
        }
      } else if (presetRaw !== undefined && presetRaw !== "") {
        const parsed: unknown = JSON.parse(presetRaw);
        if (isRecord(parsed)) {
          const prompt = asString(parsed["prompt"]);
          const title = asString(parsed["title"]) ?? "preset";
          if (prompt !== undefined) {
            await this.inject(prompt, title);
            return;
          }
        }
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
        ${this.skillsHtml !== "" ? this.skillsHtml : "<div class='sub'>No skills found</div>"}
      </section>
      <section>
        <h3>Log</h3>
        <div class="log">${this.busy !== "" ? `(${esc(this.busy)}) ` : ""}${this.log !== "" ? esc(this.log) : "—"}</div>
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dis(busy: string): string {
  return busy !== "" ? "disabled" : "";
}
