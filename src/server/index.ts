#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig, writeSampleConfig, FLEET_PORTS } from "../config.js";
import { SessionStore } from "../sessiond/store.js";
import { runAgentTurn } from "../agent/loop.js";
import type { ClientEvent, ServerEvent } from "../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = existsSync(join(__dirname, "public"))
  ? join(__dirname, "public")
  : join(__dirname, "../../public");

const cfg = loadConfig();
writeSampleConfig();
const store = new SessionStore(cfg);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "grok-web",
      version: "0.1.0",
      port: cfg.port,
      fleet: FLEET_PORTS,
      hasApiKey: Boolean(cfg.apiKey),
      authSource: cfg.authSource,
      authEmail: cfg.authEmail ?? null,
      model: cfg.model,
      time: new Date().toISOString(),
    });
    return true;
  }

  if (req.method === "GET" && path === "/api/version") {
    sendJson(res, 200, {
      name: "@atp/grok-web",
      version: "0.1.0",
      fleetPort: FLEET_PORTS.grokWeb,
    });
    return true;
  }

  if (req.method === "GET" && path === "/api/projects") {
    sendJson(res, 200, { projects: store.projects() });
    return true;
  }

  if (req.method === "GET" && path === "/api/sessions") {
    sendJson(res, 200, { sessions: store.listSessions() });
    return true;
  }

  if (req.method === "POST" && path === "/api/sessions") {
    let title: string | undefined;
    try {
      const b = JSON.parse(await readBody(req)) as { title?: string };
      title = b.title;
    } catch {
      /* empty */
    }
    const s = store.create(title);
    sendJson(res, 201, { session: s });
    return true;
  }

  const m = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (req.method === "GET") {
      const s = store.read(id);
      if (!s) {
        sendJson(res, 404, { error: "not found" });
        return true;
      }
      sendJson(res, 200, { session: s });
      return true;
    }
    if (req.method === "DELETE") {
      sendJson(res, store.delete(id) ? 200 : 404, { ok: true });
      return true;
    }
  }

  return false;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  let rel = url.pathname === "/" ? "/index.html" : url.pathname;
  rel = rel.replace(/\.\./g, "");
  const file = join(PUBLIC_DIR, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback
    const index = join(PUBLIC_DIR, "index.html");
    if (existsSync(index)) {
      const buf = readFileSync(index);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buf);
      return;
    }
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const buf = readFileSync(file);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
  res.end(buf);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "not found" });
      return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

const active = new Map<string, AbortController>();

function send(ws: WebSocket, ev: ServerEvent) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let sessionId = url.searchParams.get("session") || "";

  if (!sessionId || !store.read(sessionId)) {
    const s = store.create();
    sessionId = s.id;
  }

  const session = store.read(sessionId)!;
  send(ws, {
    type: "session",
    session: {
      id: session.id,
      title: session.title,
      projectName: session.projectName,
      projectPath: session.projectPath,
      model: session.model,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  });
  send(ws, { type: "history", messages: session.messages });

  ws.on("message", async (raw) => {
    let msg: ClientEvent;
    try {
      msg = JSON.parse(String(raw)) as ClientEvent;
    } catch {
      send(ws, { type: "error", message: "bad client message" });
      return;
    }

    if (msg.type === "ping") return;

    if (msg.type === "interrupt") {
      active.get(sessionId)?.abort();
      active.delete(sessionId);
      send(ws, { type: "cancelled" });
      return;
    }

    if (msg.type === "user_message") {
      if (!cfg.apiKey) {
        send(ws, {
          type: "error",
          message:
            "No auth: run `grok login` (CLI OIDC → ~/.grok/auth.json) or export XAI_API_KEY / GROK_API_KEY, then restart grok-web",
        });
        return;
      }
      if (active.has(sessionId)) {
        send(ws, { type: "error", message: "session already running a turn" });
        return;
      }
      const ac = new AbortController();
      active.set(sessionId, ac);
      try {
        let cur = store.read(sessionId);
        if (!cur) cur = store.create();
        const next = await runAgentTurn({
          cfg,
          session: cur,
          userText: msg.content,
          emit: (ev) => send(ws, ev),
          signal: ac.signal,
        });
        store.save(next);
      } catch (e) {
        send(ws, { type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        active.delete(sessionId);
      }
    }
  });
});

server.listen(cfg.port, cfg.host, () => {
  console.log(
    JSON.stringify({
      event: "grok-web-listen",
      host: cfg.host,
      port: cfg.port,
      url: `http://${cfg.host}:${cfg.port}/`,
      dataDir: cfg.dataDir,
      project: cfg.defaultProjectPath,
      hasApiKey: Boolean(cfg.apiKey),
      fleet: FLEET_PORTS,
    }),
  );
});
