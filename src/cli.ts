#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, FLEET_PORTS, writeSampleConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || "help";

function runNode(script: string) {
  const child = spawn(process.execPath, [join(__dirname, script)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (cmd) {
  case "serve":
  case "server":
  case "start":
    runNode("server/index.js");
    break;
  case "sessiond":
    runNode("sessiond/index.js");
    break;
  case "status": {
    const cfg = loadConfig();
    console.log(
      JSON.stringify(
        {
          fleet: FLEET_PORTS,
          config: {
            host: cfg.host,
            port: cfg.port,
            dataDir: cfg.dataDir,
            project: cfg.defaultProjectPath,
            model: cfg.model,
            hasApiKey: Boolean(cfg.apiKey),
          },
        },
        null,
        2,
      ),
    );
    break;
  }
  case "init-config":
    writeSampleConfig();
    console.log("wrote sample config if missing");
    break;
  default:
    console.log(`grok-web — ATP Grok Web (port ${FLEET_PORTS.grokWeb})

Usage:
  grok-web start|serve   Start web server (default :2025)
  grok-web sessiond      Start sessiond sidecar
  grok-web status        Print config / fleet ports
  grok-web init-config   Write ~/.config/grok-web/config.json sample

Fleet doors: OpenCode :${FLEET_PORTS.opencodeWeb} · Pi :${FLEET_PORTS.piWeb} · Grok :${FLEET_PORTS.grokWeb}

Env:
  XAI_API_KEY / GROK_API_KEY
  GROK_WEB_HOST  GROK_WEB_PORT  GROK_WEB_MODEL
  GROK_WEB_DEFAULT_PROJECT_PATH
`);
}
