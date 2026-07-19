import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Fleet door map (ATP Tin modules) */
export const FLEET_PORTS = {
  opencodeWeb: 2023,
  piWeb: 2024,
  grokWeb: 2025,
} as const;

export type AuthSource = "env" | "config" | "cli-oidc" | "none";

export type GrokWebConfig = {
  host: string;
  port: number;
  dataDir: string;
  defaultProjectName: string;
  defaultProjectPath: string;
  apiKey: string;
  /** Where the bearer token came from (never log the token itself). */
  authSource: AuthSource;
  /** CLI account email when authSource is cli-oidc */
  authEmail?: string;
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

/** Official Grok Build CLI login store (`grok login` → OIDC). */
export function defaultCliAuthPath(): string {
  return env("GROK_CLI_AUTH", join(homedir(), ".grok/auth.json"));
}

type CliAuthEntry = {
  key?: string;
  auth_mode?: string;
  email?: string;
  expires_at?: string;
  refresh_token?: string;
};

/**
 * Read bearer token from Grok Build CLI account (~/.grok/auth.json).
 * Verified: OIDC access JWT works as Bearer against https://api.x.ai/v1.
 */
export function loadCliOidcAuth(authPath = defaultCliAuthPath()): {
  token: string;
  email?: string;
  expiresAt?: string;
  expired: boolean;
} | null {
  if (!existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, CliAuthEntry>;
    const entries = Object.values(raw);
    if (!entries.length) return null;
    // Prefer non-expired entry with a key; otherwise first with key
    const now = Date.now();
    const ranked = entries
      .filter((e) => e?.key && String(e.key).trim())
      .map((e) => {
        let expMs = 0;
        if (e.expires_at) {
          const t = Date.parse(e.expires_at);
          if (Number.isFinite(t)) expMs = t;
        }
        const expired = expMs > 0 ? expMs <= now : false;
        return { e, expMs, expired };
      })
      .sort((a, b) => {
        // live tokens first, then latest expiry
        if (a.expired !== b.expired) return a.expired ? 1 : -1;
        return b.expMs - a.expMs;
      });
    const best = ranked[0];
    if (!best) return null;
    return {
      token: String(best.e.key).trim(),
      email: best.e.email,
      expiresAt: best.e.expires_at,
      expired: best.expired,
    };
  } catch {
    return null;
  }
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

  let apiKey = "";
  let authSource: AuthSource = "none";
  let authEmail: string | undefined;

  const fromEnv =
    env("XAI_API_KEY") || env("GROK_API_KEY") || env("GROK_WEB_API_KEY");
  if (fromEnv) {
    apiKey = fromEnv;
    authSource = "env";
  } else if (file.apiKey && String(file.apiKey).trim()) {
    apiKey = String(file.apiKey).trim();
    authSource = "config";
  } else {
    // Prefer official Grok Build CLI session (same account as `grok` TUI)
    const cli = loadCliOidcAuth();
    if (cli?.token && !cli.expired) {
      apiKey = cli.token;
      authSource = "cli-oidc";
      authEmail = cli.email;
    } else if (cli?.token && cli.expired) {
      // still try expired token? no — force re-login
      authSource = "none";
    }
  }

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
    authSource,
    authEmail,
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
