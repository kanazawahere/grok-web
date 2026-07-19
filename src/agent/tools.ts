import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export type ToolResult = { content: string; isError?: boolean };

const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a text file under the project workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to project root or absolute under project" },
          offset: { type: "integer", description: "1-based start line (optional)" },
          limit: { type: "integer", description: "Max lines to return (optional)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write or create a text file under the project workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_replace",
      description: "Exact string replacement in a file under the project workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List files in a directory under the project workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path; default '.'" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Run a shell command with cwd = project root. Timeout 120s.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
];

export function toolDefinitions() {
  return TOOL_DEFS;
}

function resolveInProject(projectPath: string, rawPath: string): string {
  const root = resolve(projectPath);
  const candidate = resolve(root, rawPath || ".");
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel === ".." || (rel !== "" && rel.split(sep)[0] === "..")) {
    throw new Error(`path escapes project root: ${rawPath}`);
  }
  if (!candidate.startsWith(root + sep) && candidate !== root) {
    throw new Error(`path escapes project root: ${rawPath}`);
  }
  return candidate;
}

async function runShell(command: string, cwd: string, timeoutMs = 120_000): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      out += "\n[timeout]";
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 200_000) out = out.slice(-200_000);
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 100_000) err = err.slice(-100_000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const body = [out, err && `STDERR:\n${err}`, `exit=${code ?? "?"}`].filter(Boolean).join("\n");
      resolvePromise({ content: body, isError: code !== 0 });
    });
  });
}

export async function executeTool(
  projectPath: string,
  name: string,
  argsJson: string,
): Promise<ToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return { content: "invalid JSON arguments", isError: true };
  }

  try {
    switch (name) {
      case "read_file": {
        const p = resolveInProject(projectPath, String(args.path ?? ""));
        if (!existsSync(p)) return { content: `not found: ${args.path}`, isError: true };
        const raw = readFileSync(p, "utf8");
        const lines = raw.split("\n");
        const offset = Math.max(1, Number(args.offset ?? 1));
        const limit = Number(args.limit ?? lines.length);
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((l, i) => `${offset + i}|${l}`).join("\n");
        return { content: numbered || "(empty)" };
      }
      case "write_file": {
        const p = resolveInProject(projectPath, String(args.path ?? ""));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, String(args.content ?? ""), "utf8");
        return { content: `wrote ${relative(projectPath, p)} (${String(args.content ?? "").length} bytes)` };
      }
      case "search_replace": {
        const p = resolveInProject(projectPath, String(args.path ?? ""));
        if (!existsSync(p)) return { content: `not found: ${args.path}`, isError: true };
        const oldS = String(args.old_string ?? "");
        const newS = String(args.new_string ?? "");
        const cur = readFileSync(p, "utf8");
        if (!cur.includes(oldS)) return { content: "old_string not found", isError: true };
        const next = cur.replace(oldS, newS);
        if (cur === next) return { content: "no change (ambiguous or identical)", isError: true };
        // only first occurrence if multiple — require uniqueness
        if (cur.split(oldS).length > 2) {
          return { content: "old_string matches multiple times; make it unique", isError: true };
        }
        writeFileSync(p, next, "utf8");
        return { content: `updated ${relative(projectPath, p)}` };
      }
      case "list_directory": {
        const p = resolveInProject(projectPath, String(args.path ?? "."));
        if (!existsSync(p)) return { content: `not found: ${args.path}`, isError: true };
        const st = statSync(p);
        if (!st.isDirectory()) return { content: "not a directory", isError: true };
        const entries = readdirSync(p, { withFileTypes: true })
          .slice(0, 200)
          .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`);
        return { content: entries.join("\n") || "(empty)" };
      }
      case "run_command": {
        return await runShell(String(args.command ?? ""), projectPath);
      }
      default:
        return { content: `unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    return { content: e instanceof Error ? e.message : String(e), isError: true };
  }
}

export function systemPrompt(projectPath: string): string {
  return [
    "You are Grok Web, a coding agent running in a real workspace on the operator's machine.",
    "Architecture is inspired by Pi Web (persistent sessions in real projects); you use xAI Grok models.",
    `Project workspace: ${projectPath}`,
    "Prefer tools for reading and editing files. Keep changes focused. Report clearly.",
    "Fleet ports: OpenCode Web 2023 · Pi Web 2024 · Grok Web 2025.",
  ].join("\n");
}
