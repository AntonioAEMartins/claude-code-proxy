import { readFileSync } from 'node:fs';

export interface McpServerDefinition {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Config {
  port: number;
  host: string;
  proxyApiKeys: string[];
  requireAuth: boolean;
  claudePath: string;
  defaultModel: string;
  defaultEffort: string;
  requestTimeoutMs: number;
  logLevel: string;
  enableThinking: boolean;
  mcpConfigPath?: string;
  mcpServers?: Record<string, McpServerDefinition>;
}

export function loadMcpServers(configPath: string): Record<string, McpServerDefinition> {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read MCP config file "${configPath}": ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in MCP config file: ${configPath}`);
  }

  if (typeof parsed !== 'object' || parsed === null || !('mcpServers' in parsed)) {
    throw new Error(`MCP config file must have a "mcpServers" key: ${configPath}`);
  }

  const { mcpServers } = parsed as { mcpServers: unknown };
  if (typeof mcpServers !== 'object' || mcpServers === null) {
    throw new Error(`"mcpServers" must be an object: ${configPath}`);
  }

  const servers = mcpServers as Record<string, unknown>;
  for (const [name, def] of Object.entries(servers)) {
    if (typeof def !== 'object' || def === null) {
      throw new Error(`MCP server "${name}" must be an object`);
    }
    const d = def as Record<string, unknown>;
    if (typeof d.command !== 'string') {
      throw new Error(`MCP server "${name}" must have a "command" string`);
    }
    if (!Array.isArray(d.args) || !d.args.every((a: unknown) => typeof a === 'string')) {
      throw new Error(`MCP server "${name}" must have an "args" string array`);
    }
    if (d.env !== undefined) {
      if (typeof d.env !== 'object' || d.env === null) {
        throw new Error(`MCP server "${name}".env must be an object`);
      }
      for (const [k, v] of Object.entries(d.env as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new Error(`MCP server "${name}".env.${k} must be a string`);
        }
      }
    }
  }

  return servers as Record<string, McpServerDefinition>;
}

export function loadConfig(): Config {
  const keys = process.env.PROXY_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) ?? [];

  const port = parseInt(process.env.PORT || '4523', 10);
  if (isNaN(port)) {
    throw new Error(`Invalid PORT value: "${process.env.PORT}" is not a valid number`);
  }

  const requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS || '300000', 10);
  if (isNaN(requestTimeoutMs)) {
    throw new Error(`Invalid REQUEST_TIMEOUT_MS value: "${process.env.REQUEST_TIMEOUT_MS}" is not a valid number`);
  }

  const mcpConfigPath = process.env.PROXY_MCP_CONFIG || undefined;

  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    proxyApiKeys: keys,
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
    claudePath: process.env.CLAUDE_PATH || 'claude',
    defaultModel: process.env.DEFAULT_MODEL || 'sonnet',
    defaultEffort: process.env.DEFAULT_EFFORT || 'high',
    requestTimeoutMs,
    logLevel: process.env.LOG_LEVEL || 'info',
    enableThinking: process.env.ENABLE_THINKING === 'true',
    mcpConfigPath,
  };
}
