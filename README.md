# Codex CLI Proxy

Use the local **OpenAI Codex CLI** as an HTTP API. This proxy wraps `codex exec` and exposes:

- `POST /v1/messages` in Anthropic Messages format
- `POST /v1/chat/completions` in OpenAI Chat Completions format
- `GET /v1/models`
- `GET /health`

The server stays stateless: every HTTP request spawns a fresh `codex exec --json` subprocess, sends the flattened prompt through stdin, adapts Codex JSONL events into the proxy's internal stream format, and translates the result back to JSON or SSE.

## Prerequisites

- Node.js 20+
- Codex CLI installed and authenticated: `codex --version`

## Install

```bash
git clone <your-fork-or-repo>
cd claude-code-proxy
npm install
npm run build
npm link
```

`npm link` exposes `codex-proxy` and keeps `claude-proxy` as a compatibility alias.

## Usage

```bash
REQUIRE_AUTH=false codex-proxy
PROXY_API_KEYS=my-secret-key codex-proxy
PORT=8080 REQUIRE_AUTH=false codex-proxy
```

Default address: `http://127.0.0.1:4523`

## Authentication

The proxy has two separate authentication layers:

1. Codex CLI authentication
2. Proxy HTTP authentication

They are independent.

### 1. Codex CLI authentication

This is the login the proxy uses internally when it runs `codex exec`.

Example:

```bash
codex login
codex --version
```

The proxy does not read a secret from the CLI and does not expose your Codex login as an API key. It simply launches the local Codex CLI process, which uses whatever account/session is already configured on your machine.

### 2. Proxy HTTP authentication

This is the token that clients must send when calling your local proxy over HTTP.

Example:

```bash
PROXY_API_KEYS=my-secret-key codex-proxy
```

`my-secret-key` is just an example string. You invent it yourself. It is not fetched from Codex CLI, not generated automatically, and not related to your OpenAI account token.

If you want multiple valid tokens, separate them with commas:

```bash
PROXY_API_KEYS=local-dev-key,team-key codex-proxy
```

If you want to disable proxy auth entirely for local-only usage:

```bash
REQUIRE_AUTH=false codex-proxy
```

### How clients send the proxy token

The server accepts either:

- `Authorization: Bearer <token>`
- `x-api-key: <token>`

Examples:

```bash
curl http://127.0.0.1:4523/health \
  -H 'Authorization: Bearer my-secret-key'
```

```bash
curl http://127.0.0.1:4523/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer my-secret-key' \
  -d '{
    "model": "gpt-5-codex",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

```bash
curl http://127.0.0.1:4523/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: my-secret-key' \
  -d '{
    "model": "gpt-5-codex",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### Recommended setup

For a machine used only by you:

```bash
REQUIRE_AUTH=false codex-proxy
```

For tools, containers, browser extensions, or other apps connecting to the proxy:

```bash
PROXY_API_KEYS=choose-a-long-random-string codex-proxy
```

In short: log into Codex CLI once with `codex login`, then separately choose your own proxy token with `PROXY_API_KEYS`.

## Model Names

Accepted aliases:

- `codex`, `gpt-5-codex` -> `gpt-5-codex`
- `gpt-5`
- `o4-mini`
- `o3`

Prefixes like `openai/` and `codex/` are stripped automatically. Unknown model names are passed through to Codex as-is.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4523` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `PROXY_API_KEYS` | *(none)* | Comma-separated bearer tokens |
| `REQUIRE_AUTH` | `true` | Set `false` to disable auth |
| `CODEX_PATH` | `codex` | Path to the Codex CLI |
| `CLAUDE_PATH` | *(fallback only)* | Backward-compatible alias for `CODEX_PATH` |
| `DEFAULT_MODEL` | `gpt-5-codex` | Fallback model |
| `DEFAULT_EFFORT` | `medium` | Reserved for future support |
| `REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `ENABLE_THINKING` | `false` | Preserved for API compatibility; Codex thinking is not surfaced yet |

## Current Behavior

- Streaming and non-streaming responses work for both API formats.
- System prompts are injected into the stdin prompt envelope because `codex exec` has no dedicated system flag.
- Multi-turn chat is flattened into a single prompt before execution.
- OpenClaw prompt filtering and OpenAI-format normalization are still active.
- The proxy runs Codex with `--full-auto --ephemeral --skip-git-repo-check`.

## Current Limitations

- Client-defined tools / function calling are accepted for compatibility but ignored.
- JSON-schema structured output is not wired through yet.
- `temperature`, `top_p`, `top_k`, `stop`, `stop_sequences`, penalties, and `n > 1` are still unsupported.
- Token usage is best-effort and depends on which Codex JSONL events are emitted.
- The proxy currently synthesizes Anthropic-style stream events from Codex output; it is not a byte-for-byte CLI passthrough.

## Development

```bash
npm run build
npm start
```

This project is strict TypeScript, ESM, and uses `spawn()` rather than `exec()` for subprocess safety.
