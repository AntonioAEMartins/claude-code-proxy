# Claude Code Proxy

API proxy that wraps the Claude CLI (`claude --print`) as a subprocess, exposing **Anthropic Messages API** and **OpenAI Chat Completions API** endpoints. Powered by the Claude Max subscription quota.

## Quick Reference

```bash
npm run build          # Compile TypeScript
npm start              # Run the proxy (port 4523)
claude-proxy           # Same, if globally linked via `npm link`
REQUIRE_AUTH=false claude-proxy   # Run without auth
```

## Architecture

Every HTTP request spawns a fresh CLI subprocess. The proxy is fully stateless.

```
HTTP Request
  -> Route Handler (routes/)
    -> Translate request to CLI args (translation/)
    -> Spawn `claude --print` subprocess (cli/)
    -> Parse NDJSON stdout stream (cli/stream-parser.ts)
    -> Translate CLI events to API response (translation/)
  -> HTTP Response (streaming SSE or JSON)
```

### Request Flow

```
Client SDK                    Proxy                           Claude CLI
    |                           |                                 |
    |-- POST /v1/messages ----->|                                 |
    |                           |-- translateAnthropicRequest() ->|
    |                           |-- buildArgs() ----------------->|
    |                           |-- spawnCli(args, prompt) ------>|
    |                           |       stdin: prompt             |
    |                           |       stdout: NDJSON events     |
    |                           |<-- stream_event (SSE) ---------|
    |<-- SSE chunks ------------|                                 |
    |                           |<-- result event --------------- |
    |<-- stream end ------------|                                 |
```

### OpenAI requests follow the same path

OpenAI format is normalized to Anthropic format first (`convertMessages()` in the route handler), then the shared Anthropic->CLI pipeline runs. Responses are translated back to OpenAI format.

## Directory Structure

```
src/
  index.ts                  # Entry point: config, CLI verification, HTTP server, shutdown
  config.ts                 # Environment variable loading (Config interface)

  cli/                      # Claude CLI subprocess management
    args-builder.ts         # Builds CLI argument arrays + extracts prompt for stdin
    stream-parser.ts        # NDJSON async generator (stdout -> CliEvent[])
    subprocess.ts           # spawn(), timeout, kill, event generator

  protocol/                 # Type definitions only (no logic)
    cli-types.ts            # CliEvent union: system|assistant|user|stream_event|rate_limit|result
    anthropic-types.ts      # Anthropic Messages API request/response/SSE types
    openai-types.ts         # OpenAI Chat Completions request/response/streaming types

  routes/                   # HTTP route handlers
    anthropic-messages.ts   # POST /v1/messages  (Anthropic format)
    openai-chat-completions.ts  # POST /v1/chat/completions  (OpenAI format)
    models.ts               # GET /v1/models
    health.ts               # GET /health

  server/                   # HTTP infrastructure
    app.ts                  # createServer(), route dispatch, CORS preflight
    middleware.ts           # Auth check, JSON body parsing, error responses, CORS headers

  tools/                    # MCP bridge for client-defined tool use
    tool-translator.ts      # Anthropic tool defs -> MCP server config
    mcp-bridge.ts           # Standalone MCP stdio server (child process)

  openclaw/                 # OpenClaw integration
    tool-map.ts             # Tool name mapping (exec→Bash, read→Read, etc.) + reverse map
    prompt-filter.ts        # Strip injected tooling sections from system prompts

  translation/              # Format conversion (the core logic)
    model-map.ts            # Model alias resolution, effort validation, model listing
    anthropic-to-cli.ts     # AnthropicMessagesRequest -> CliArgs (prompt + flags)
    cli-to-anthropic-stream.ts   # CliEvent async generator -> Anthropic SSE strings
    cli-to-anthropic.ts          # CliEvent async generator -> AnthropicMessagesResponse
    cli-to-openai-stream.ts      # CliEvent async generator -> OpenAI SSE strings
    cli-to-openai.ts             # CliEvent async generator -> OpenAIChatCompletionResponse

  util/
    errors.ts               # ApiError class + factory functions (badRequest, unauthorized, etc.)
    logger.ts               # JSON structured logger to stderr
```

## Key Modules — Where to Find Things

### "I need to change how requests are sent to the CLI"
- `src/cli/args-builder.ts` — `buildArgs()` constructs the flag array
- `src/cli/subprocess.ts` — `spawnCli()` manages the process lifecycle
- The prompt goes via **stdin** (not as a positional arg). The `buildArgs()` function returns `{ args, prompt }` separately.

### "I need to change how messages are converted to a prompt"
- `src/translation/anthropic-to-cli.ts` — `messagesToPrompt()` flattens the messages array into a single string. Multi-turn uses `<assistant_response>` and `<tool_result>` XML tags.

### "I need to add/change a model"
- `src/translation/model-map.ts` — `MODEL_ALIASES` maps all accepted names to CLI model names. `EFFORT_BY_MODEL` defines effort constraints per model. `CLI_TO_API_MODEL` maps back for responses.

