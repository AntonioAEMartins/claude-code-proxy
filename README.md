# Claude Code Proxy

Use your **Claude Max subscription** as an API. This proxy wraps the Claude CLI as a subprocess and exposes standard API endpoints that any SDK or tool can talk to.

**Two APIs, one proxy:**
- **Anthropic Messages API** — `POST /v1/messages`
- **OpenAI Chat Completions API** — `POST /v1/chat/completions`

Works with the Anthropic SDK, OpenAI SDK, Python clients, Cursor, Continue, aider, LiteLLM, OpenClaw, and anything else that accepts a custom base URL.

## Why?

Claude Max gives you generous usage through the CLI, but no API access. This proxy bridges that gap — run it locally and point any SDK at it.

## Prerequisites

- **Node.js** 20+
- **Claude CLI** installed and authenticated (`claude --version` should work)
- **Claude Max subscription** (the CLI must be logged in)

## Install

```bash
git clone https://github.com/AntonioAEMartins/claude-code-proxy.git
cd claude-code-proxy
npm install
npm run build
npm link     # makes `claude-proxy` available globally
```

## Usage

```bash
# Start the proxy (no auth, for local use)
REQUIRE_AUTH=false claude-proxy

# With auth
PROXY_API_KEYS=my-secret-key claude-proxy

# Custom port
PORT=8080 REQUIRE_AUTH=false claude-proxy
```

The proxy starts on `http://127.0.0.1:4523` by default.

## Connect Your SDK

### TypeScript / JavaScript

```typescript
// Anthropic SDK
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "any-string",
  baseURL: "http://localhost:4523",
});

const message = await client.messages.create({
  model: "claude-sonnet-4",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

```typescript
// OpenAI SDK
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "any-string",
  baseURL: "http://localhost:4523/v1",
});

const completion = await client.chat.completions.create({
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Python

```python
# Anthropic
import anthropic

client = anthropic.Anthropic(api_key="any-string", base_url="http://localhost:4523")
message = client.messages.create(
    model="claude-sonnet-4",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
```

```python
# OpenAI
import openai

client = openai.OpenAI(api_key="any-string", base_url="http://localhost:4523/v1")
completion = client.chat.completions.create(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### Other Tools

Any tool with a "custom base URL" or "OpenAI-compatible" setting works:

| Tool | Base URL Setting |
|------|-----------------|
| **Cursor** | `http://localhost:4523/v1` |
| **Continue** | `http://localhost:4523/v1` |
| **aider** | `--openai-api-base http://localhost:4523/v1` |
| **LiteLLM** | `api_base="http://localhost:4523/v1"` |
| **OpenClaw** | `OPENAI_BASE_URL=http://host.docker.internal:4523/v1` |

Use `claude-sonnet-4-6`, `claude-opus-4-6`, or `claude-haiku-4-5` as the model name (shorter aliases like `sonnet`, `opus`, `haiku` also work). Model names with a `claude-code-cli/` or `openai/` prefix are also accepted (the prefix is stripped automatically). Unknown models fall back to the `DEFAULT_MODEL`.

## Streaming

Both APIs support streaming out of the box:

```typescript
// Anthropic streaming
const stream = client.messages.stream({
  model: "claude-sonnet-4",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Write a haiku" }],
});

for await (const event of stream) {
  // process events
}
```

```typescript
// OpenAI streaming
const stream = await client.chat.completions.create({
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "Write a haiku" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

## Available Models

| Model Name | Aliases |
|-----------|---------|
| `claude-opus-4-6` | `claude-opus-4`, `opus` |
| `claude-sonnet-4-6` | `claude-sonnet-4`, `sonnet` |
| `claude-haiku-4-5` | `claude-haiku-4`, `haiku` |

## Features

- **Streaming & non-streaming** for both Anthropic and OpenAI formats
- **System prompts**
- **Multi-turn conversations**
- **Tool use / function calling** via MCP bridge
- **Structured output** (JSON schema)
- **Extended thinking** (set `ENABLE_THINKING=true`)
- **Effort levels** — `low`, `medium`, `high`, `max` (model-dependent)
- **Rate limit propagation** from CLI quota
- **Auto-cleanup** — subprocess killed on client disconnect or timeout
- **OpenClaw integration** — automatic tool name mapping, system prompt filtering, and `input_text` block support

## Configuration

All settings are environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4523` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `PROXY_API_KEYS` | — | Comma-separated API keys for auth |
| `REQUIRE_AUTH` | `true` | Set `false` for local use |
| `CLAUDE_PATH` | `claude` | Path to Claude CLI |
| `DEFAULT_MODEL` | `sonnet` | Model when not specified |
| `DEFAULT_EFFORT` | `high` | Default effort level |
| `REQUEST_TIMEOUT_MS` | `300000` | Request timeout (5 min) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `ENABLE_THINKING` | `false` | Include thinking blocks |
| `PROXY_MCP_CONFIG` | — | Path to MCP server registry JSON file |

## MCP Server Registry

Optionally expose pre-registered MCP servers (e.g., Neon, Supabase) to API clients. Credentials stay server-side; clients activate servers by name.

**1. Create a config file** (`mcp-servers.json`):

```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": ["-y", "@neondatabase/mcp-server-neon"],
      "env": { "NEON_API_KEY": "your-key-here" }
    }
  }
}
```

**2. Start the proxy:**

```bash
PROXY_MCP_CONFIG=./mcp-servers.json claude-proxy
```

**3. Activate per request:**

```bash
# Anthropic format — metadata.mcp_servers
curl -X POST http://localhost:4523/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"sonnet","max_tokens":1024,"metadata":{"mcp_servers":["neon"]},"messages":[{"role":"user","content":"List my database tables"}]}'

# OpenAI format — x-mcp-servers header
curl -X POST http://localhost:4523/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-mcp-servers: neon" \
  -d '{"model":"sonnet","messages":[{"role":"user","content":"List my database tables"}]}'
```

Without `PROXY_MCP_CONFIG`, behavior is unchanged (full MCP isolation). Without `mcp_servers` in a request, no registry servers are activated.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `GET` | `/v1/models` | List available models |
| `GET` | `/health` | Health check |

## How It Works

Each API request spawns a fresh `claude --print` subprocess. The proxy translates between API formats and CLI I/O:

```
Your App  →  HTTP Request  →  Proxy  →  claude --print  →  Claude Max
                                ↕
                          Translates formats
                          (Anthropic ↔ CLI ↔ OpenAI)
```

- Prompts are sent via stdin
- Responses are parsed from stdout (NDJSON stream)
- Each request is stateless — no sessions, no state between calls
- The proxy uses `--dangerously-skip-permissions` for non-interactive operation

## Limitations

- **No image/vision support yet** — image content blocks are not passed through
- **Sampling parameters ignored** — `temperature`, `top_p`, `top_k` are accepted but have no effect (CLI doesn't expose them)
- **`max_tokens` is advisory** — there's no direct CLI flag for token limits
- **Rate limits depend on your subscription** — the proxy passes through whatever quota the CLI reports
- **One completion per request** — `n > 1` is not supported

## Security

- Uses `spawn()` (not `exec()`) to prevent shell injection
- API key comparison uses `crypto.timingSafeEqual`
- Request bodies capped at 10MB
- Subprocess environment is filtered — your secrets are not leaked to the CLI
- Subprocesses are killed on client disconnect and request timeout

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

The short version: open an issue to discuss, then fork, branch, and submit a PR. See the contributing guide for branch naming, commit conventions, code guidelines, and testing steps.

## License

[MIT](LICENSE) — use it however you want, just keep the copyright notice.
