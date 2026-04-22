import type { Config, McpServerDefinition } from '../config.js';
import { toCliModel, validateEffort } from '../translation/model-map.js';
import { badRequest } from '../util/errors.js';

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
  /** MCP server names to activate from the registry */
  mcpServerNames?: string[];
  /** Whether to enable thinking */
  enableThinking: boolean;
}

export interface BuiltCliCommand {
  args: string[];
  prompt: string;
  extraEnv?: Record<string, string>;
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

  // Build merged MCP config: client tool bridge + registry servers
  const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  let extraEnv: Record<string, string> | undefined;

  // Include client tool bridge config (if tools were provided in request)
  if (cliArgs.mcpConfig) {
    const bridge = cliArgs.mcpConfig as { mcpServers?: Record<string, unknown> };
    if (bridge.mcpServers) {
      Object.assign(mcpServers, bridge.mcpServers);
    }
  }

  // Merge activated registry servers
  if (cliArgs.mcpServerNames && cliArgs.mcpServerNames.length > 0) {
    if (!config.mcpServers) {
      throw badRequest('MCP server registry is not configured. Set PROXY_MCP_CONFIG to enable it.');
    }
    const available = Object.keys(config.mcpServers);
    for (const name of cliArgs.mcpServerNames) {
      const server = config.mcpServers[name];
      if (!server) {
        throw badRequest(`Unknown MCP server: "${name}". Available: ${available.join(', ')}`);
      }
      mcpServers[name] = { command: server.command, args: server.args };
      if (server.env) {
        if (!extraEnv) extraEnv = {};
        Object.assign(extraEnv, server.env);
        mcpServers[name].env = server.env;
      }
    }
  }

  args.push('--strict-mcp-config');
  args.push('--mcp-config', JSON.stringify({ mcpServers }));

  // Disable built-in tools (user-defined MCP tools still work)
  args.push('--tools', '');

  // JSON schema for structured output
  if (cliArgs.jsonSchema) {
    args.push('--json-schema', JSON.stringify(cliArgs.jsonSchema));
  }

  // Prompt goes via stdin, not as a positional arg
  return { args, prompt: cliArgs.prompt, extraEnv };
}
