#!/usr/bin/env node
/**
 * sessiond — process boundary mirrors Pi Web (pi-web-sessiond).
 *
 * v0: session persistence lives in SessionStore used by the web server.
 * This process is a health/presence sidecar so fleet wrappers can run
 * two panes (sessiond + web) like pi-web@host.
 *
 * Future: move agent loops + IPC socket here (true split like Pi Web).
 */
import { createServer } from "node:http";
import { loadConfig, FLEET_PORTS } from "../config.js";
import { SessionStore } from "./store.js";

const cfg = loadConfig();
const store = new SessionStore(cfg);
// sidecars bind loopback offset so they don't steal :2025
const port = Number(process.env.GROK_WEB_SESSIOND_PORT || cfg.port + 1000);

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1`);
  if (url.pathname === "/health") {
    const body = JSON.stringify({
      ok: true,
      service: "grok-web-sessiond",
      sessions: store.listSessions().length,
      fleetPort: FLEET_PORTS.grokWeb,
      time: new Date().toISOString(),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "grok-web-sessiond-listen",
      host: "127.0.0.1",
      port,
      note: "v0 sidecar; agent loop still in grok-web-server",
    }),
  );
});
