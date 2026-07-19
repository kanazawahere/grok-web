import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Fleet door map (ATP Tin modules) */
export const FLEET_PORTS = {
  opencodeWeb: 2023,
  piWeb: 2024,
  grokWeb: 2025,
} as const;

export type GrokWebConfig = {
  host: string;
  port: number;
  dataDir: string;
  defaultProjectName: string;
  defaultProjectPath: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxToolRounds: number;
  allowedHosts: string[];
};

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export function defaultDataDir(): string {
  return env("GROK_WEB_DATA_DIR", join(homedir(), ".grok-web"));
}

export function defaultConfigPath(): string {
  return env("GROK_WEB_CONFIG", join(homedir(), ".config/grok-web/config.json"));
}

export function loadConfig(): GrokWebConfig {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  mkdirSync(join(dataDir, "logs"), { recursive: true });

  const configPath = defaultConfigPath();
  let file: Partial<GrokWebConfig> = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, "utf8")) as Partial<GrokWebConfig>;
    } catch {
      file = {};
    }
  }

  const port = Number(env("GROK_WEB_PORT", String(file.port ?? FLEET_PORTS.grokWeb)));
  const host = env("GROK_WEB_HOST", file.host ?? "127.0.0.1");
  const apiKey =
    env("XAI_API_KEY") ||
    env("GROK_API_KEY") ||
    env("GROK_WEB_API_KEY") ||
    file.apiKey ||
    "";

  const cfg: GrokWebConfig = {
    host,
    port: Number.isFinite(port) ? port : FLEET_PORTS.grokWeb,
    dataDir,
    defaultProjectName: env(
      "GROK_WEB_DEFAULT_PROJECT_NAME",
      file.defaultProjectName ?? "Central_Command",
    ),
    defaultProjectPath: env(
      "GROK_WEB_DEFAULT_PROJECT_PATH",
      file.defaultProjectPath ?? join(homedir(), "Central_Command"),
    ),
    apiKey,
    baseUrl: env("GROK_BASE_URL", file.baseUrl ?? "https://api.x.ai/v1").replace(/\/$/, ""),
    model: env("GROK_WEB_MODEL", file.model ?? "grok-4"),
    maxToolRounds: Number(env("GROK_WEB_MAX_TOOL_ROUNDS", String(file.maxToolRounds ?? 25))),
    allowedHosts: file.allowedHosts ?? ["localhost", "127.0.0.1"],
  };

  return cfg;
}

export function writeSampleConfig(path = defaultConfigPath()): void {
  mkdirSync(join(path, ".."), { recursive: true });
  if (existsSync(path)) return;
  const sample = {
    host: "127.0.0.1",
    port: FLEET_PORTS.grokWeb,
    defaultProjectName: "Central_Command",
    defaultProjectPath: join(homedir(), "Central_Command"),
    model: "grok-4",
    baseUrl: "https://api.x.ai/v1",
    maxToolRounds: 25,
    allowedHosts: ["localhost", "127.0.0.1"],
    // Prefer env XAI_API_KEY / GROK_API_KEY over storing key in this file.
  };
  writeFileSync(path, JSON.stringify(sample, null, 2) + "\n");
}
