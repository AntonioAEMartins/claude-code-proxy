/**
 * OpenClaw tool name mapping.
 *
 * OpenClaw uses its own tool names (exec, read, write, etc.) that differ from
 * the Claude Code equivalents (Bash, Read, Write, etc.). The Claude model has
 * stronger priors for the Claude Code names, so remapping improves tool use.
 *
 * The reverse map is built per-request so response tool_use blocks can be
 * translated back to the names the client expects.
 */

import type { AnthropicToolDefinition } from '../protocol/anthropic-types.js';

const OPENCLAW_TO_CLAUDE: Record<string, string> = {
  exec: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  browser: 'Browser',
  process: 'Bash',
  canvas: 'Canvas',
};

/**
 * Map an OpenClaw tool name to its Claude Code equivalent.
 * Returns the original name if no mapping exists.
 */
export function mapToolName(name: string): string {
  return OPENCLAW_TO_CLAUDE[name] || name;
}

/**
 * Apply tool name mapping to an array of Anthropic tool definitions.
 * Returns mapped tools and a reverse map for translating response tool names
 * back to the original client names.
 */
export function mapToolDefinitions(
  tools: AnthropicToolDefinition[],
): { mappedTools: AnthropicToolDefinition[]; reverseToolMap: Record<string, string> } {
  const reverseToolMap: Record<string, string> = {};

  const mappedTools = tools.map(tool => {
    const mapped = mapToolName(tool.name);
    if (mapped !== tool.name) {
      reverseToolMap[mapped] = tool.name;
    }
    return { ...tool, name: mapped };
  });

  return { mappedTools, reverseToolMap };
}
