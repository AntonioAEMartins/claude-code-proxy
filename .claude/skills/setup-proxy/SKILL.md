---
name: setup-proxy
description: Diagnose and fix OpenClaw + claude-code-proxy integration. Use when the proxy is not working with OpenClaw, tools aren't functioning, agent times out, or config needs to be set up from scratch.
argument-hint: [diagnose|fix|status]
user-invocable: true
allowed-tools: Bash(*), Read, Write, Edit, Grep, Glob
---

# OpenClaw + claude-code-proxy Setup & Troubleshooting

You are diagnosing or setting up the integration between OpenClaw (running in Docker) and claude-code-proxy (running on the host). This skill encodes hard-won knowledge from debugging this stack.

## Architecture

```
OpenClaw (Docker container, port 18789)
  → calls claude-proxy provider (http://host.docker.internal:3456/v1)
    → claude-code-proxy (host, port 3456)
      → spawns Claude CLI per request
        → Claude CLI spawns MCP bridge for tool definitions
          → model generates tool_use → proxy intercepts → returns to OpenClaw
            → OpenClaw executes tool → sends result back → next turn
```

## When invoked with `diagnose` or no argument

Run these checks in order and report findings:

### 1. Proxy health
```bash
curl -s http://localhost:3456/health
curl -s http://localhost:3456/v1/models
```

### 2. Container connectivity to proxy
```bash
docker exec openclaw curl -s http://host.docker.internal:3456/health
```

### 3. OpenClaw config validity
```bash
docker exec openclaw cat /home/openclaw/.openclaw/openclaw.json
```
Check for:
- `models.providers.claude-proxy` with correct `baseUrl`, `api: "openai-completions"`, and model entries
- `agents.defaults.model.primary` set to `claude-proxy/<model-id>`
- `agents.defaults.timeoutSeconds` set to 600 (proxy is slow, ~30-200s per turn)
- No leftover invalid keys (run `openclaw doctor --fix` if found)

### 4. Gateway status
```bash
docker exec openclaw ps aux | grep openclaw-gateway
docker exec openclaw tail -20 /tmp/openclaw.log
```
Verify gateway reports `agent model: claude-proxy/<model>` (NOT `anthropic/...`)

### 5. Tool calling test
```bash
curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Use the write_file tool to write hello to /tmp/test.txt"}],
    "tools": [{"type": "function", "function": {"name": "write_file", "description": "Write to a file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}}]
  }'
```
**Check that `arguments` is NOT empty** — if it's `""`, the MCP bridge bug is present (see Known Issues below).

## When invoked with `fix`

Apply the correct configuration:

### OpenClaw config (`openclaw.json` inside container)

The config file is `~/.openclaw/openclaw.json` (NOT `config.json`). Use the `models.providers` custom provider approach:

```json
{
  "models": {
    "providers": {
      "claude-proxy": {
        "baseUrl": "http://host.docker.internal:3456/v1",
        "apiKey": "not-needed",
        "api": "openai-completions",
        "authHeader": false,
        "models": [
          {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 200000,
            "maxTokens": 32000
          },
          {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 200000,
            "maxTokens": 32000
          },
          {
            "id": "claude-haiku-4-5",
            "name": "Claude Haiku 4.5",
            "reasoning": false,
            "input": ["text", "image"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 200000,
            "maxTokens": 32000
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "claude-proxy/claude-sonnet-4-6"
      },
      "timeoutSeconds": 600
    }
  },
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "<generate-random-hex>"
    }
  }
}
```

After writing the config, restart the gateway:
```bash
docker exec openclaw openclaw gateway stop
docker exec openclaw pkill -f "openclaw-gateway"
sleep 2
docker exec -d openclaw bash -c 'DISPLAY=:1 HOME=/home/openclaw openclaw gateway run --allow-unconfigured --bind loopback --port 18789'
```

### Docker files checklist

