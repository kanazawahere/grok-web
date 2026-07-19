import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

export type PlanState = "inactive" | "pending" | "active";

export interface MemoryNote {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type PermissionMode = "default" | "acceptEdits" | "auto" | "dontAsk" | "bypassPermissions" | "plan";

export interface GrokDnaState {
  memoryEnabled: boolean;
  memory: MemoryNote[];
  planBySession: Record<string, PlanState>;
  planFileBySession: Record<string, string>;
  permissionMode: PermissionMode;
  preferredModel?: string;
  persona?: string;
}

const DEFAULT_STATE: GrokDnaState = {
  memoryEnabled: true,
  memory: [],
  planBySession: {},
  planFileBySession: {},
  permissionMode: "default",
  preferredModel: "grok-4",
};

const PLAN_STATES = new Set<string>(["inactive", "pending", "active"]);
const PERMISSION_MODES = new Set<string>([
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseMemoryNote(value: unknown): MemoryNote | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asString(value["id"]);
  const text = asString(value["text"]);
  const createdAt = asString(value["createdAt"]);
  const updatedAt = asString(value["updatedAt"]);
  if (id === undefined || text === undefined || createdAt === undefined || updatedAt === undefined) {
    return undefined;
  }
  const tagsRaw = value["tags"];
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : [];
  return { id, text, tags, createdAt, updatedAt };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function toPlanState(value: string): PlanState | undefined {
  switch (value) {
    case "inactive":
    case "pending":
    case "active":
      return value;
    default:
      return undefined;
  }
}

function toPermissionMode(value: string): PermissionMode | undefined {
  switch (value) {
    case "default":
    case "acceptEdits":
    case "auto":
    case "dontAsk":
    case "bypassPermissions":
    case "plan":
      return value;
    default:
      return undefined;
  }
}

function parsePlanRecord(value: unknown): Record<string, PlanState> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, PlanState> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      continue;
    }
    const plan = toPlanState(v);
    if (plan !== undefined) {
      out[k] = plan;
    }
  }
  return out;
}

function parseState(value: unknown): GrokDnaState {
  const base = structuredClone(DEFAULT_STATE);
  if (!isRecord(value)) {
    return base;
  }
  base.memoryEnabled = asBoolean(value["memoryEnabled"], base.memoryEnabled);
  if (Array.isArray(value["memory"])) {
    base.memory = value["memory"]
      .map(parseMemoryNote)
      .filter((n): n is MemoryNote => n !== undefined);
  }
  base.planBySession = parsePlanRecord(value["planBySession"]);
  base.planFileBySession = parseStringRecord(value["planFileBySession"]);
  const mode = asString(value["permissionMode"]);
  if (mode !== undefined) {
    const permissionMode = toPermissionMode(mode);
    if (permissionMode !== undefined) {
      base.permissionMode = permissionMode;
    }
  }
  const preferredModel = asString(value["preferredModel"]);
  if (preferredModel !== undefined && preferredModel !== "") {
    base.preferredModel = preferredModel;
  }
  const persona = asString(value["persona"]);
  if (persona !== undefined && persona !== "") {
    base.persona = persona;
  }
  return base;
}

export function grokDnaDir(dataDir?: string): string {
  const root = dataDir !== undefined && dataDir !== "" ? dataDir : join(homedir(), ".grok-web");
  const dir = join(root, "grok-dna");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath(dataDir?: string): string {
  return join(grokDnaDir(dataDir), "state.json");
}

export function loadState(dataDir?: string): GrokDnaState {
  const p = statePath(dataDir);
  if (!existsSync(p)) {
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    return parseState(parsed);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state: GrokDnaState, dataDir?: string): void {
  writeFileSync(statePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

export interface CliAuthSummary {
  present: boolean;
  path: string;
  email?: string;
  authMode?: string;
  expiresAt?: string;
  expired?: boolean;
  tokenPresent: boolean;
}

interface CliAuthEntry {
  key?: string;
  email?: string;
  auth_mode?: string;
  expires_at?: string;
}

function parseCliAuthFile(raw: string): Record<string, CliAuthEntry> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return {};
  }
  const out: Record<string, CliAuthEntry> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!isRecord(v)) {
      continue;
    }
    const entry: CliAuthEntry = {};
    const key = asString(v["key"]);
    const email = asString(v["email"]);
    const authMode = asString(v["auth_mode"]);
    const expiresAt = asString(v["expires_at"]);
    if (key !== undefined) {
      entry.key = key;
    }
    if (email !== undefined) {
      entry.email = email;
    }
    if (authMode !== undefined) {
      entry.auth_mode = authMode;
    }
    if (expiresAt !== undefined) {
      entry.expires_at = expiresAt;
    }
    out[k] = entry;
  }
  return out;
}

export function readCliAuthSummary(): CliAuthSummary {
  const path = join(homedir(), ".grok/auth.json");
  if (!existsSync(path)) {
    return { present: false, path, tokenPresent: false };
  }
  try {
    const raw = parseCliAuthFile(readFileSync(path, "utf8"));
    const entry = Object.values(raw)[0];
    if (entry === undefined) {
      return { present: true, path, tokenPresent: false };
    }
    let expired = false;
    if (entry.expires_at !== undefined && entry.expires_at !== "") {
      const t = Date.parse(entry.expires_at);
      expired = Number.isFinite(t) && t <= Date.now();
    }
    const key = entry.key;
    const tokenPresent = key !== undefined && key.trim() !== "";
    const summary: CliAuthSummary = {
      present: true,
      path,
      expired,
      tokenPresent,
    };
    if (entry.email !== undefined) {
      summary.email = entry.email;
    }
    if (entry.auth_mode !== undefined) {
      summary.authMode = entry.auth_mode;
    }
    if (entry.expires_at !== undefined) {
      summary.expiresAt = entry.expires_at;
    }
    return summary;
  } catch {
    return { present: true, path, tokenPresent: false };
  }
}

export function readCliAccessToken(): string | null {
  const path = join(homedir(), ".grok/auth.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = parseCliAuthFile(readFileSync(path, "utf8"));
    for (const entry of Object.values(raw)) {
      const key = entry.key;
      if (key === undefined || key.trim() === "") {
        continue;
      }
      if (entry.expires_at !== undefined && entry.expires_at !== "") {
        const t = Date.parse(entry.expires_at);
        if (Number.isFinite(t) && t <= Date.now()) {
          continue;
        }
      }
      return key.trim();
    }
  } catch {
    return null;
  }
  return null;
}

export interface SkillHit {
  name: string;
  path: string;
  root: string;
  preview: string;
}

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
    if (!existsSync(root)) {
      continue;
    }
    walkSkills(root, root, hits, seen, 0);
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name));
}

function walkSkills(root: string, dir: string, hits: SkillHit[], seen: Set<string>, depth: number): void {
  if (depth > 4) {
    return;
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) {
      continue;
    }
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
  if (hit === undefined) {
    return null;
  }
  return { name: hit.name, path: hit.path, content: readFileSync(hit.path, "utf8") };
}

export function listPersonas(): { name: string; path: string }[] {
  const dirs = [join(homedir(), ".grok/personas"), join(homedir(), ".grok/bundled/personas")];
  const out: { name: string; path: string }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      continue;
    }
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".toml") && !name.endsWith(".md")) {
        continue;
      }
      out.push({ name: name.replace(/\.(toml|md)$/, ""), path: join(dir, name) });
    }
  }
  return out;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function isPlanState(value: string): value is PlanState {
  return PLAN_STATES.has(value);
}

export function isPermissionMode(value: string): value is PermissionMode {
  return PERMISSION_MODES.has(value);
}
