# AGENTS.md — Grok Web

## Intent

Host-local **Grok** coding-agent web UI for ATP fleet.

- **Skeleton:** Pi Web (sessions in real workspaces, browser = control surface)
- **Brain:** xAI Grok API (`api.x.ai`)
- **Port:** **2025** (siblings: OpenCode 2023, Pi Web 2024)

## Do

- Keep agent tools sandboxed to the project path
- Prefer env for API keys; never commit secrets
- Preserve fleet port map in `src/config.ts` `FLEET_PORTS`

## Don't

- Scrape grok.com / cookie tunnels
- Bind `0.0.0.0` in production without operator acceptance (mirror OC/Pi tailnet patterns)
- Pretend v0 sessiond owns the agent loop (it does not yet)

## Dev

```bash
npm install
npm run typecheck
npm run build
XAI_API_KEY=... GROK_WEB_PORT=2025 node dist/server/index.js
```
