import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export type PlanState = "inactive" | "pending" | "active";

export type MemoryNote = {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type GrokDnaState = {
  memoryEnabled: boolean;
  memory: MemoryNote[];
  /** sessionId → plan mode state */
  planBySession: Record<string, PlanState>;
  /** sessionId → plan markdown path relative or absolute */
  planFileBySession: Record<string, string>;
  permissionMode: "default" | "acceptEdits" | "auto" | "dontAsk" | "bypassPermissions" | "plan";
  preferredModel?: string;
  persona?: string;
};

const DEFAULT_STATE: GrokDnaState = {
  memoryEnabled: true,
  memory: [],
  planBySession: {},
  planFileBySession: {},
  permissionMode: "default",
  preferredModel: "grok-4",
};

export function grokDnaDir(dataDir?: string): string {
  const root = dataDir && dataDir !== "" ? dataDir : join(homedir(), ".grok-web");
  const dir = join(root, "grok-dna");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath(dataDir?: string): string {
  return join(grokDnaDir(dataDir), "state.json");
}

export function loadState(dataDir?: string): GrokDnaState {
  const p = statePath(dataDir);
  if (!existsSync(p)) return structuredClone(DEFAULT_STATE);
  try {
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(readFileSync(p, "utf8")) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state: GrokDnaState, dataDir?: string): void {
  writeFileSync(statePath(dataDir), JSON.stringify(state, null, 2) + "\n");
}

export type CliAuthSummary = {
  present: boolean;
  path: string;
  email?: string | undefined;
  authMode?: string | undefined;
  expiresAt?: string | undefined;
  expired?: boolean | undefined;
  tokenPresent: boolean;
};

export function readCliAuthSummary(): CliAuthSummary {
  const path = join(homedir(), ".grok/auth.json");
  if (!existsSync(path)) {
    return { present: false, path, tokenPresent: false };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      { key?: string; email?: string; auth_mode?: string; expires_at?: string }
    >;
    const entry = Object.values(raw)[0];
    if (!entry) return { present: true, path, tokenPresent: false };
    let expired = false;
    if (entry.expires_at) {
      const t = Date.parse(entry.expires_at);
      expired = Number.isFinite(t) && t <= Date.now();
    }
    return {
      present: true,
      path,
      email: entry.email,
      authMode: entry.auth_mode,
      expiresAt: entry.expires_at,
      expired,
      tokenPresent: Boolean(entry.key && String(entry.key).trim()),
    };
  } catch {
    return { present: true, path, tokenPresent: false };
  }
}

export function readCliAccessToken(): string | null {
  const path = join(homedir(), ".grok/auth.json");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, { key?: string; expires_at?: string }>;
    for (const entry of Object.values(raw)) {
      if (!entry?.key) continue;
      if (entry.expires_at) {
        const t = Date.parse(entry.expires_at);
        if (Number.isFinite(t) && t <= Date.now()) continue;
      }
      return String(entry.key).trim();
    }
  } catch {
    return null;
  }
  return null;
}

export type SkillHit = {
  name: string;
  path: string;
  root: string;
  preview: string;
};

export function discoverSkills(): SkillHit[] {
  const roots = [
    join(homedir(), ".grok/skills"),
    join(homedir(), ".grok/bundled/skills"),
    join(homedir(), ".claude/skills"),
    join(homedir(), "Central_Command/.claude/skills"),
    join(homedir(), "atp/.claude/skills"),
  ];
  const hits: SkillHit[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    walkSkills(root, root, hits, seen, 0);
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name));
}

function walkSkills(root: string, dir: string, hits: SkillHit[], seen: Set<string>, depth: number): void {
  if (depth > 4) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const skillMd = join(full, "SKILL.md");
      if (existsSync(skillMd)) {
        const skillName = basename(full);
        if (!seen.has(skillName)) {
          seen.add(skillName);
          const text = readFileSync(skillMd, "utf8");
          hits.push({
            name: skillName,
            path: skillMd,
            root,
            preview: text.slice(0, 280).replace(/\s+/g, " ").trim(),
          });
        }
      } else {
        walkSkills(root, full, hits, seen, depth + 1);
      }
    }
  }
}

export function readSkillBody(name: string): { name: string; path: string; content: string } | null {
  const hit = discoverSkills().find((s) => s.name === name);
  if (!hit) return null;
  return { name: hit.name, path: hit.path, content: readFileSync(hit.path, "utf8") };
}

export function listPersonas(): Array<{ name: string; path: string }> {
  const dirs = [join(homedir(), ".grok/personas"), join(homedir(), ".grok/bundled/personas")];
  const out: Array<{ name: string; path: string }> = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".toml") && !name.endsWith(".md")) continue;
      out.push({ name: name.replace(/\.(toml|md)$/, ""), path: join(dir, name) });
    }
  }
  return out;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
