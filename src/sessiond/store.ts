import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectRecord, SessionMeta, SessionRecord } from "../shared/types.js";
import type { GrokWebConfig } from "../config.js";

export class SessionStore {
  constructor(private cfg: GrokWebConfig) {
    mkdirSync(join(cfg.dataDir, "sessions"), { recursive: true });
  }

  projects(): ProjectRecord[] {
    return [
      {
        name: this.cfg.defaultProjectName,
        path: this.cfg.defaultProjectPath,
      },
    ];
  }

  listSessions(): SessionMeta[] {
    const dir = join(this.cfg.dataDir, "sessions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const s = this.read(f.replace(/\.json$/, ""));
        if (!s) return null;
        const { messages: _m, ...meta } = s;
        return meta;
      })
      .filter((x): x is SessionMeta => Boolean(x))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  pathFor(id: string): string {
    return join(this.cfg.dataDir, "sessions", `${id}.json`);
  }

  read(id: string): SessionRecord | null {
    const p = this.pathFor(id);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
    } catch {
      return null;
    }
  }

  save(session: SessionRecord): void {
    writeFileSync(this.pathFor(session.id), JSON.stringify(session, null, 2) + "\n");
  }

  create(title?: string): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: randomUUID().slice(0, 8),
      title: title || `session ${new Date().toLocaleString()}`,
      projectName: this.cfg.defaultProjectName,
      projectPath: this.cfg.defaultProjectPath,
      model: this.cfg.model,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.save(session);
    return session;
  }

  delete(id: string): boolean {
    const p = this.pathFor(id);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    return true;
  }
}
