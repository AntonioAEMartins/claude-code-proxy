import type { AnthropicToolDefinition } from '../protocol/anthropic-types.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface McpConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}

/**
 * Build an MCP config that launches a bridge server with the given tool definitions.
 * The bridge server script path must be provided (it's the compiled mcp-bridge.js).
 *
 * Returns the MCP config object and a cleanup function to remove temp files.
 */
export function buildMcpConfig(
  tools: AnthropicToolDefinition[],
  bridgeScriptPath: string,
): { mcpConfig: McpConfig; toolDefs: string } {
  const toolDefs = JSON.stringify(tools);

  const mcpConfig: McpConfig = {
    mcpServers: {
      client_tools: {
        command: 'node',
        args: [bridgeScriptPath],
        env: {
          TOOL_DEFINITIONS: toolDefs,
        },
      },
    },
  };

  return { mcpConfig, toolDefs };
}

/**
 * Write an MCP config to a temporary file for the CLI to read.
 * Returns the file path and a cleanup function.
 */
export function writeTempMcpConfig(mcpConfig: McpConfig): { configPath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), 'claude-proxy-'));
  const configPath = join(tempDir, 'mcp-config.json');
  writeFileSync(configPath, JSON.stringify(mcpConfig), 'utf-8');

  return {
    configPath,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Build an empty MCP config (no tools) for isolation.
 */
export function emptyMcpConfig(): McpConfig {
  return { mcpServers: {} };
}