### "I need to change how responses are translated"
- Anthropic streaming: `src/translation/cli-to-anthropic-stream.ts` — near pass-through of CLI `stream_event` inner events
- Anthropic non-streaming: `src/translation/cli-to-anthropic.ts` — accumulates blocks from stream events
- OpenAI streaming: `src/translation/cli-to-openai-stream.ts` — maps Anthropic events to OpenAI chunk format
- OpenAI non-streaming: `src/translation/cli-to-openai.ts` — accumulates into OpenAI response shape

### "I need to change auth, CORS, or error handling"
- `src/server/middleware.ts` — `checkAuth()`, `setCorsHeaders()`, `parseJsonBody()`, `sendError()`
- Auth uses timing-safe comparison. Body parsing has a 10MB limit.

### "I need to add a new route"
1. Create handler in `src/routes/`
2. Add dispatch in `src/server/app.ts` (the `if/else` chain in `createServer`)

### "I need to change tool use behavior"
- `src/tools/tool-translator.ts` — converts Anthropic tool definitions to MCP config
- `src/tools/mcp-bridge.ts` — standalone MCP stdio server the CLI connects to
- `src/openclaw/tool-map.ts` — maps client tool names (e.g. OpenClaw's `exec`) to Claude Code equivalents (`Bash`), with reverse mapping for responses
- Tool integration in request translation: `src/translation/anthropic-to-cli.ts` (builds MCP config when `tools[]` present)
- The bridge returns placeholder results; the proxy surfaces `tool_use` blocks from the CLI output as `stop_reason: "tool_use"` to the client.

### "I need to change system prompt filtering"
- `src/openclaw/prompt-filter.ts` — auto-detects and strips injected tooling sections (XML-tagged tool/skill blocks) from system prompts

### "I need to change configuration"
- `src/config.ts` — `Config` interface and `loadConfig()`. All settings come from env vars.

## Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4523` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `PROXY_API_KEYS` | *(none)* | Comma-separated bearer tokens |
| `REQUIRE_AUTH` | `true` | Set `false` to disable auth |
| `CLAUDE_PATH` | `claude` | Path to Claude CLI binary |
| `DEFAULT_MODEL` | `sonnet` | Fallback model |
| `DEFAULT_EFFORT` | `high` | Default effort level |
| `REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout (5 min) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `ENABLE_THINKING` | `false` | Include thinking blocks in responses |
| `PROXY_MCP_CONFIG` | *(none)* | Path to MCP server registry JSON file |

## MCP Server Registry

The proxy can expose pre-registered MCP servers to API clients on a per-request basis. Credentials stay server-side; clients only reference servers by name.

### Setup

Set `PROXY_MCP_CONFIG` to a JSON file path:

```bash
PROXY_MCP_CONFIG=./mcp-servers.json claude-proxy
```

File format (same schema as Claude CLI):
```json
{
  "mcpServers": {
    "neon": {
      "command": "npx",
      "args": ["-y", "@neondatabase/mcp-server-neon"],
      "env": { "NEON_API_KEY": "neon_abc123" }
    }
  }
}
```

### Per-Request Activation

**Anthropic format** — `metadata.mcp_servers`:
```json
{ "metadata": { "mcp_servers": ["neon"] } }
```

**OpenAI format** — `x-mcp-servers` header:
```
x-mcp-servers: neon
```

Requesting an unknown server name returns a 400 error. Without `mcp_servers`, no registry servers are activated (full isolation, same as before).

### Tool Names

Registry server tools arrive with `mcp__<server>__` prefix (e.g., `mcp__neon__query`). This prefix is preserved in responses so clients can distinguish tools from different servers.

## API Endpoints

| Method | Path | Format | Description |
|---|---|---|---|
| `POST` | `/v1/messages` | Anthropic | Messages API (streaming + non-streaming) |
| `POST` | `/v1/chat/completions` | OpenAI | Chat Completions (streaming + non-streaming) |
| `GET` | `/v1/models` | OpenAI | List available models |
| `GET` | `/health` | JSON | Health check |

## Model Names

Any of these are accepted in the `model` field:

| Aliases | CLI Model | Response Model ID |
|---|---|---|
| `claude-opus-4-6`, `claude-opus-4`, `opus`, `opus-4`, `opus-4-6` | `opus` | `claude-opus-4-6` |
| `claude-sonnet-4-6`, `claude-sonnet-4`, `sonnet`, `sonnet-4`, `sonnet-4-6` | `sonnet` | `claude-sonnet-4-6` |
| `claude-haiku-4-5`, `claude-haiku-4`, `haiku`, `haiku-4`, `haiku-4-5` | `haiku` | `claude-haiku-4-5` |

Model names with the `claude-code-cli/` or `openai/` prefix are also accepted (the prefix is stripped before lookup). Unknown models fall back to `DEFAULT_MODEL`.

## Effort Levels

| Model | Supported | Default |
|---|---|---|
| Opus | `low`, `medium`, `high`, `max` | `high` |
| Sonnet | `low`, `medium`, `high` | `high` |
| Haiku | *(none)* | *(flag omitted)* |

Set via `metadata.effort` (Anthropic), `x-effort` header (both), or `DEFAULT_EFFORT` env var.

## CLI Flags Used

Every subprocess is invoked with:
```
claude --print
  --output-format stream-json
  --verbose
  --include-partial-messages
  --dangerously-skip-permissions
  --no-session-persistence
  --model <model>
  --effort <level>                    # omitted for haiku
  --strict-mcp-config
  --mcp-config '<json>'               # empty or tool bridge config
  --tools ""                          # disables built-in tools
  --system-prompt <prompt>            # if provided
  --json-schema <schema>              # if structured output
```

Prompt text goes via **stdin**, not as a positional argument.

## CLI Event Types (stdout NDJSON)

The CLI emits these event types in order:
1. `system` (subtype `init`) — session metadata
2. `stream_event` — wraps Anthropic streaming events (`message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`)
3. `assistant` — full assistant message (emitted mid-stream with `--include-partial-messages`)
4. `rate_limit_event` — quota info (`allowed` or `rate_limited`)
5. `result` (subtype `success` or `error`) — final event with cost/usage

Types are defined in `src/protocol/cli-types.ts`.

## Error Handling

| Scenario | HTTP Status | Error Type |
|---|---|---|
| Missing/invalid fields | 400 | `invalid_request_error` |
| Bad auth | 401 | `authentication_error` |
| Unknown route | 404 | `not_found_error` |
| Request timeout | 408 | `request_timeout` |
| Body too large | 413 | `invalid_request_error` |
| Rate limited | 429 | `rate_limit_error` |
| CLI error | 500 | `api_error` |

Errors are formatted as Anthropic `{type:"error",error:{type,message}}` for `/v1/messages` and OpenAI `{error:{message,type,code}}` for `/v1/chat/completions`.

## Unsupported Parameters

These are accepted but ignored (a `x-proxy-unsupported` response header lists them):
- `temperature`, `top_p`, `top_k` — CLI doesn't expose sampling params
- `stop_sequences` / `stop` — no CLI equivalent
- `frequency_penalty`, `presence_penalty` — OpenAI-specific, no equivalent
- `n > 1` — only single completion supported

## OpenClaw Integration

The proxy supports plug-and-play operation with [OpenClaw](https://github.com/AntonioAEMartins/claude-code-proxy/issues/3). The following features are applied automatically on OpenAI-format requests:

### Tool Name Mapping
Client tool names are mapped to Claude Code equivalents for better model performance:

| Client Tool | Claude Code Equivalent |
|---|---|
| `exec` | `Bash` |
| `read` | `Read` |
| `write` | `Write` |
| `edit` | `Edit` |
| `web_search` | `WebSearch` |
| `web_fetch` | `WebFetch` |
| `browser` | `Browser` |
| `canvas` | `Canvas` |

Tool names are mapped forward in requests and reverse-mapped in responses so clients see their original names.

### System Prompt Filtering
XML-tagged tooling sections injected by coding agents (e.g. `<tools>`, `<skills>`, `<functions>`) are auto-detected and stripped from system prompts to prevent conflicts with the CLI's MCP-based tool system.

### Content Block Handling
`input_text` content blocks (used by OpenAI Responses API and some clients) are treated as plain `text` blocks. Multi-block assistant content is separated with newlines.

### Streaming Improvements
- SSE connection confirmation (`:ok` comment sent on connect)
- Structured error propagation during streaming (errors sent as SSE events)
- Client disconnect detection kills the subprocess immediately

## Security Notes

- `spawn()` used everywhere (never `exec()`) to prevent shell injection
- API key comparison uses `crypto.timingSafeEqual`
- Request body capped at 10MB
- Subprocess environment is filtered (only PATH, HOME, etc.) to prevent secret leakage
- Subprocess timeout with SIGTERM -> SIGKILL escalation
- Client disconnect kills the subprocess immediately

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Key points for agents:

- All changes go through **Issues + Pull Requests** — no direct pushes to `main`
- Branch naming: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) — e.g., `feat: add vision support`
- `npm run build` must compile with zero errors before submitting
- Update `CLAUDE.md` when adding files, routes, or config options
- Update `README.md` when changing user-facing behavior
- No `any` types without a justifying comment
- No runtime dependencies unless absolutely necessary
- Always `spawn()`, never `exec()`

## Build & Development

```bash
npm install              # Install dependencies
npm run build            # tsc -> dist/
npm start                # node dist/index.js
npm run dev              # tsc --watch (recompile on change)
npm link                 # Install `claude-proxy` command globally
```

TypeScript strict mode, ES2022 target, Node16 module resolution, ESM (`"type": "module"`).

Single runtime dependency: `@modelcontextprotocol/sdk` (for the MCP bridge server).