- **Dockerfile**: Must copy to `openclaw.json` not `config.json`: `COPY config/openclaw.json /home/openclaw/.openclaw/openclaw.json`
- **entrypoint.sh**: Must reference `openclaw.json` not `config.json`
- **supervisord.conf**: Use `autorestart=unexpected` with `exitcodes=0` for the gateway program (NOT `autorestart=true` — it conflicts with OpenClaw's internal SIGUSR1 restart)
- **docker-compose.yml**: Must include `extra_hosts: ["host.docker.internal:host-gateway"]` for proxy access. No need for `OPENAI_BASE_URL`/`OPENAI_API_KEY` env vars (the custom provider config handles it).

### Volume gotcha

The Docker volume `openclaw-data` at `~/.openclaw` persists across rebuilds. A `docker compose build` won't overwrite the runtime config. To fully reset: `docker volume rm openclaw-docker_openclaw-data` then rebuild.

## When invoked with `status`

Show a quick status summary:
```bash
echo "=== Proxy ===" && curl -s http://localhost:3456/health
echo "=== Container connectivity ===" && docker exec openclaw curl -s http://host.docker.internal:3456/health
echo "=== Gateway ===" && docker exec openclaw ps aux | grep openclaw-gateway | grep -v grep
echo "=== Agent model ===" && docker exec openclaw grep "agent model" /tmp/openclaw.log | tail -1
echo "=== Config model ===" && docker exec openclaw python3 -c "import json; c=json.load(open('/home/openclaw/.openclaw/openclaw.json')); print(c.get('agents',{}).get('defaults',{}).get('model',{}))"
```

## Known Issues

### 1. MCP bridge drops tool parameters (CRITICAL)
**Symptom**: Model says tools have "no parameters defined"; `arguments` field is `""`
**Cause**: `McpServer.tool()` in `@modelcontextprotocol/sdk` v1.27 expects Zod schemas, not JSON Schema. Raw JSON Schema silently falls back to empty `{ type: "object" }`.
**Fix**: Replace `McpServer` with low-level `Server` class in `src/tools/mcp-bridge.ts` — use `setRequestHandler(ListToolsRequestSchema)` to pass JSON Schema through directly. See: https://github.com/AntonioAEMartins/claude-code-proxy/issues/5

### 2. Slow response times (30-200s per turn)
**Symptom**: Agent timeouts, especially on first turn.
**Cause**: Each API call spawns a full Claude CLI process + MCP bridge subprocess. With 26 OpenClaw tools, startup overhead is significant.
**Mitigation**: Set `timeoutSeconds: 600` in OpenClaw config. First turns are slowest; follow-up turns within a session may be faster.

### 3. Supervisor crash loop after config changes
**Symptom**: Endless "gateway already running (pid X); lock timeout" errors in `/tmp/openclaw_err.log`.
**Cause**: OpenClaw detects config changes and restarts via SIGUSR1 internally. If supervisor has `autorestart=true`, it also tries to restart, causing port conflicts.
**Fix**: Use `autorestart=unexpected` + `exitcodes=0` in supervisord.conf.

### 4. Wrong config filename
**Symptom**: Config changes have no effect; gateway shows default `anthropic/claude-sonnet-4-6`.
**Cause**: OpenClaw reads `~/.openclaw/openclaw.json`, not `config.json`. The Dockerfile or entrypoint may copy to the wrong name.

### 5. Stale session context
**Symptom**: Agent completes but doesn't execute tools (says "Done" without doing anything).
**Cause**: OpenClaw reuses session context. If a previous turn in the same session already "completed" the task, the model may not re-execute.
**Fix**: Use `--session-id <unique-id>` for fresh sessions, or clear session state.

## Model IDs

The proxy serves these model IDs (check with `curl localhost:3456/v1/models`):
- `claude-opus-4-6` → Claude Opus 4.6
- `claude-sonnet-4-6` → Claude Sonnet 4.6
- `claude-haiku-4-5` → Claude Haiku 4.5

In OpenClaw config, prefix with provider name: `claude-proxy/claude-sonnet-4-6`
