# Codex CLI Proxy

API proxy that wraps the OpenAI Codex CLI (`codex exec --json`) as a subprocess and exposes both **Anthropic Messages API** and **OpenAI Chat Completions API** endpoints.

## Quick Reference

```bash
npm install
npm run build
npm start
codex-proxy
REQUIRE_AUTH=false codex-proxy
```

`claude-proxy` still exists as a compatibility alias for the same binary.

## Architecture

Every HTTP request spawns a fresh Codex subprocess. The proxy is stateless.

```text
HTTP Request
  -> Route Handler (routes/)
    -> Normalize request into shared prompt form
    -> Build `codex exec --json` args (cli/args-builder.ts)
    -> Spawn subprocess (cli/subprocess.ts)
    -> Parse Codex JSONL stdout and adapt it into internal CliEvent objects (cli/stream-parser.ts)
    -> Reuse existing Anthropic/OpenAI translators (translation/)
  -> HTTP Response (JSON or SSE)
```

The key compatibility trick is `src/cli/stream-parser.ts`: it converts Codex event types like `agent_message_delta`, `agent_message`, `token_count`, `turn_complete`, and `stream_error` into the proxy's synthetic `stream_event` / `result` sequence.

## Directory Structure

```text
src/
  index.ts                  # Entry point, config loading, Codex verification, server startup
  config.ts                 # Environment variable loading

  cli/
    args-builder.ts         # Builds `codex exec` argument arrays
    stream-parser.ts        # Codex JSONL -> internal CliEvent adapter
    subprocess.ts           # spawn(), timeout handling, lifecycle management

  protocol/
    cli-types.ts            # Internal synthetic stream protocol used by translators
    anthropic-types.ts      # Anthropic request/response types
    openai-types.ts         # OpenAI request/response types

  routes/
    anthropic-messages.ts   # POST /v1/messages
    openai-chat-completions.ts  # POST /v1/chat/completions
    models.ts               # GET /v1/models
    health.ts               # GET /health

  server/
    app.ts                  # HTTP server + route dispatch
    middleware.ts           # Auth, body parsing, CORS, error responses

  openclaw/
    tool-map.ts             # Legacy name mapping helpers
    prompt-filter.ts        # Removes injected tooling sections from prompts

  translation/
    anthropic-to-cli.ts     # API request -> flattened prompt
    cli-to-anthropic.ts     # Internal CliEvent stream -> Anthropic response
    cli-to-anthropic-stream.ts   # Internal CliEvent stream -> Anthropic SSE
    cli-to-openai.ts        # Internal CliEvent stream -> OpenAI response
    cli-to-openai-stream.ts # Internal CliEvent stream -> OpenAI SSE
    model-map.ts            # Codex model aliases and `/v1/models` list

  tools/
    mcp-bridge.ts           # Legacy MCP bridge code (currently unused by Codex exec)
    tool-translator.ts      # Legacy tool translation helpers
```

## Key Modules

### "I need to change how the Codex subprocess is invoked"

- `src/cli/args-builder.ts`
- `src/cli/subprocess.ts`

The command currently looks like:

```text
codex exec
  --json
  --skip-git-repo-check
  --full-auto
  --ephemeral
  --model <model>
  -
```

Prompt text goes via stdin.

### "I need to change how Codex JSONL is mapped back into API responses"

- `src/cli/stream-parser.ts`

This file synthesizes internal `message_start`, `content_block_*`, `message_delta`, `message_stop`, and `result` events from Codex JSONL.

### "I need to change prompt shaping"

- `src/translation/anthropic-to-cli.ts`
- `src/routes/openai-chat-completions.ts`

OpenAI requests are still normalized into Anthropic-like message arrays first, then flattened into a single stdin prompt.

### "I need to change available models"

- `src/translation/model-map.ts`

Current first-class models:

- `gpt-5-codex`
- `gpt-5`
- `o4-mini`
- `o3`

Unknown model names are passed through to Codex unchanged.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4523` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `PROXY_API_KEYS` | *(none)* | Comma-separated bearer tokens |
| `REQUIRE_AUTH` | `true` | Disable with `false` |
| `CODEX_PATH` | `codex` | Path to Codex CLI |
| `CLAUDE_PATH` | *(fallback only)* | Backward-compatible alias |
| `DEFAULT_MODEL` | `gpt-5-codex` | Fallback model |
| `DEFAULT_EFFORT` | `medium` | Reserved for future support |
| `REQUEST_TIMEOUT_MS` | `300000` | Per-request timeout |
| `LOG_LEVEL` | `info` | Logging level |
| `ENABLE_THINKING` | `false` | Reserved compatibility flag |

## API Compatibility Notes

- `/v1/messages` and `/v1/chat/completions` both still work.
- Streaming works by synthesizing SSE chunks from Codex JSONL events.
- OpenClaw prompt filtering remains active.
- Client-defined tools, tool choice, JSON schema output, and explicit effort controls are currently ignored and surfaced through `x-proxy-unsupported`.

## Error Handling

The server still returns:

- Anthropic-style errors for `/v1/messages`
- OpenAI-style errors for `/v1/chat/completions`

When Codex emits `stream_error` or `turn_aborted`, the parser converts that into an internal `result:error`, which then flows through the existing HTTP error handling path.

## Development Notes

- Always update this file when changing architecture, env vars, supported models, or runtime behavior.
- `npm run build` must pass before considering the change complete.
- Prefer keeping the synthetic internal event protocol stable so the route translators remain simple.
