import type { Config } from '../config.js';
import { toCliModel, validateEffort } from '../translation/model-map.js';

export interface CliArgs {
  /** The system prompt, if any */
  systemPrompt?: string;
  /** The model to use (API format, will be converted) */
  model: string;
  /** The effort level */
  effort?: string;
  /** The prompt text (all messages flattened) */
  prompt: string;
  /** JSON schema for structured output */
  jsonSchema?: Record<string, unknown>;
  /** MCP config JSON for tool use */
  mcpConfig?: Record<string, unknown>;
  /** Whether to enable thinking */
  enableThinking: boolean;
}

export interface BuiltCliCommand {
  args: string[];
  prompt: string;
}

export function buildArgs(cliArgs: CliArgs, config: Config): BuiltCliCommand {
  const cliModel = toCliModel(cliArgs.model);

  const args: string[] = [
    config.claudePath,
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--model', cliModel,
  ];

  // Effort level (validate and omit for haiku)
  const effort = validateEffort(cliModel, cliArgs.effort, config.defaultEffort);
  if (effort !== null) {
    args.push('--effort', effort);
  }

  // System prompt
  if (cliArgs.systemPrompt) {
    args.push('--system-prompt', cliArgs.systemPrompt);
  }

  // MCP config for tool use
  if (cliArgs.mcpConfig) {
    args.push('--strict-mcp-config');
    args.push('--mcp-config', JSON.stringify(cliArgs.mcpConfig));
  } else {
    // No tools — isolate from host MCP servers
    args.push('--strict-mcp-config');
    args.push('--mcp-config', JSON.stringify({ mcpServers: {} }));
  }

  // Disable built-in tools (user-defined MCP tools still work)
  args.push('--tools', '');

  // JSON schema for structured output
  if (cliArgs.jsonSchema) {
    args.push('--json-schema', JSON.stringify(cliArgs.jsonSchema));
  }

  // Prompt goes via stdin, not as a positional arg
  return { args, prompt: cliArgs.prompt };
}
