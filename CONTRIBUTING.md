# Contributing to Claude Code Proxy

Thanks for your interest in contributing! This document explains how to get involved.

## How to Contribute

All contributions go through **Issues + Pull Requests**. No direct pushes to `main`.

### 1. Open an Issue First

Before writing code, open an issue to discuss what you want to do:

- **Bug reports** — describe what happened, what you expected, and how to reproduce it. Include the proxy log output (`LOG_LEVEL=debug`) if relevant.
- **Feature requests** — describe the use case and why it matters. We'll discuss the approach before implementation.
- **Questions** — if you're unsure whether something is a bug or how something works, open an issue and ask.

This avoids wasted effort on PRs that don't align with the project direction.

### 2. Fork and Branch

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/claude-code-proxy.git
cd claude-code-proxy
npm install
npm run build

# Create a branch from main
git checkout -b feat/your-feature    # or fix/your-bugfix
```

### 3. Make Your Changes

- Keep changes focused — one issue per PR
- Follow the existing code style (TypeScript strict mode, no `any` unless justified)
- Add types for new functionality in `src/protocol/` if introducing new data shapes
- Update `CLAUDE.md` if you add new files, routes, config options, or change architecture
- Update `README.md` if you change user-facing behavior

### 4. Test Your Changes

```bash
# Type-check
npm run build

# Start the proxy and test manually
REQUIRE_AUTH=false npm start

# Test Anthropic format
curl -s -X POST http://localhost:4523/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","max_tokens":50,"messages":[{"role":"user","content":"Say hello"}]}' | python3 -m json.tool

# Test OpenAI format
curl -s -X POST http://localhost:4523/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"Say hello"}]}' | python3 -m json.tool

# Test streaming
curl -N -X POST http://localhost:4523/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","max_tokens":50,"stream":true,"messages":[{"role":"user","content":"Say hello"}]}'
```

Make sure:
- `npm run build` compiles with zero errors
- Both Anthropic and OpenAI endpoints still work (streaming and non-streaming)
- Error cases return proper error responses (not crashes)

### 5. Submit a Pull Request

```bash
git add -A
git commit -m "feat: description of what you did"
git push origin feat/your-feature
```

Then open a PR on GitHub. In the PR description:

- **Reference the issue** — e.g., "Closes #12"
- **Describe what changed** and why
- **Include test results** — paste the curl output or describe what you tested

### 6. Code Review

A maintainer will review your PR. We may ask for changes — this is normal and collaborative, not adversarial. Once approved, we'll merge it.

## Branch Naming

| Prefix | Use |
|--------|-----|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code restructuring (no behavior change) |
| `chore/` | Build, deps, CI, tooling |

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add vision support for image content blocks
fix: handle empty messages array without crashing
docs: add Python streaming example to README
refactor: extract message conversion to shared utility
chore: update @modelcontextprotocol/sdk to 1.28
```

Keep the first line under 72 characters. Add a body if the "why" isn't obvious from the title.

## Code Guidelines

- **TypeScript strict mode** — no `any` unless there's a comment explaining why
- **No runtime dependencies** unless absolutely necessary (we currently have one: `@modelcontextprotocol/sdk`)
- **Use `spawn()` never `exec()`** — shell injection is a real risk
- **Handle errors explicitly** — no swallowed promises, no empty catch blocks
- **Clean up resources** — subprocesses must be killed, timeouts must be cleared
- **Keep functions small** — if a function is doing three things, split it

## Where Things Go

| What you're adding | Where it goes |
|--------------------|---------------|
| New API type definitions | `src/protocol/` |
| New CLI flags or subprocess behavior | `src/cli/` |
| New API endpoint | `src/routes/` + register in `src/server/app.ts` |
| Request/response format conversion | `src/translation/` |
| New config option | `src/config.ts` + `.env.example` |
| New error type | `src/util/errors.ts` |
| Tool use changes | `src/tools/` |

See [CLAUDE.md](CLAUDE.md) for a detailed codebase map.

## Good First Issues

Look for issues labeled `good first issue`. These are typically:
- Adding a missing model alias
- Improving error messages
- Adding a config option
- Documentation improvements
- Small bug fixes

## Reporting Security Issues

If you find a security vulnerability, **do not open a public issue**. Instead, email the maintainer directly or open a private security advisory on GitHub.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
