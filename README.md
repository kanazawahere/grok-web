# Grok Web (ATP)

**Full coding-agent web UI** — fork of our downstream [Pi Web](https://github.com/kanazawahere/pi-web) (`atp-stable`), rebranded for the fleet **Grok** door.

> Skeleton MVP lives on branch [`mvp-v0`](https://github.com/kanazawahere/grok-web/tree/mvp-v0).  
> **This branch (`main`) = full Pi Web feature surface.**

Agent runtime remains **Pi Coding Agent** (already supports **xAI / Grok** via `/login xai` or `XAI_API_KEY`). The product name and fleet door are Grok Web.

## Fleet doors

| Door | Port | Product |
|------|-----:|---------|
| OpenCode Web | **2023** | opencode |
| Pi Web | **2024** | `@jmfederico/pi-web` (ATP pin) |
| **Grok Web** | **2025** | **this repo** |

## Why fork Pi Web?

Pi Web is ~70k+ LOC: projects, workspaces, sessions, terminals, git, settings, machines/fleet, plugins, secure input, mobile layout. Rebuilding that for Grok would be years of wrong work. ATP already maintains a downstream pin — **Grok Web reuses that UI shell** and points the coding agent at Grok models.

## Quick start

```bash
# needs Node 22+, pi coding agent available to the user that runs sessiond
npm install
npm run build

export GROK_WEB_HOST=127.0.0.1
export GROK_WEB_PORT=2025
# optional: XAI_API_KEY or use Pi/Grok login already on the machine
node dist/server/sessiond.js &   # or: npm run start:sessiond
node dist/server/index.js        # web :2025
```

Open `http://127.0.0.1:2025/`.

### Grok models

In a session (or via Pi agent auth):

- `XAI_API_KEY` in the environment of sessiond, **or**
- Pi `/login xai` (subscription or API key) on that user account

Default model can be set in agent settings (prefer `xai` / Grok family).

## ATP fleet

```bash
# after npm run build in ~/work/grok-web
03_toolkit/bin/grok-web-2025 start|stop|status|logs
```

Data: `~/.grok-web` · Config: `~/.config/grok-web/config.json`  
(Pi Web on :2024 keeps `~/.pi-web` — separate.)

Env aliases: `GROK_WEB_HOST`, `GROK_WEB_PORT`, `GROK_WEB_DATA_DIR`, `GROK_WEB_CONFIG` (also accept `PI_WEB_*`).

## Lineage

```text
jmfederico/pi-web (upstream)
  └── kanazawahere/pi-web @ atp-stable   (ATP patches: secure input, native images, …)
        └── kanazawahere/grok-web @ main (this product: rebrand + port 2025 + fleet defaults)
```

## License

MIT (same as Pi Web upstream). ATP distribution markers in `package.json` → `atpDistribution`.
