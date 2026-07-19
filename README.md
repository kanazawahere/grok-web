# Grok Web (ATP)

**Web UI for persistent Grok coding-agent sessions in real workspaces.**

Architecture is inspired by **[Pi Web](https://github.com/jmfederico/pi-web)** (host-local sessions, project workspace, browser control surface). Model brain is **xAI Grok** via the official API.

> Not affiliated with xAI. "Grok" is a trademark of xAI Corp.

## Fleet doors (ATP)

| Door | Port |
|------|-----:|
| OpenCode Web | **2023** |
| Pi Web | **2024** |
| **Grok Web** | **2025** |

## Why

Pi Web and OpenCode Web already give the fleet a phone-reachable coding agent UI. Grok Web is the same *shape* for Grok:

- sessions survive browser disconnect (messages on disk under `~/.grok-web/`)
- default project = real repo path (ATP: `Central_Command`)
- tools: `read_file`, `write_file`, `search_replace`, `list_directory`, `run_command`
- WebSocket streaming (text + tool activity)

Ideas borrowed from community Grok UIs (`cwmaguire/grok-web` activity pane, `superagent-ai/grok-cli` agent tools) — **not** a copy of those repos.

## Auth (same as Grok CLI)

Priority:

1. `XAI_API_KEY` / `GROK_API_KEY` / `GROK_WEB_API_KEY` env
2. `apiKey` in `~/.config/grok-web/config.json`
3. **Official Grok Build CLI account** — `~/.grok/auth.json` from `grok login` (OIDC JWT as Bearer on `api.x.ai`)

If you already use the `grok` CLI and are logged in, **no extra key is required**.

```bash
grok login          # once, if needed
# then start grok-web — it picks up ~/.grok/auth.json
```

Token expiry: when CLI JWT expires, run `grok login` again (or use a long-lived API key via env).

## Quick start

```bash
# prefer CLI session; or: export XAI_API_KEY=xai-...
npm install
npm run build
# local
GROK_WEB_HOST=127.0.0.1 GROK_WEB_PORT=2025 node dist/server/index.js
# open http://127.0.0.1:2025/
```

Dev (tsx, no build):

```bash
npm install
npx tsx src/server/index.ts
```

## Process model (Pi Web mirror)

| Binary | Role (v0) |
|--------|-----------|
| `grok-web-server` | HTTP + WebSocket UI + agent loop |
| `grok-web-sessiond` | Sidecar health / session count (loopback `:port+1000`) |
| `grok-web` CLI | `start` / `sessiond` / `status` |

Pi Web runs a full `sessiond` that owns Pi agent processes. Grok Web v0 keeps the **two-process fleet layout** but the agent loop still lives in the web server; sessiond will own the loop in a later cut.

## Config / env

| Env | Default |
|-----|---------|
| `XAI_API_KEY` / `GROK_API_KEY` | (required for chat) |
| `GROK_WEB_HOST` | `127.0.0.1` (fleet wrapper sets Tailscale IP) |
| `GROK_WEB_PORT` | `2025` |
| `GROK_WEB_MODEL` | `grok-4` |
| `GROK_BASE_URL` | `https://api.x.ai/v1` |
| `GROK_WEB_DEFAULT_PROJECT_PATH` | `~/Central_Command` |
| `GROK_WEB_DATA_DIR` | `~/.grok-web` |

Sample file: `~/.config/grok-web/config.json` (`grok-web init-config`).

## ATP fleet

On Central_Command hosts:

```bash
03_toolkit/bin/grok-web-2025 start|stop|status|logs
```

Runbook: `03_toolkit/RUNBOOK_grok-web-2025.md` (in Central_Command).

## Status

- **v0.1** — usable MVP (server + tools + UI + fleet port 2025)
- Not yet: Pi-parity multi-machine federation, terminals, plugins, transactional package pin channel

## License

MIT
